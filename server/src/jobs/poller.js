const cron = require('node-cron');
const { wmataClient } = require('../middleware/wmata');
const Incident = require('../models/Incident');
const TrainPosition = require('../models/TrainPosition');
const ElevatorOutage = require('../models/ElevatorOutage');
const AdherenceSnapshot = require('../models/AdherenceSnapshot');
const BusPosition = require('../models/BusPosition');
const BusIncident = require('../models/BusIncident');
const railGeometry = require('../lib/railGeometry');

function computeAdherence(trainPositions, standardRoutes) {
  const { circuitMap, routeLen } = railGeometry.buildRouteMaps(standardRoutes);

  // Keep only Normal-service trains with a resolvable circuit sequence
  const withSeq = trainPositions
    .filter(t => t.LineCode && t.DirectionNum && t.CircuitId && t.ServiceType === 'Normal')
    .map(t => {
      const seq = circuitMap[t.LineCode]?.[t.DirectionNum]?.get(t.CircuitId);
      return seq !== undefined ? { ...t, currentSeq: seq } : null;
    })
    .filter(Boolean);

  // Group by line + direction (track)
  const groups = {};
  for (const t of withSeq) {
    const key = `${t.LineCode}_${t.DirectionNum}`;
    (groups[key] = groups[key] || []).push(t);
  }

  const trains = [];
  for (const [key, group] of Object.entries(groups)) {
    const [lineCode, dirStr] = key.split('_');
    const trackNum = parseInt(dirStr, 10);
    const len = routeLen[lineCode]?.[trackNum] || 100;

    group.sort((a, b) => a.currentSeq - b.currentSeq);
    const spacing = len / (group.length + 1);
    const minorThreshold = spacing * 0.10;
    const significantThreshold = spacing * 0.25;

    group.forEach((t, i) => {
      const expectedSeq = Math.round(spacing * (i + 1));
      const deviation = t.currentSeq - expectedSeq;
      const abs = Math.abs(deviation);
      const status = abs <= minorThreshold ? 'on-time' : abs <= significantThreshold ? 'minor' : 'significant';

      trains.push({
        trainId: t.TrainId,
        trainNumber: t.TrainNumber,
        lineCode: t.LineCode,
        directionNum: t.DirectionNum,
        circuitId: t.CircuitId,
        currentSeq: t.currentSeq,
        expectedSeq,
        deviation,
        status,
        carCount: t.CarCount,
        destinationCode: t.DestinationStationCode ?? t.DestinationCode ?? null,
      });
    });
  }

  // Roll up global + per-line summaries
  const summary = { total: 0, onTime: 0, minor: 0, significant: 0 };
  const byLine = {};

  for (const t of trains) {
    summary.total++;
    if (t.status === 'on-time') summary.onTime++;
    else if (t.status === 'minor') summary.minor++;
    else summary.significant++;

    if (!byLine[t.lineCode]) byLine[t.lineCode] = { lineCode: t.lineCode, total: 0, onTime: 0, minor: 0, significant: 0 };
    byLine[t.lineCode].total++;
    if (t.status === 'on-time') byLine[t.lineCode].onTime++;
    else if (t.status === 'minor') byLine[t.lineCode].minor++;
    else byLine[t.lineCode].significant++;
  }

  return { trains, summary, lineSummaries: Object.values(byLine) };
}

async function fetchAndStore() {
  const snapshotAt = new Date();

  try {
    const [incRes, trainRes, elevRes, busPositionsRes, busIncidentsRes] = await Promise.allSettled([
      wmataClient.get('/Incidents.svc/json/Incidents'),
      wmataClient.get('/TrainPositions/TrainPositions?contentType=json'),
      wmataClient.get('/Incidents.svc/json/ElevatorIncidents'),
      wmataClient.get('/Bus.svc/json/jBusPositions'),
      wmataClient.get('/Incidents.svc/json/BusIncidents'),
    ]);

    if (incRes.status === 'fulfilled') {
      const incidents = (incRes.value.data.Incidents || []).map(i => ({ ...i, snapshotAt }));
      if (incidents.length) await Incident.insertMany(incidents);
    } else {
      console.error('Incidents fetch error:', incRes.reason?.message);
    }

    let trainPositions = [];
    if (trainRes.status === 'fulfilled') {
      trainPositions = trainRes.value.data.TrainPositions || [];
      const trains = trainPositions.map(t => ({ ...t, snapshotAt }));
      if (trains.length) await TrainPosition.insertMany(trains);
    } else {
      console.error('Train positions fetch error:', trainRes.reason?.message);
    }

    if (elevRes.status === 'fulfilled') {
      const outages = (elevRes.value.data.ElevatorIncidents || []).map(e => ({ ...e, snapshotAt }));
      if (outages.length) await ElevatorOutage.insertMany(outages);
    } else {
      console.error('Elevator outages fetch error:', elevRes.reason?.message);
    }

    if (busPositionsRes.status === 'fulfilled') {
      const busPositions = (busPositionsRes.value.data.BusPositions || []).map(p => ({ ...p, snapshotAt }));
      if (busPositions.length) await BusPosition.insertMany(busPositions);
    } else {
      console.error('Bus positions fetch error:', busPositionsRes.reason?.message);
    }

    if (busIncidentsRes.status === 'fulfilled') {
      const busIncidents = (busIncidentsRes.value.data.BusIncidents || []).map(i => ({ ...i, snapshotAt }));
      if (busIncidents.length) await BusIncident.insertMany(busIncidents);
      console.log(`[poller] Bus incidents from WMATA: ${busIncidents.length}`);
    } else {
      console.error('Bus incidents fetch error:', busIncidentsRes.reason?.message);
    }

    // Compute and persist adherence if we have train positions
    if (trainPositions.length) {
      try {
        const standardRoutes = await railGeometry.getStandardRoutes();
        const adherence = computeAdherence(trainPositions, standardRoutes);
        await AdherenceSnapshot.create({ snapshotAt, ...adherence });
      } catch (err) {
        console.error('Adherence computation error:', err.message);
      }
    }

    console.log(`[${snapshotAt.toISOString()}] Snapshot stored`);
  } catch (err) {
    console.error('Polling error:', err.message);
  }
}

function startPolling() {
  fetchAndStore();
  cron.schedule('*/30 * * * * *', fetchAndStore);
}

module.exports = { startPolling, fetchAndStore };
