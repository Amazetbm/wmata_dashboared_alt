const router = require('express').Router();
const { wmataClient } = require('../middleware/wmata');

const predCache   = new Map(); // stationCode → { data, cachedAt }
const PRED_TTL_MS = 25_000;

// Live next-train predictions for a station code (e.g. /api/predictions/A01)
router.get('/:stationCode', async (req, res) => {
  const { stationCode } = req.params;

  const cached = predCache.get(stationCode);
  if (cached && Date.now() - cached.cachedAt < PRED_TTL_MS) {
    return res.json(cached.data);
  }

  try {
    const { data } = await wmataClient.get(`/StationPrediction.svc/json/GetPrediction/${stationCode}`);
    predCache.set(stationCode, { data, cachedAt: Date.now() });
    res.json(data);
  } catch (err) {
    res.status(502).json({ error: err.message });
  }
});

module.exports = router;
