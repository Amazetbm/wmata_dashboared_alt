'use strict';

const router = require('express').Router();
const BusScheduleAdherenceSnapshot = require('../models/BusScheduleAdherenceSnapshot');

// Most recent snapshot — full detail including buses array.
// buses is only populated every 5 fetch cycles (~5 min), so if the latest snapshot
// has an empty buses array, fall back to the most recent snapshot that has buses.
router.get('/live', async (req, res) => {
  try {
    const snapshot = await BusScheduleAdherenceSnapshot.findOne().sort({ snapshotAt: -1 }).lean();
    if (!snapshot) return res.json({ buses: [], summary: {}, routeSummaries: [], coverageRate: null, degraded: false });

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

    res.json({ ...snapshot, buses, busDetailAt });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// Historical time-range — returns summary data only (no buses array) for charting.
// Optional ?route= filter applies to routeSummaries selection.
router.get('/history', async (req, res) => {
  try {
    const { from, to, route } = req.query;
    const filter = {};
    if (from || to) {
      filter.snapshotAt = {};
      if (from) filter.snapshotAt.$gte = new Date(from);
      if (to)   filter.snapshotAt.$lte = new Date(to);
    }

    const snapshots = await BusScheduleAdherenceSnapshot
      .find(filter, { snapshotAt: 1, summary: 1, routeSummaries: 1, coverageRate: 1, degraded: 1, _id: 0 })
      .sort({ snapshotAt: 1 })
      .limit(2000)
      .lean();

    const result = snapshots.map(s => {
      if (!route) return s;
      const rs = (s.routeSummaries || []).find(r => r.routeId === route.toUpperCase());
      return {
        snapshotAt: s.snapshotAt,
        summary: rs || { total: 0, early: 0, onTime: 0, minor: 0, significant: 0, noPrediction: 0, canceled: 0, unscheduled: 0, added: 0 },
        routeSummaries: s.routeSummaries,
        coverageRate: s.coverageRate,
        degraded: s.degraded,
      };
    });

    res.json(result);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// Single closest snapshot with full buses array — used for drill-down
router.get('/snapshot', async (req, res) => {
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
    res.json(closest || null);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

module.exports = router;
