const router = require('express').Router();
const { wmataClient } = require('../middleware/wmata');
const ElevatorOutage = require('../models/ElevatorOutage');

// Live — proxy to WMATA and return full structured detail
router.get('/', async (req, res) => {
  try {
    const { data } = await wmataClient.get('/Incidents.svc/json/ElevatorIncidents');
    const outages = (data.ElevatorIncidents || []).map(o => ({
      UnitName: o.UnitName,
      UnitType: o.UnitType,
      StationCode: o.StationCode,
      StationName: o.StationName,
      LocationDescription: o.LocationDescription,
      SymptomDescription: o.SymptomDescription,
      TimeOutOfService: o.DateOutOfServ,
      EstimatedReturnToService: o.EstimatedReturnToService || null,
      DateUpdated: o.DateUpdated,
    }));
    res.json(outages);
  } catch (err) {
    res.status(502).json({ error: err.message });
  }
});

// History — deduplicated outage records + per-day chart breakdown
router.get('/history', async (req, res) => {
  try {
    const { from, to } = req.query;
    const filter = {};
    if (from || to) {
      filter.snapshotAt = {};
      if (from) filter.snapshotAt.$gte = new Date(from);
      if (to)   filter.snapshotAt.$lte = new Date(to);
    }

    const docs = await ElevatorOutage
      .find(filter, {
        UnitName: 1, UnitType: 1, StationCode: 1, StationName: 1,
        LocationDescription: 1, SymptomDescription: 1,
        DateOutOfServ: 1, TimeOutOfService: 1, EstimatedReturnToService: 1,
        DateUpdated: 1, snapshotAt: 1, _id: 0,
      })
      .sort({ snapshotAt: 1 })
      .lean();

    // One record per UnitName — keep the latest snapshot's data
    const outagemap = new Map();
    for (const doc of docs) {
      outagemap.set(doc.UnitName, doc);
    }

    // ADA concern: station had both ELEVATOR and ESCALATOR out anywhere in the range
    const elevStations = new Set(docs.filter(d => d.UnitType === 'ELEVATOR').map(d => d.StationCode));
    const escStations  = new Set(docs.filter(d => d.UnitType === 'ESCALATOR').map(d => d.StationCode));
    const adaStations  = new Set([...elevStations].filter(s => escStations.has(s)));

    const outages = Array.from(outagemap.values()).map(o => ({
      ...o,
      // Normalise: use DateOutOfServ (full ISO datetime) with fallback to the
      // legacy TimeOutOfService field (HHMM string) for documents stored before this fix.
      TimeOutOfService: o.DateOutOfServ || o.TimeOutOfService,
      adaConcern: adaStations.has(o.StationCode),
    }));

    // Per-day chart: count distinct UnitNames per day by type
    const dayMap = new Map();
    for (const doc of docs) {
      const day = (doc.snapshotAt instanceof Date ? doc.snapshotAt : new Date(doc.snapshotAt))
        .toISOString()
        .slice(0, 10);
      if (!dayMap.has(day)) dayMap.set(day, { elevators: new Set(), escalators: new Set() });
      const entry = dayMap.get(day);
      if ((doc.UnitType || '').toUpperCase() === 'ELEVATOR') entry.elevators.add(doc.UnitName);
      else entry.escalators.add(doc.UnitName);
    }

    const chartData = Array.from(dayMap.entries())
      .sort(([a], [b]) => a.localeCompare(b))
      .map(([date, { elevators, escalators }]) => ({
        date,
        elevators: elevators.size,
        escalators: escalators.size,
      }));

    res.json({ outages, chartData });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

module.exports = router;
