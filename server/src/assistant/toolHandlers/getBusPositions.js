'use strict';

const BusPosition = require('../../models/BusPosition');
const BusOccupancy = require('../../models/BusOccupancy');
const { enrichWithOccupancy, buildOccupancyMap, BUS_OCCUPANCY_LABELS, STALE_MS } = require('../../lib/occupancyEnricher');

const GTFS_BUS_ENABLED = process.env.GTFS_BUS_OCCUPANCY === 'true';

function isNotStale(feedTimestamp) {
  return (Date.now() - new Date(feedTimestamp).getTime()) <= STALE_MS;
}

async function getBusPositions({ route_id } = {}) {
  const latest = await BusPosition.findOne().sort({ snapshotAt: -1 }).select('snapshotAt').lean();
  if (!latest) {
    return route_id
      ? { snapshotAt: null, route: route_id.toUpperCase(), count: 0, buses: [] }
      : { snapshotAt: null, totalBuses: 0, routesShown: 0, routes: [] };
  }

  const { snapshotAt } = latest;
  const match = { snapshotAt };
  if (route_id) match.RouteID = route_id.toUpperCase();

  if (route_id) {
    const buses = await BusPosition.find(match)
      .limit(50)
      .select('VehicleID RouteID DirectionText TripHeadsign Lat Lon Deviation')
      .lean();

    const enriched = await enrichWithOccupancy(
      buses, 'VehicleID', GTFS_BUS_ENABLED,
      () => BusOccupancy.findOne().sort({ snapshotAt: -1 }).lean(),
      BUS_OCCUPANCY_LABELS,
    );

    return {
      snapshotAt,
      route: route_id.toUpperCase(),
      count: enriched.length,
      buses: enriched.map(b => ({
        vehicleId: b.VehicleID,
        route:     b.RouteID,
        direction: b.DirectionText,
        headsign:  b.TripHeadsign,
        lat:       b.Lat,
        lon:       b.Lon,
        deviation: b.Deviation,  // minutes, positive = late
        occupancy: b.occupancy ?? null,
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

  let routes = agg;

  if (GTFS_BUS_ENABLED) {
    const occDoc = await BusOccupancy.findOne().sort({ snapshotAt: -1 }).lean();
    if (occDoc && isNotStale(occDoc.feedTimestamp)) {
      const occMap = buildOccupancyMap(occDoc, BUS_OCCUPANCY_LABELS);
      const busIds = await BusPosition.find({ snapshotAt })
        .select('VehicleID RouteID')
        .lean();

      const perRoute = {};
      for (const b of busIds) {
        const occ = occMap.get(String(b.VehicleID).trim());
        const r = b.RouteID;
        if (!perRoute[r]) perRoute[r] = { many: 0, few: 0, full: 0, unknown: 0 };
        if (!occ) perRoute[r].unknown++;
        else if (occ.status === 1) perRoute[r].many++;
        else if (occ.status === 2) perRoute[r].few++;
        else perRoute[r].full++;
      }

      routes = agg.map(r => ({ ...r, crowding: perRoute[r.route] ?? null }));
    }
  }

  return {
    snapshotAt,
    totalBuses,
    routesShown: routes.length,
    ...(routes.length === 20 ? { note: 'Top 20 routes by bus count shown. Filter by route_id for full detail.' } : {}),
    routes,
  };
}

module.exports = { getBusPositions };
