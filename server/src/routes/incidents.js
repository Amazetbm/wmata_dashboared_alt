const router = require('express').Router();
const snapshotCache = require('../lib/snapshotCache');
const Incident = require('../models/Incident');

// Live
router.get('/live', (req, res) => {
  const { data } = snapshotCache.get('incidents');
  const response = { Incidents: data ?? [] };
  if (snapshotCache.isStale('incidents')) response.stale = true;
  res.json(response);
});

// Historical with time-range filtering
router.get('/history', async (req, res) => {
  try {
    const { from, to } = req.query;
    const filter = {};
    if (from || to) {
      filter.snapshotAt = {};
      if (from) filter.snapshotAt.$gte = new Date(from);
      if (to) filter.snapshotAt.$lte = new Date(to);
    }
    const data = await Incident.find(filter).sort({ snapshotAt: -1 }).limit(5000);
    res.json(data);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

module.exports = router;
