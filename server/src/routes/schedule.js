'use strict';

const router = require('express').Router();
const { DateTime } = require('luxon');

const GtfsVersion = require('../models/GtfsVersion');
const GtfsStop = require('../models/GtfsStop');
const GtfsTrip = require('../models/GtfsTrip');
const GtfsStopTime = require('../models/GtfsStopTime');
const {
  getActiveVersionId,
  getScheduledDepartures,
} = require('../lib/gtfsStatic/schedule');

const DISABLED_RESP = { error: 'Schedule feature disabled' };

const isEnabled = () => process.env.GTFS_RAIL_SCHEDULE === 'true';

function todayEastern() {
  return DateTime.now().setZone('America/New_York').toFormat('yyyy-MM-dd');
}

/**
 * GET /api/schedule/status
 * Returns feature flag state plus basic stats about the loaded feed.
 */
router.get('/status', async (req, res) => {
  if (!isEnabled()) return res.status(503).json(DISABLED_RESP);

  try {
    const version = await GtfsVersion.findOne({ status: 'active' }).sort({ loadedAt: -1 }).lean();
    if (!version) {
      return res.json({ enabled: true, loaded: false });
    }
    const [stopCount, tripCount] = await Promise.all([
      GtfsStop.countDocuments({ version: version._id }),
      GtfsTrip.countDocuments({ version: version._id }),
    ]);
    return res.json({
      enabled: true,
      loaded: true,
      feedDate: version.feedDate,
      loadedAt: version.loadedAt,
      stopCount,
      tripCount,
    });
  } catch (err) {
    console.error('[schedule/status]', err.message);
    return res.status(500).json({ error: 'Internal server error' });
  }
});

/**
 * GET /api/schedule/station/:code
 * Returns scheduled departures at a station for a given date.
 * Query: ?date=YYYY-MM-DD  (defaults to today Eastern)
 */
router.get('/station/:code', async (req, res) => {
  if (!isEnabled()) return res.status(503).json(DISABLED_RESP);

  const { code } = req.params;
  const { date } = req.query;

  // Validate date if provided
  let localDate;
  if (date) {
    if (!/^\d{4}-\d{2}-\d{2}$/.test(date)) {
      return res.status(400).json({ error: 'date must be YYYY-MM-DD' });
    }
    localDate = date;
  } else {
    localDate = todayEastern();
  }

  try {
    const vid = await getActiveVersionId();
    if (!vid) {
      return res.json({
        station: { code, name: null },
        departures: [],
      });
    }

    // Check station exists
    const stationStop = await GtfsStop.findOne({
      version: vid,
      wmataCode: code.toUpperCase(),
      locationType: 1,
    }).lean();

    if (!stationStop) {
      return res.status(404).json({ error: `Station ${code} not found` });
    }

    const departures = await getScheduledDepartures(code.toUpperCase(), localDate, vid);

    return res.json({
      station: { code: code.toUpperCase(), name: stationStop.stopName },
      departures: departures.map(d => ({
        tripId: d.tripId,
        lineCode: d.lineCode,
        headsign: d.headsign,
        direction: d.direction,
        departureSec: d.departureSec,
        departureTime: d.departureTimeUtc.toISOString(),
      })),
    });
  } catch (err) {
    console.error('[schedule/station]', err.message);
    return res.status(500).json({ error: 'Internal server error' });
  }
});

module.exports = router;
