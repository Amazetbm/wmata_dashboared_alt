'use strict';

const BusPosition = require('../../models/BusPosition');

async function getBusPositions({ route_id } = {}) {
  const latest = await BusPosition.findOne().sort({ snapshotAt: -1 }).select('snapshotAt').lean();
  if (!latest) return { snapshotAt: null, count: 0, routes: [], buses: [] };

  const { snapshotAt } = latest;
  const match = { snapshotAt };
  if (route_id) match.RouteID = route_id.toUpperCase();

  if (route_id) {
    const buses = await BusPosition.find(match)
      .limit(50)
      .select('VehicleID RouteID DirectionText TripHeadsign Lat Lon Deviation')
      .lean();
    return {
      snapshotAt,
      route: route_id.toUpperCase(),
      count: buses.length,
      buses: buses.map(b => ({
        vehicleId: b.VehicleID,
        route:     b.RouteID,
        direction: b.DirectionText,
        headsign:  b.TripHeadsign,
        lat:       b.Lat,
        lon:       b.Lon,
        deviation: b.Deviation,  // minutes, positive = late
      })),
    };
  }

  // No filter: aggregate per-route summary (cap 20 routes by count)
  const agg = await BusPosition.aggregate([
    { $match: { snapshotAt } },
    { $group: {
        _id: '$RouteID',
        count: { $sum: 1 },
        headsigns: { $addToSet: '$TripHeadsign' },
    }},
    { $sort: { count: -1 } },
    { $limit: 20 },
    { $project: { _id: 0, route: '$_id', count: 1, headsigns: { $slice: ['$headsigns', 3] } } },
  ]);

  const totalBuses = await BusPosition.countDocuments({ snapshotAt });

  return {
    snapshotAt,
    totalBuses,
    routesShown: agg.length,
    ...(agg.length === 20 ? { note: 'Top 20 routes by bus count shown. Filter by route_id for full detail.' } : {}),
    routes: agg,
  };
}

module.exports = { getBusPositions };
