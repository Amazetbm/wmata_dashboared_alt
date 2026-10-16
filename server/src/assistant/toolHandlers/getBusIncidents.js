'use strict';

const BusIncident = require('../../models/BusIncident');

async function getBusIncidents({ from, to, route_id } = {}) {
  if (!from || !to) throw new Error('from and to are required');
  const start = new Date(from);
  const end   = new Date(to);
  if (isNaN(start.getTime()) || isNaN(end.getTime())) throw new Error('Invalid date format');

  const baseMatch = {
    snapshotAt: { $gte: start, $lte: end },
    ...(route_id ? { RoutesAffected: route_id } : {}),
  };

  // Reuse the same aggregation pipeline as routes/bus.js /incidents/history
  const [routesRes, incidentsRes] = await Promise.allSettled([
    BusIncident.aggregate([
      { $match: baseMatch },
      { $unwind: '$RoutesAffected' },
      { $group: { _id: { route: '$RoutesAffected', incidentId: '$IncidentID' } } },
      { $group: { _id: '$_id.route', count: { $sum: 1 } } },
      { $sort: { count: -1 } },
      { $limit: 10 },
      { $project: { _id: 0, route: '$_id', count: 1 } },
    ]),
    BusIncident.aggregate([
      { $match: baseMatch },
      { $group: {
        _id:       '$IncidentID',
        type:      { $first: '$IncidentType' },
        routes:    { $first: '$RoutesAffected' },
        firstSeen: { $min: '$snapshotAt' },
        lastSeen:  { $max: '$snapshotAt' },
      }},
      { $project: { _id: 0, incidentId: '$_id', type: 1, routes: 1, firstSeen: 1, lastSeen: 1 } },
    ]),
  ]);

  const topRoutes = routesRes.status   === 'fulfilled' ? routesRes.value   : [];
  const incidents = incidentsRes.status === 'fulfilled' ? incidentsRes.value : [];

  const total      = incidents.length;
  const typeCounts = incidents.reduce((acc, i) => { acc[i.type] = (acc[i.type] || 0) + 1; return acc; }, {});
  const daysInRange = Math.max(1, Math.round((end - start) / 86_400_000));

  return {
    summary: {
      total,
      mostAffectedRoute: topRoutes[0]?.route ?? null,
      mostCommonType:    Object.entries(typeCounts).sort((a, b) => b[1] - a[1])[0]?.[0] ?? null,
      avgDaily:          Math.round((total / daysInRange) * 10) / 10,
      byType:            typeCounts,
    },
    topRoutes,
  };
}

module.exports = { getBusIncidents };
