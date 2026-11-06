const router = require('express').Router();
const AdherenceSnapshot = require('../models/AdherenceSnapshot');
const { getScheduleAdherence } = require('../assistant/toolHandlers/getScheduleAdherence');

const GTFS_RAIL_TRIP_UPDATES = process.env.GTFS_RAIL_TRIP_UPDATES === 'true';
const GTFS_RAIL_SCHEDULE     = process.env.GTFS_RAIL_SCHEDULE     === 'true';

// Most recent snapshot — full detail including trains array
router.get('/live', async (req, res) => {
  try {
    const snapshot = await AdherenceSnapshot.findOne().sort({ snapshotAt: -1 }).lean();
    if (!snapshot) return res.json({ trains: [], summary: {}, lineSummaries: [] });
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
      if (to) filter.snapshotAt.$lte = new Date(to);
    }

    const snapshots = await AdherenceSnapshot
      .find(filter, { snapshotAt: 1, summary: 1, lineSummaries: 1, _id: 0 })
      .sort({ snapshotAt: 1 })
      .limit(2000)
      .lean();

    // If a line filter is requested, substitute the per-line counts as the summary
    const result = snapshots.map(s => {
      if (!line) return s;
      const ls = (s.lineSummaries || []).find(l => l.lineCode === line.toUpperCase());
      return { snapshotAt: s.snapshotAt, summary: ls || { total: 0, onTime: 0, minor: 0, significant: 0 }, lineSummaries: s.lineSummaries };
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
      AdherenceSnapshot.findOne({ snapshotAt: { $lte: target } }).sort({ snapshotAt: -1 }).lean(),
      AdherenceSnapshot.findOne({ snapshotAt: { $gte: target } }).sort({ snapshotAt: 1 }).lean(),
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

// Unified summary endpoint for both headway and schedule adherence
router.get('/summary', async (req, res) => {
  const { method = 'headway', mode = 'live', line } = req.query;
  let { from, to, days } = req.query;

  if (!['headway', 'schedule'].includes(method))
    return res.status(400).json({ error: 'method must be headway or schedule' });
  if (!['live', 'history', 'snapshot'].includes(mode))
    return res.status(400).json({ error: 'mode must be live, history, or snapshot' });
  if (method === 'schedule' && (!GTFS_RAIL_TRIP_UPDATES || !GTFS_RAIL_SCHEDULE))
    return res.status(503).json({ error: 'GTFS_RAIL_TRIP_UPDATES and GTFS_RAIL_SCHEDULE must both be enabled' });

  if (mode === 'history') {
    if (from || to) {
      if (!from || !to)
        return res.status(400).json({ error: 'from and to are both required when either is provided' });
      const f = new Date(from), t = new Date(to);
      if (isNaN(f) || isNaN(t))
        return res.status(400).json({ error: 'from and to must be valid ISO 8601 dates' });
      if (f >= t)
        return res.status(400).json({ error: 'from must be before to' });
    } else {
      const daysNum = Number(days);
      if (!days || !Number.isFinite(daysNum) || daysNum <= 0 || !Number.isInteger(daysNum))
        return res.status(400).json({ error: 'days must be a positive integer when from/to are not provided' });
      const toDate = new Date();
      from = new Date(toDate.getTime() - daysNum * 24 * 60 * 60 * 1000).toISOString();
      to = toDate.toISOString();
    }
  }

  try {
    const data = await getScheduleAdherence({ method, mode, line, from, to });
    if (data === null)
      return res.status(503).json({ error: 'No schedule adherence snapshot available yet' });
    res.json(data);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

module.exports = router;
