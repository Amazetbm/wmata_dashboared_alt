'use strict';

const AdherenceSnapshot = require('../../models/AdherenceSnapshot');
const RailOccupancy = require('../../models/RailOccupancy');
const railGeometry = require('../../lib/railGeometry');
const { enrichTrainsWithOccupancy } = require('../../lib/occupancyEnricher');

const GTFS_ENABLED = process.env.GTFS_RAIL_OCCUPANCY === 'true';

async function getTrainPositions({ line } = {}) {
  const snapshot = await AdherenceSnapshot.findOne().sort({ snapshotAt: -1 }).lean();
  if (!snapshot) return { snapshotAt: null, summary: {}, lineSummaries: [], trains: [] };

  let { trains, summary, lineSummaries, snapshotAt } = snapshot;

  if (line) {
    const code = line.toUpperCase();
    trains        = (trains        || []).filter(t => t.lineCode === code);
    lineSummaries = (lineSummaries || []).filter(l => l.lineCode === code);
    summary       = lineSummaries[0] ?? summary;
  }

  // Enrich trains with human-readable location and destination name
  const [stationsMap, standardRoutes] = await Promise.all([
    railGeometry.getStations(),
    railGeometry.getStandardRoutes(),
  ]);
  const bracketMap = railGeometry.buildCircuitStationBracketMap(standardRoutes, stationsMap);

  let enrichedTrains = (trains || []).map(t => ({
    trainId:     t.trainId,
    lineCode:    t.lineCode,
    carCount:    t.carCount,
    status:      t.status,
    location:    railGeometry.describeLocation(bracketMap[t.circuitId]),
    destination: stationsMap.get(t.destinationCode)?.Name ?? t.destinationCode ?? 'unknown',
  }));

  enrichedTrains = await enrichTrainsWithOccupancy(
    enrichedTrains,
    'trainId',
    GTFS_ENABLED,
    () => RailOccupancy.findOne().sort({ snapshotAt: -1 }).lean(),
  );

  return { snapshotAt, summary, lineSummaries, trains: enrichedTrains };
}

module.exports = { getTrainPositions };
