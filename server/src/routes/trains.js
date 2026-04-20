const router = require('express').Router();
const { wmataClient } = require('../middleware/wmata');
const TrainPosition = require('../models/TrainPosition');

// Live
router.get('/live', async (req, res) => {
  try {
    const { data } = await wmataClient.get('/TrainPositions/TrainPositions?contentType=json');
    res.json(data);
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
