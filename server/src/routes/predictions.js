const router = require('express').Router();
const { wmataClient } = require('../middleware/wmata');

// Live next-train predictions for a station code (e.g. /api/predictions/A01)
router.get('/:stationCode', async (req, res) => {
  try {
    const { stationCode } = req.params;
    const { data } = await wmataClient.get(`/StationPrediction.svc/json/GetPrediction/${stationCode}`);
    res.json(data);
  } catch (err) {
    res.status(502).json({ error: err.message });
  }
});

module.exports = router;
