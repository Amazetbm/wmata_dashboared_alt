'use strict';

const router = require('express').Router();
const BusScheduleAdherenceSnapshot = require('../models/BusScheduleAdherenceSnapshot');

const isEnabled = () =>
  process.env.GTFS_BUS_TRIP_UPDATES === 'true' && process.env.GTFS_BUS_SCHEDULE === 'true';

// Most recent snapshot — full detail including buses array.
// buses is only populated every 5 fetch cycles (~5 min), so if the latest snapshot
// has an empty buses array, fall back to the most recent snapshot that has buses.
// Optional ?route= filter: narrows buses array and replaces summary with per-route summary.
router.get('/live', async (req, res) => {
  if (!isEnabled()) {
    return res.status(503).json({ error: 'Bus schedule adherence not enabled on this server' });
  }
  try {
    const snapshot = await BusScheduleAdherenceSnapshot.findOne().sort({ snapshotAt: -1 }).lean();
    if (!snapshot) {
      return res.status(503).json({ error: 'No bus schedule adherence snapshot available yet' });
    }

    let buses = snapshot.buses ?? [];
    let busDetailAt = snapshot.busDetailAt ?? null;
    if (!buses.length) {
      const withDetail = await BusScheduleAdherenceSnapshot
        .findOne({ 'buses.0': { $exists: true } })
        .sort({ snapshotAt: -1 })
        .select('buses busDetailAt')
        .lean();
      buses      = withDetail?.buses    ?? [];
      busDetailAt = withDetail?.busDetailAt ?? null;
    }

    const { route } = req.query;
    if (route) {
      const routeId = route.toUpperCase();
      const filteredBuses = buses.filter(b => b.routeId === routeId);
      const rs = (snapshot.routeSummaries || []).find(r => r.routeId === routeId);
      const summary = rs || { total: 0, early: 0, onTime: 0, minor: 0, significant: 0, noPrediction: 0, canceled: 0, unscheduled: 0, added: 0 };
      return res.json({ ...snapshot, buses: filteredBuses, busDetailAt, summary });
    }

    res.json({ ...snapshot, buses, busDetailAt });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// Historical time-range — returns bucketed summary data for charting.
// Buckets: 5 min for ≤24h ranges, 1 h for longer ranges (default 24h when no range given).
// Optional ?route= filter applies unwind/match on routeSummaries inside the pipeline.
// Buckets with zero predictions (early+onTime+minor+significant === 0) are dropped.
router.get('/history', async (req, res) => {
  if (!isEnabled()) {
    return res.status(503).json({ error: 'Bus schedule adherence not enabled on this server' });
  }
  try {
    const exists = await BusScheduleAdherenceSnapshot.findOne({}, { _id: 1 }).lean();
    if (!exists) {
      return res.status(503).json({ error: 'No bus schedule adherence snapshot available yet' });
    }

    const { from, to, route } = req.query;
    const fromMs = from ? new Date(from).getTime() : null;
    const toMs   = to   ? new Date(to).getTime()   : null;
    const rangeMs  = (fromMs && toMs) ? (toMs - fromMs) : 24 * 3_600_000;
    const bucketMs = rangeMs <= 24 * 3_600_000 ? 300_000 : 3_600_000;

    const filter = {};
    if (from || to) {
      filter.snapshotAt = {};
      if (from) filter.snapshotAt.$gte = new Date(from);
      if (to)   filter.snapshotAt.$lte = new Date(to);
    }

    const bucketExpr = {
      $subtract: [
        { $toLong: '$snapshotAt' },
        { $mod: [{ $toLong: '$snapshotAt' }, bucketMs] },
      ],
    };

    let pipeline;
    if (route) {
      pipeline = [
        { $match: filter },
        { $unwind: '$routeSummaries' },
        { $match: { 'routeSummaries.routeId': route.toUpperCase() } },
        { $group: {
          _id:          bucketExpr,
          total:        { $avg: '$routeSummaries.total' },
          early:        { $avg: '$routeSummaries.early' },
          onTime:       { $avg: '$routeSummaries.onTime' },
          minor:        { $avg: '$routeSummaries.minor' },
          significant:  { $avg: '$routeSummaries.significant' },
          noPrediction: { $avg: '$routeSummaries.noPrediction' },
          coverageRate: { $avg: '$coverageRate' },
          degraded:     { $last: '$degraded' },
        }},
        { $sort: { _id: 1 } },
      ];
    } else {
      pipeline = [
        { $match: filter },
        { $group: {
          _id:          bucketExpr,
          total:        { $avg: '$summary.total' },
          early:        { $avg: '$summary.early' },
          onTime:       { $avg: '$summary.onTime' },
          minor:        { $avg: '$summary.minor' },
          significant:  { $avg: '$summary.significant' },
          noPrediction: { $avg: '$summary.noPrediction' },
          canceled:     { $avg: '$summary.canceled' },
          unscheduled:  { $avg: '$summary.unscheduled' },
          added:        { $avg: '$summary.added' },
          coverageRate: { $avg: '$coverageRate' },
          degraded:     { $last: '$degraded' },
        }},
        { $sort: { _id: 1 } },
      ];
    }

    const buckets = await BusScheduleAdherenceSnapshot.aggregate(pipeline);

    const result = buckets
      .map(b => {
        const summary = {
          total:        Math.round(b.total        ?? 0),
          early:        Math.round(b.early        ?? 0),
          onTime:       Math.round(b.onTime       ?? 0),
          minor:        Math.round(b.minor        ?? 0),
          significant:  Math.round(b.significant  ?? 0),
          noPrediction: Math.round(b.noPrediction ?? 0),
          ...(!route ? {
            canceled:    Math.round(b.canceled    ?? 0),
            unscheduled: Math.round(b.unscheduled ?? 0),
            added:       Math.round(b.added       ?? 0),
          } : {}),
        };
        return {
          snapshotAt:  new Date(b._id).toISOString(),
          summary,
          coverageRate: b.coverageRate ?? null,
          degraded:     b.degraded ?? false,
        };
      })
      .filter(b => {
        const { early, onTime, minor, significant } = b.summary;
        return (early + onTime + minor + significant) > 0;
      });

    res.json(result);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// Single closest snapshot with full buses array — used for drill-down
router.get('/snapshot', async (req, res) => {
  if (!isEnabled()) {
    return res.status(503).json({ error: 'Bus schedule adherence not enabled on this server' });
  }
  try {
    const target = new Date(req.query.at);
    const [before, after] = await Promise.all([
      BusScheduleAdherenceSnapshot.findOne({ snapshotAt: { $lte: target } }).sort({ snapshotAt: -1 }).lean(),
      BusScheduleAdherenceSnapshot.findOne({ snapshotAt: { $gte: target } }).sort({ snapshotAt:  1 }).lean(),
    ]);
    let closest = before;
    if (after && (!before || Math.abs(after.snapshotAt - target) < Math.abs(before.snapshotAt - target))) {
      closest = after;
    }
    if (!closest) {
      return res.status(503).json({ error: 'No bus schedule adherence snapshot available yet' });
    }
    res.json(closest);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

module.exports = router;
