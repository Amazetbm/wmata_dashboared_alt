'use strict';

const AdherenceSnapshot = require('../../models/AdherenceSnapshot');

async function getTrainPositions({ line } = {}) {
  const snapshot = await AdherenceSnapshot.findOne().sort({ snapshotAt: -1 }).lean();
  if (!snapshot) return { snapshotAt: null, summary: {}, lineSummaries: [], trains: [] };

  let { trains, summary, lineSummaries, snapshotAt } = snapshot;

  if (line) {
    const code = line.toUpperCase();
    trains       = (trains       || []).filter(t => t.lineCode === code);
    lineSummaries = (lineSummaries || []).filter(l => l.lineCode === code);
  }

  return { snapshotAt, summary, lineSummaries, trains };
}

module.exports = { getTrainPositions };
