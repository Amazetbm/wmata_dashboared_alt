const router = require('express').Router();
const snapshotCache = require('../lib/snapshotCache');
const ElevatorOutage = require('../models/ElevatorOutage');

// Live
router.get('/live', (req, res) => {
  const { data } = snapshotCache.get('elevators');
  const response = { ElevatorIncidents: data ?? [] };
  if (snapshotCache.isStale('elevators')) response.stale = true;
  res.json(response);
});

// Historical
router.get('/history', async (req, res) => {
  try {
    const { from, to } = req.query;
    const filter = {};
    if (from || to) {
      filter.snapshotAt = {};
      if (from) filter.snapshotAt.$gte = new Date(from);
      if (to) filter.snapshotAt.$lte = new Date(to);
    }
    const data = await ElevatorOutage.find(filter).sort({ snapshotAt: -1 }).limit(5000);
    res.json(data);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

module.exports = router;
