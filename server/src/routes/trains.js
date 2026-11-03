const router = require('express').Router();
const { wmataClient } = require('../middleware/wmata');
const TrainPosition = require('../models/TrainPosition');
const RailOccupancy = require('../models/RailOccupancy');
const TripUpdate = require('../models/TripUpdate');
const { getTrainPositions } = require('../assistant/toolHandlers/getTrainPositions');
const { enrichTrainsWithOccupancy } = require('../lib/occupancyEnricher');
const { enrichWithTripUpdates } = require('../lib/tripUpdateEnricher');

const GTFS_ENABLED = process.env.GTFS_RAIL_OCCUPANCY === 'true';
const GTFS_TRIP_UPDATES_ENABLED = process.env.GTFS_RAIL_TRIP_UPDATES === 'true';

const VALID_LINES = new Set(['RD', 'BL', 'OR', 'GR', 'YL', 'SV']);

// Trip updates snapshot
router.get('/trip-updates', async (req, res) => {
  if (!GTFS_TRIP_UPDATES_ENABLED) {
    return res.status(503).json({ error: 'GTFS_RAIL_TRIP_UPDATES not enabled' });
  }
  try {
    const { line } = req.query;
    let doc = await TripUpdate.findOne().sort({ snapshotAt: -1 }).lean();
    if (!doc) return res.json({ snapshotAt: null, feedTimestamp: null, trips: [] });
    let trips = doc.trips ?? [];
    if (line) {
      const code = line.toUpperCase();
      trips = trips.filter(t => t.lineCode === code);
    }
    res.json({ snapshotAt: doc.snapshotAt, feedTimestamp: doc.feedTimestamp, trips });
  } catch (err) {
    console.error('[trains/trip-updates]', err.message);
    res.status(500).json({ error: 'Internal server error' });
  }
});

// Enriched located trains (human-readable location + destination)
router.get('/located', async (req, res) => {
  const { line } = req.query;
  if (line !== undefined && !VALID_LINES.has(line.toUpperCase())) {
    return res.status(400).json({ error: 'line must be one of RD, BL, OR, GR, YL, SV' });
  }
  try {
    const data = await getTrainPositions(line ? { line } : undefined);
    res.json(data);
  } catch (err) {
    console.error('[trains/located]', err.message);
    res.status(500).json({ error: 'Internal server error' });
  }
});

// Live
router.get('/live', async (req, res) => {
  try {
    const { data } = await wmataClient.get('/TrainPositions/TrainPositions?contentType=json');
    let trains = await enrichTrainsWithOccupancy(
      data.TrainPositions ?? [],
      'TrainId',
      GTFS_ENABLED,
      () => RailOccupancy.findOne().sort({ snapshotAt: -1 }).lean(),
    );
    trains = await enrichWithTripUpdates(
      trains,
      'TrainId',
      GTFS_TRIP_UPDATES_ENABLED,
      () => TripUpdate.findOne().sort({ snapshotAt: -1 }).lean(),
    );
    res.json({ ...data, TrainPositions: trains });
  } catch (err) {
    res.status(502).json({ error: err.message });
  }
});

// Historical
router.get('/history', async (req, res) => {
  try {
    const { from, to, line } = req.query;
    const filter = {};
    if (from || to) {
      filter.snapshotAt = {};
      if (from) filter.snapshotAt.$gte = new Date(from);
      if (to) filter.snapshotAt.$lte = new Date(to);
    }
    if (line) filter.LineCode = line.toUpperCase();
    const data = await TrainPosition.find(filter).sort({ snapshotAt: -1 }).limit(10000);
    res.json(data);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

module.exports = router;
