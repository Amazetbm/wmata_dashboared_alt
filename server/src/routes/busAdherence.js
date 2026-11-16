'use strict';

const router = require('express').Router();
const { getBusScheduleAdherence } = require('../assistant/toolHandlers/getBusScheduleAdherence');

const GTFS_BUS_TRIP_UPDATES = process.env.GTFS_BUS_TRIP_UPDATES === 'true';
const GTFS_BUS_SCHEDULE     = process.env.GTFS_BUS_SCHEDULE     === 'true';

// Unified summary endpoint for bus schedule adherence — mirrors /api/adherence/summary
router.get('/summary', async (req, res) => {
  const { method = 'schedule', mode = 'live', route } = req.query;
  let { from, to, days } = req.query;

  if (method !== 'schedule')
    return res.status(400).json({ error: 'method must be schedule' });
  if (!['live', 'history', 'snapshot'].includes(mode))
    return res.status(400).json({ error: 'mode must be live, history, or snapshot' });
  if (!GTFS_BUS_TRIP_UPDATES || !GTFS_BUS_SCHEDULE)
    return res.status(503).json({ error: 'GTFS_BUS_TRIP_UPDATES and GTFS_BUS_SCHEDULE must both be enabled' });

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
    const data = await getBusScheduleAdherence({ mode, route, from, to });
    if (data === null)
      return res.status(503).json({ error: 'No bus schedule adherence snapshot available yet' });
    res.json(data);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

module.exports = router;
