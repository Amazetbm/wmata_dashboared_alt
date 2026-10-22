'use strict';

const { wmataClient } = require('../../middleware/wmata');
const ElevatorOutage = require('../../models/ElevatorOutage');

async function getElevatorOutages({ mode = 'live', from, to, station_code } = {}) {
  if (mode === 'live') {
    const { data } = await wmataClient.get('/Incidents.svc/json/ElevatorIncidents');
    let outages = (data.ElevatorIncidents || []).map(o => ({
      unitName:   o.UnitName,
      unitType:   o.UnitType,
      stationCode: o.StationCode,
      stationName: o.StationName,
      description: o.SymptomDescription,
      outSince:   o.DateOutOfServ,
      returnETA:  o.EstimatedReturnToService || null,
    }));
    if (station_code) outages = outages.filter(o => o.stationCode === station_code.toUpperCase());
    return { total: outages.length, outages: outages.slice(0, 10) };
  }

  // History mode — reuses deduplication + ADA concern logic from routes/outages.js
  const filter = {};
  if (from || to) {
    filter.snapshotAt = {};
    if (from) filter.snapshotAt.$gte = new Date(from);
    if (to)   filter.snapshotAt.$lte = new Date(to);
  }
  if (station_code) filter.StationCode = station_code.toUpperCase();

  const docs = await ElevatorOutage
    .find(filter, {
      UnitName: 1, UnitType: 1, StationCode: 1, StationName: 1,
      SymptomDescription: 1, DateOutOfServ: 1, snapshotAt: 1, _id: 0,
    })
    .sort({ snapshotAt: 1 })
    .lean();

  // ADA concern: station had both ELEVATOR and ESCALATOR out anywhere in the range
  const elevStations = new Set(docs.filter(d => d.UnitType === 'ELEVATOR').map(d => d.StationCode));
  const escStations  = new Set(docs.filter(d => d.UnitType === 'ESCALATOR').map(d => d.StationCode));
  const adaStations  = [...elevStations].filter(s => escStations.has(s));

  // Deduplicate by UnitName — keep latest snapshot's data
  const unitMap = new Map();
  for (const d of docs) unitMap.set(d.UnitName, d);

  const outages = Array.from(unitMap.values()).slice(0, 10).map(o => ({
    unitName:    o.UnitName,
    unitType:    o.UnitType,
    stationCode: o.StationCode,
    stationName: o.StationName,
    description: o.SymptomDescription,
    adaConcern:  adaStations.includes(o.StationCode),
  }));

  return { total: unitMap.size, adaStations, outages };
}

module.exports = { getElevatorOutages };
