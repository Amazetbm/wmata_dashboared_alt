const cron = require('node-cron');
const { wmataClient } = require('../middleware/wmata');
const Incident = require('../models/Incident');
const TrainPosition = require('../models/TrainPosition');
const ElevatorOutage = require('../models/ElevatorOutage');
const AdherenceSnapshot = require('../models/AdherenceSnapshot');

// Standard routes rarely change — refresh every 10 minutes
let cachedRoutes = null;
let routesCachedAt = 0;
const ROUTES_TTL_MS = 10 * 60 * 1000;

async function getStandardRoutes() {
  if (cachedRoutes && Date.now() - routesCachedAt < ROUTES_TTL_MS) return cachedRoutes;
  const { data } = await wmataClient.get('/TrainPositions/StandardRoutes?contentType=json');
  cachedRoutes = data.StandardRoutes || [];
  routesCachedAt = Date.now();
  return cachedRoutes;
}

// Build circuit-id → seqNum lookup per line+track, return alongside route lengths
function buildRouteMaps(standardRoutes) {
  const circuitMap = {};  // lineCode -> trackNum -> Map<circuitId, seqNum>
  const routeLen = {};    // lineCode -> trackNum -> total circuits

  for (const route of standardRoutes) {
    const { LineCode, TrackNum, TrackCircuits } = route;
    if (!LineCode || !TrackNum || !Array.isArray(TrackCircuits)) continue;

    if (!circuitMap[LineCode]) { circuitMap[LineCode] = {}; routeLen[LineCode] = {}; }

    const m = new Map();
    for (const tc of TrackCircuits) m.set(tc.CircuitId, tc.SeqNum);
    circuitMap[LineCode][TrackNum] = m;
    routeLen[LineCode][TrackNum] = TrackCircuits.length;
  }
  return { circuitMap, routeLen };
}

function computeAdherence(trainPositions, standardRoutes) {
  const { circuitMap, routeLen } = buildRouteMaps(standardRoutes);

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

    group.forEach((t, i) => {
      const expectedSeq = Math.round(spacing * (i + 1));
      const deviation = t.currentSeq - expectedSeq;
      const abs = Math.abs(deviation);
      const status = abs <= 2 ? 'on-time' : abs <= 5 ? 'minor' : 'significant';

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
    const [incRes, trainRes, elevRes] = await Promise.allSettled([
      wmataClient.get('/Incidents.svc/json/Incidents'),
      wmataClient.get('/TrainPositions/TrainPositions?contentType=json'),
      wmataClient.get('/Incidents.svc/json/ElevatorIncidents'),
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

    // Compute and persist adherence if we have train positions
    if (trainPositions.length) {
      try {
        const standardRoutes = await getStandardRoutes();
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
