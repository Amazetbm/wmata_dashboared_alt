'use strict';

const router = require('express').Router();
const ScheduleAdherenceSnapshot = require('../models/ScheduleAdherenceSnapshot');

// Most recent snapshot — full detail including trains array
router.get('/live', async (req, res) => {
  try {
    const snapshot = await ScheduleAdherenceSnapshot.findOne().sort({ snapshotAt: -1 }).lean();
    if (!snapshot) return res.json({ trains: [], summary: {}, lineSummaries: [], coverageRate: null, degraded: false });
    res.json(snapshot);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// Historical time-range — returns summary data only (no trains array) for charting.
// Optional ?line= filter applies to lineSummaries selection.
router.get('/history', async (req, res) => {
  try {
    const { from, to, line } = req.query;
    const filter = {};
    if (from || to) {
      filter.snapshotAt = {};
      if (from) filter.snapshotAt.$gte = new Date(from);
      if (to)   filter.snapshotAt.$lte = new Date(to);
    }

    const snapshots = await ScheduleAdherenceSnapshot
      .find(filter, { snapshotAt: 1, summary: 1, lineSummaries: 1, coverageRate: 1, degraded: 1, _id: 0 })
      .sort({ snapshotAt: 1 })
      .limit(2000)
      .lean();

    // If a line filter is requested, substitute the per-line counts as the summary
    const result = snapshots.map(s => {
      if (!line) return s;
      const ls = (s.lineSummaries || []).find(l => l.lineCode === line.toUpperCase());
      return {
        snapshotAt: s.snapshotAt,
        summary: ls || { total: 0, early: 0, onTime: 0, slightDelay: 0, delay: 0, significantDelay: 0, noPrediction: 0 },
        lineSummaries: s.lineSummaries,
        coverageRate: s.coverageRate,
        degraded: s.degraded,
      };
    });

    res.json(result);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// Single closest snapshot with full trains array — used for drill-down
router.get('/snapshot', async (req, res) => {
  try {
    const target = new Date(req.query.at);
    const [before, after] = await Promise.all([
      ScheduleAdherenceSnapshot.findOne({ snapshotAt: { $lte: target } }).sort({ snapshotAt: -1 }).lean(),
      ScheduleAdherenceSnapshot.findOne({ snapshotAt: { $gte: target } }).sort({ snapshotAt:  1 }).lean(),
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
