'use strict';

const AdherenceSnapshot = require('../../models/AdherenceSnapshot');
const railGeometry = require('../../lib/railGeometry');

async function getTrainPositions({ line } = {}) {
  const snapshot = await AdherenceSnapshot.findOne().sort({ snapshotAt: -1 }).lean();
  if (!snapshot) return { snapshotAt: null, summary: {}, lineSummaries: [], trains: [] };

  let { trains, summary, lineSummaries, snapshotAt } = snapshot;

  if (line) {
    const code = line.toUpperCase();
    trains        = (trains        || []).filter(t => t.lineCode === code);
    lineSummaries = (lineSummaries || []).filter(l => l.lineCode === code);
  }

  // Enrich trains with human-readable location and destination name
  const [stationsMap, standardRoutes] = await Promise.all([
    railGeometry.getStations(),
    railGeometry.getStandardRoutes(),
  ]);
  const bracketMap = railGeometry.buildCircuitStationBracketMap(standardRoutes, stationsMap);

  const enrichedTrains = (trains || []).map(t => ({
    trainId:     t.trainId,
    lineCode:    t.lineCode,
    carCount:    t.carCount,
    status:      t.status,
    location:    railGeometry.describeLocation(bracketMap[t.circuitId]),
    destination: stationsMap.get(t.destinationCode)?.Name ?? t.destinationCode ?? 'unknown',
  }));

  return { snapshotAt, summary, lineSummaries, trains: enrichedTrains };
}

module.exports = { getTrainPositions };
