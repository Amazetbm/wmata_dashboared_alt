const router = require('express').Router();
const { wmataClient } = require('../middleware/wmata');
const BusPosition = require('../models/BusPosition');
const BusIncident = require('../models/BusIncident');

// In-memory cache for route details — fetched lazily per route, TTL 1 hour
const routeDetailCache = new Map(); // routeId -> { shape0, shape1, cachedAt }
const ROUTE_DETAIL_TTL = 60 * 60 * 1000;

async function fetchRouteDetail(routeId) {
  const cached = routeDetailCache.get(routeId);
  if (cached && Date.now() - cached.cachedAt < ROUTE_DETAIL_TTL) return cached;

  try {
    const { data } = await wmataClient.get(`/Bus.svc/json/jRouteDetails?RouteID=${encodeURIComponent(routeId)}`);
    const entry = {
      shape0: (data.Direction0?.Shape || []).map(p => [p.Lat, p.Lon]),
      shape1: (data.Direction1?.Shape || []).map(p => [p.Lat, p.Lon]),
      cachedAt: Date.now(),
    };
    routeDetailCache.set(routeId, entry);
    return entry;
  } catch (err) {
    console.error(`[bus/shapes] fetchRouteDetail(${routeId}) failed:`, err.message);
    return null;
  }
}

// GET /api/bus/map
// Returns live positions, route list, stops, incidents, and shapes for active routes.
router.get('/map', async (req, res) => {
  try {
    const [posRes, routesRes, stopsRes, incRes] = await Promise.allSettled([
      wmataClient.get('/Bus.svc/json/jBusPositions'),
      wmataClient.get('/Bus.svc/json/jRoutes'),
      wmataClient.get('/Bus.svc/json/jStops'),
      wmataClient.get('/Incidents.svc/json/BusIncidents'),
    ]);

    const positions = posRes.status === 'fulfilled' ? (posRes.value.data.BusPositions || []) : [];
    const routes    = routesRes.status === 'fulfilled' ? (routesRes.value.data.Routes || []) : [];
    const stops     = stopsRes.status === 'fulfilled' ? (stopsRes.value.data.Stops || []) : [];

    let incidentsSource = 'live';
    let incidents = incRes.status === 'fulfilled' ? (incRes.value.data.BusIncidents || []) : [];

    if (incidents.length === 0) {
      const cutoff = new Date(Date.now() - 30 * 60 * 1000);
      const recent = await BusIncident.find({ snapshotAt: { $gte: cutoff } })
        .sort({ snapshotAt: -1 })
        .limit(100)
        .lean();
      if (recent.length > 0) {
        const seen = new Set();
        incidents = recent.filter(r => {
          if (seen.has(r.IncidentID)) return false;
          seen.add(r.IncidentID);
          return true;
        });
        incidentsSource = 'cached';
      }
    }

    // Fetch shapes for the top 20 routes by active bus count (lazy + cached).
    // Capping at 20 prevents rate-limit failures when 100–200 routes fire in parallel.
    const routeBusCounts = {};
    for (const p of positions) {
      if (p.RouteID) routeBusCounts[p.RouteID] = (routeBusCounts[p.RouteID] || 0) + 1;
    }
    const activeRouteIds = Object.entries(routeBusCounts)
      .sort((a, b) => b[1] - a[1])
      .slice(0, 20)
      .map(([id]) => id);
    const detailResults = await Promise.allSettled(activeRouteIds.map(id => fetchRouteDetail(id)));

    const routeShapes = {};
    activeRouteIds.forEach((id, i) => {
      const r = detailResults[i];
      if (r.status === 'fulfilled' && r.value) routeShapes[id] = r.value;
    });

    res.json({ positions, routes, stops, incidents, incidents_source: incidentsSource, routeShapes });
  } catch (err) {
    console.error('[bus/map]', err.message);
    res.status(502).json({ error: 'Failed to load bus map data' });
  }
});

// GET /api/bus/history/positions
router.get('/history/positions', async (req, res) => {
  const { from, to } = req.query;
  if (!from || !to) return res.status(400).json({ error: 'from and to required' });
  try {
    const filter = { snapshotAt: { $gte: new Date(from), $lte: new Date(to) } };
    const data = await BusPosition.find(filter).sort({ snapshotAt: 1 }).limit(5000);
    res.json(data);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// GET /api/bus/history/incidents
router.get('/history/incidents', async (req, res) => {
  const { from, to } = req.query;
  if (!from || !to) return res.status(400).json({ error: 'from and to required' });
  try {
    const filter = { snapshotAt: { $gte: new Date(from), $lte: new Date(to) } };
    const data = await BusIncident.find(filter).sort({ snapshotAt: 1 }).limit(5000);
    res.json(data);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// GET /api/bus/incidents/history
// Aggregated historical bus incident data: daily counts by type, top routes, per-incident durations.
// Query params: startTime (ISO), endTime (ISO), routeId (optional exact match)
router.get('/incidents/history', async (req, res) => {
  const { startTime, endTime, routeId } = req.query;
  if (!startTime || !endTime) {
    return res.status(400).json({ error: 'startTime and endTime are required' });
  }
  const start = new Date(startTime);
  const end   = new Date(endTime);
  if (isNaN(start.getTime()) || isNaN(end.getTime())) {
    return res.status(400).json({ error: 'Invalid date format' });
  }

  const baseMatch = {
    snapshotAt: { $gte: start, $lte: end },
    ...(routeId ? { RoutesAffected: routeId } : {}),
  };

  try {
    const [dailyRes, routesRes, incidentsRes] = await Promise.allSettled([
      // Daily unique incident counts broken down by IncidentType
      BusIncident.aggregate([
        { $match: baseMatch },
        { $group: { _id: {
          date: { $dateToString: { format: '%Y-%m-%d', date: '$snapshotAt' } },
          incidentId: '$IncidentID',
          type: '$IncidentType',
        }}},
        { $group: { _id: { date: '$_id.date', type: '$_id.type' }, count: { $sum: 1 } } },
        { $group: { _id: '$_id.date', types: { $push: { k: '$_id.type', v: '$count' } } } },
        { $project: { _id: 0, date: '$_id', types: { $arrayToObject: '$types' } } },
        { $sort: { date: 1 } },
      ]),
      // Top 10 routes ranked by unique incident count
      BusIncident.aggregate([
        { $match: baseMatch },
        { $unwind: '$RoutesAffected' },
        { $group: { _id: { route: '$RoutesAffected', incidentId: '$IncidentID' } } },
        { $group: { _id: '$_id.route', count: { $sum: 1 } } },
        { $sort: { count: -1 } },
        { $limit: 10 },
        { $project: { _id: 0, route: '$_id', count: 1 } },
      ]),
      // Per-incident duration: first/last snapshot timestamp within the range
      BusIncident.aggregate([
        { $match: baseMatch },
        { $group: {
          _id: '$IncidentID',
          description: { $first: '$Description' },
          type:        { $first: '$IncidentType' },
          routes:      { $first: '$RoutesAffected' },
          firstSeen:   { $min: '$snapshotAt' },
          lastSeen:    { $max: '$snapshotAt' },
        }},
        { $project: {
          _id: 0,
          incidentId: '$_id',
          description: 1, type: 1, routes: 1, firstSeen: 1, lastSeen: 1,
          durationMinutes: {
            $toInt: { $divide: [{ $subtract: ['$lastSeen', '$firstSeen'] }, 60000] },
          },
        }},
        { $sort: { firstSeen: 1 } },
      ]),
    ]);

    const dailyByType = dailyRes.status    === 'fulfilled' ? dailyRes.value    : [];
    const topRoutes   = routesRes.status   === 'fulfilled' ? routesRes.value   : [];
    const incidents   = incidentsRes.status === 'fulfilled' ? incidentsRes.value : [];

    const total = incidents.length;
    const mostAffectedRoute = topRoutes[0]?.route ?? null;
    const typeCounts = incidents.reduce((acc, i) => {
      acc[i.type] = (acc[i.type] || 0) + 1; return acc;
    }, {});
    const mostCommonType = Object.entries(typeCounts).sort((a, b) => b[1] - a[1])[0]?.[0] ?? null;
    const daysInRange    = Math.max(1, Math.round((end - start) / 86_400_000));

    res.json({
      dailyByType, topRoutes, incidents,
      summary: {
        total,
        mostAffectedRoute,
        mostCommonType,
        avgDaily: Math.round((total / daysInRange) * 10) / 10,
      },
    });
  } catch (err) {
    console.error('[bus/incidents/history]', err.message);
    res.status(500).json({ error: err.message });
  }
});

module.exports = router;
