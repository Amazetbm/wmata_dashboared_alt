'use strict';

const router = require('express').Router();
const { DateTime } = require('luxon');

const GtfsVersion = require('../models/GtfsVersion');
const GtfsStop = require('../models/GtfsStop');
const GtfsTrip = require('../models/GtfsTrip');
const GtfsStopTime = require('../models/GtfsStopTime');
const {
  getActiveVersionId,
  getActiveServiceIds,
  getScheduledDepartures,
} = require('../lib/gtfsStatic/schedule');
const { loadGtfsStatic } = require('../lib/gtfsStatic/loader');

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

    const [stopCount, tripCount, serviceIdsResult] = await Promise.all([
      GtfsStop.countDocuments({ version: version._id }),
      GtfsTrip.countDocuments({ version: version._id }),
      getActiveServiceIds(todayEastern(), version._id).then(ids => ({ ok: true, value: ids })).catch(() => ({ ok: false })),
    ]);

    const coversToday = serviceIdsResult.ok ? serviceIdsResult.value.length > 0 : false;
    const metaReady = !!version.meta?.computedAt;
    const mappedCount = version.meta?.stationsMappedCount ?? 0;
    const stationsMapped = { mapped: mappedCount, total: mappedCount };

    function isoDate(yyyymmdd) {
      if (!yyyymmdd) return null;
      return `${yyyymmdd.slice(0, 4)}-${yyyymmdd.slice(4, 6)}-${yyyymmdd.slice(6, 8)}`;
    }

    return res.json({
      enabled: true,
      loaded: true,
      feedDate: version.feedDate,
      loadedAt: version.loadedAt,
      feedVersion:    metaReady ? { id: version._id.toString(), gtfs: version.meta.feedVersion || null } : null,
      routeCount:     metaReady ? version.meta.routeCount  : null,
      stopCount,
      stopTimeCount:  metaReady ? version.meta.stopTimeCount  : null,
      frequencyCount: metaReady ? version.meta.frequencyCount : null,
      tripCount,
      serviceIdCount: metaReady ? version.meta.serviceIdCount : null,
      serviceDateRange: metaReady ? {
        start: isoDate(version.meta.serviceDateRange?.start),
        end:   isoDate(version.meta.serviceDateRange?.end),
      } : null,
      coversToday,
      stationsMapped: metaReady ? stationsMapped : null,
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

    // Check station exists — prefer locationType:1 (station) over 0 (platform).
    // Transfer stations (e.g. A01/C01) share one STN_ record; the secondary code
    // (C01) is only found as a platform stop (locationType:0).
    const stationStop = await GtfsStop.findOne({
      version: vid,
      wmataCode: code.toUpperCase(),
      locationType: { $in: [0, 1] },
    }).sort({ locationType: -1 }).lean();

    if (!stationStop) {
      return res.status(404).json({ error: `Station ${code} not found` });
    }

    // For platform stops, use the parent station name if available
    let stationName = stationStop.stopName;
    if (stationStop.locationType === 0 && stationStop.parentStation) {
      const parent = await GtfsStop.findOne({
        version: vid,
        stopId: stationStop.parentStation,
      }).lean();
      if (parent?.stopName) stationName = parent.stopName;
    }

    let departures = await getScheduledDepartures(code.toUpperCase(), localDate, vid);

    // Optional window filter: ?minutes=N returns only departures in the next N minutes
    const minutes = req.query.minutes != null ? parseInt(req.query.minutes, 10) : null;
    if (minutes != null && !isNaN(minutes) && minutes >= 0) {
      const nowEt = DateTime.now().setZone('America/New_York');
      const nowSec = nowEt.hour * 3600 + nowEt.minute * 60 + nowEt.second;
      const windowEnd = nowSec + minutes * 60;
      departures = departures.filter(d => d.departureSec >= nowSec && d.departureSec <= windowEnd);
    }

    return res.json({
      station: { code: code.toUpperCase(), name: stationName },
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

/**
 * POST /api/schedule/reload
 * Trigger a forced reload of the GTFS static feed (dev/ops tool).
 * Fire-and-forget — returns immediately while the load runs in the background.
 * Only available when GTFS_RAIL_SCHEDULE=true.
 */
router.post('/reload', (req, res) => {
  if (!isEnabled()) return res.status(503).json(DISABLED_RESP);
  loadGtfsStatic({ force: true })
    .then(r => console.log('[schedule/reload] Complete:', r))
    .catch(err => console.error('[schedule/reload] Failed:', err.message));
  return res.json({ message: 'Reload triggered' });
});

module.exports = router;
