const cron = require('node-cron');
const { wmataClient } = require('../middleware/wmata');
const snapshotCache = require('../lib/snapshotCache');
const wmataUsage    = require('../lib/wmataUsage');
const Incident = require('../models/Incident');
const TrainPosition = require('../models/TrainPosition');
const ElevatorOutage = require('../models/ElevatorOutage');
const AdherenceSnapshot = require('../models/AdherenceSnapshot');
const BusPosition = require('../models/BusPosition');
const BusIncident = require('../models/BusIncident');
const RailOccupancy = require('../models/RailOccupancy');
const BusOccupancy = require('../models/BusOccupancy');
const TripUpdate = require('../models/TripUpdate');
const ScheduleAdherenceSnapshot = require('../models/ScheduleAdherenceSnapshot');
const GtfsVersion = require('../models/GtfsVersion');
const GtfsStopTime = require('../models/GtfsStopTime');
const railGeometry = require('../lib/railGeometry');
const { decodeVehiclePositions } = require('../lib/gtfsRt');
const { decodeTripUpdates } = require('../lib/gtfsRt/tripUpdateDecoder');
const { classifyDelay, classifyScheduleDelay3 } = require('../lib/tripUpdateEnricher');
const { parseGtfsTime, gtfsToUtc } = require('../lib/gtfsStatic/timeUtils');

const GTFS_RAIL_ENABLED = process.env.GTFS_RAIL_OCCUPANCY === 'true';
const GTFS_BUS_ENABLED  = process.env.GTFS_BUS_OCCUPANCY  === 'true';
const GTFS_TRIP_UPDATES_ENABLED = process.env.GTFS_RAIL_TRIP_UPDATES === 'true';
// Keep old name for any internal references below
const GTFS_ENABLED = GTFS_RAIL_ENABLED;

// Startup log
[
  'GTFS_RAIL_OCCUPANCY', 'GTFS_BUS_OCCUPANCY', 'GTFS_RAIL_SCHEDULE', 'GTFS_RAIL_TRIP_UPDATES',
  'SCHEDULE_EARLY_SEC', 'SCHEDULE_ONTIME_SEC', 'SCHEDULE_MINOR_SEC',
].forEach(k => console.log(`[poller] ${k}=${process.env[k] ?? '(unset)'}`));
if (GTFS_TRIP_UPDATES_ENABLED) {
  console.log(`[poller]   VP join: ${GTFS_RAIL_ENABLED ? 'ENABLED (rail VP feed)' : 'DISABLED (fallback to TU vehicle.id)'}`);
}

// State-change tracking for occupancy availability (null=unknown, true=available, false=unavailable)
let railOccupancyAvailable = null;
let busOccupancyAvailable  = null;

/**
 * Compute a schedule adherence snapshot from enriched trip objects
 * (after VP join and delay computation).  Pure function — no DB.
 *
 * Trips are bucketed by scheduleRelationship first:
 *   SR=3 (CANCELED)     → canceled counter
 *   SR=2 (UNSCHEDULED)  → unscheduled counter
 *   SR=1 (ADDED)        → added counter
 *   SR=0/null (SCHEDULED) → 3-bucket delay classification
 *
 * summary.total counts SCHEDULED trips only.
 *
 * @param {object[]} rawTrips    - decoded trips with trainId/vehicleId/delaySeconds/delayLabel/scheduleRelationship
 * @param {boolean}  degraded
 * @param {number}   coverageRate  - fraction [0,1] of trips matched to static schedule
 * @returns {object}  Payload for ScheduleAdherenceSnapshot.create (minus snapshotAt/feedTimestamp)
 */
function computeScheduleAdherence(rawTrips, degraded, coverageRate) {
  const summary = {
    total: 0, early: 0, onTime: 0, minor: 0, significant: 0,
    noPrediction: 0, canceled: 0, unscheduled: 0, added: 0,
  };
  const byLine  = {};
  const trainRecords = [];

  function ensureLine(lineCode) {
    if (!byLine[lineCode]) {
      byLine[lineCode] = {
        lineCode,
        total: 0, early: 0, onTime: 0, minor: 0, significant: 0,
        noPrediction: 0, canceled: 0, unscheduled: 0, added: 0,
      };
    }
    return byLine[lineCode];
  }

  for (const trip of rawTrips) {
    const sr = trip.scheduleRelationship ?? 0;
    const lineCode = trip.lineCode;

    if (sr === 3) {
      summary.canceled++;
      if (lineCode) ensureLine(lineCode).canceled++;
    } else if (sr === 2) {
      summary.unscheduled++;
      if (lineCode) ensureLine(lineCode).unscheduled++;
    } else if (sr === 1) {
      summary.added++;
      if (lineCode) ensureLine(lineCode).added++;
    } else {
      // SCHEDULED (sr=0 or null)
      summary.total++;
      if (lineCode) ensureLine(lineCode).total++;

      if (trip.delaySeconds != null) {
        const bucket = classifyScheduleDelay3(trip.delaySeconds);
        summary[bucket]++;
        if (lineCode) ensureLine(lineCode)[bucket]++;
      } else {
        summary.noPrediction++;
        if (lineCode) ensureLine(lineCode).noPrediction++;
      }

      if (trip.trainId) {
        trainRecords.push({
          trainId:         trip.trainId,
          trainNumber:     null,
          lineCode:        trip.lineCode,
          directionNum:    null,
          circuitId:       null,
          tripId:          trip.tripId ?? null,
          delaySeconds:    trip.delaySeconds ?? null,
          delayLabel:      trip.delayLabel ?? null,
          destinationCode: null,
        });
      }
    }
  }

  const withDelay = trainRecords.filter(t => t.delaySeconds !== null).length;
  console.log(`[poller] Schedule adherence: ${summary.total} scheduled, ${withDelay} with delay, canceled=${summary.canceled}, degraded=${degraded}`);

  return {
    summary,
    lineSummaries: Object.values(byLine),
    trains:        trainRecords,
    coverageRate,
    degraded,
  };
}

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

  // Will be populated by VP block if GTFS_RAIL_ENABLED; used by TU block
  let tripToTrainMap = new Map();

  try {
    const feeds = [
      wmataClient.get('/Incidents.svc/json/Incidents'),
      wmataClient.get('/TrainPositions/TrainPositions?contentType=json'),
      wmataClient.get('/Incidents.svc/json/ElevatorIncidents'),
      wmataClient.get('/Bus.svc/json/jBusPositions'),
      wmataClient.get('/Incidents.svc/json/BusIncidents'),
    ];
    if (GTFS_RAIL_ENABLED) feeds.push(wmataClient.get('/gtfs/rail-gtfsrt-vehiclepositions.pb', { responseType: 'arraybuffer' }));
    if (GTFS_BUS_ENABLED)  feeds.push(wmataClient.get('/gtfs/bus-gtfsrt-vehiclepositions.pb',  { responseType: 'arraybuffer' }));
    if (GTFS_TRIP_UPDATES_ENABLED) feeds.push(wmataClient.get('/gtfs/rail-gtfsrt-tripupdates.pb', { responseType: 'arraybuffer' }));

    const results = await Promise.allSettled(feeds);
    const [incRes, trainRes, elevRes, busPositionsRes, busIncidentsRes] = results;
    let idx = 5;
    const gtfsRailRes        = GTFS_RAIL_ENABLED          ? results[idx++] : undefined;
    const gtfsBusRes         = GTFS_BUS_ENABLED           ? results[idx++] : undefined;
    const gtfsTripUpdatesRes = GTFS_TRIP_UPDATES_ENABLED  ? results[idx++] : undefined;
    // Legacy alias for the rail block below
    const gtfsRes = gtfsRailRes;

    if (incRes.status === 'fulfilled') {
      const rawIncidents = incRes.value.data.Incidents || [];
      snapshotCache.set('incidents', rawIncidents);
      const incidents = rawIncidents.map(i => ({ ...i, snapshotAt }));
      if (incidents.length) await Incident.insertMany(incidents);
    } else {
      console.error('Incidents fetch error:', incRes.reason?.message);
    }

    let trainPositions = [];
    if (trainRes.status === 'fulfilled') {
      trainPositions = trainRes.value.data.TrainPositions || [];
      snapshotCache.set('trainPositions', trainPositions);
      const trains = trainPositions.map(t => ({ ...t, snapshotAt }));
      if (trains.length) await TrainPosition.insertMany(trains);
    } else {
      console.error('Train positions fetch error:', trainRes.reason?.message);
    }

    if (elevRes.status === 'fulfilled') {
      const rawOutages = elevRes.value.data.ElevatorIncidents || [];
      snapshotCache.set('elevators', rawOutages);
      const outages = rawOutages.map(e => ({ ...e, snapshotAt }));
      if (outages.length) await ElevatorOutage.insertMany(outages);
    } else {
      console.error('Elevator outages fetch error:', elevRes.reason?.message);
    }

    if (busPositionsRes.status === 'fulfilled') {
      const rawBusPositions = busPositionsRes.value.data.BusPositions || [];
      snapshotCache.set('busPositions', rawBusPositions);
      const busPositions = rawBusPositions.map(p => ({ ...p, snapshotAt }));
      if (busPositions.length) await BusPosition.insertMany(busPositions);
    } else {
      console.error('Bus positions fetch error:', busPositionsRes.reason?.message);
    }

    if (busIncidentsRes.status === 'fulfilled') {
      const rawBusIncidents = busIncidentsRes.value.data.BusIncidents || [];
      snapshotCache.set('busIncidents', rawBusIncidents);
      const busIncidents = rawBusIncidents.map(i => ({ ...i, snapshotAt }));
      if (busIncidents.length) await BusIncident.insertMany(busIncidents);
      console.log(`[poller] Bus incidents from WMATA: ${busIncidents.length}`);
    } else {
      console.error('Bus incidents fetch error:', busIncidentsRes.reason?.message);
    }

    if (GTFS_RAIL_ENABLED && gtfsRes?.status === 'fulfilled') {
      try {
        const { feedTimestamp, vehicles, tripMap } = decodeVehiclePositions(gtfsRes.value.data);

        // Build tripId → TrainId bridge from the VP feed (100% TrainId coverage)
        for (const [vehicleId, tripId] of tripMap.entries()) {
          tripToTrainMap.set(tripId, vehicleId);
        }

        const hasUsefulData = vehicles.some(v => v.occupancyStatus != null
          && v.occupancyStatus !== 0 && v.occupancyStatus !== 7);
        if (hasUsefulData) {
          if (railOccupancyAvailable !== true) {
            console.log(`[poller] GTFS-RT rail occupancy now AVAILABLE (${vehicles.length} vehicles)`);
            railOccupancyAvailable = true;
          }
          await RailOccupancy.create({ snapshotAt, feedTimestamp, vehicles });
        } else {
          if (railOccupancyAvailable !== false) {
            const hist = vehicles.reduce((a, v) => { a[v.occupancyStatus ?? 'null'] = (a[v.occupancyStatus ?? 'null'] || 0) + 1; return a; }, {});
            console.log(`[poller] GTFS-RT rail occupancy UNAVAILABLE — histogram: ${JSON.stringify(hist)} (${vehicles.length} vehicles)`);
            railOccupancyAvailable = false;
          }
        }
      } catch (err) {
        console.error('GTFS-RT rail decode/save error:', err.message);
      }
    } else if (GTFS_RAIL_ENABLED && gtfsRes) {
      console.error('GTFS-RT rail fetch error:', gtfsRes.reason?.message);
    }

    if (GTFS_BUS_ENABLED && gtfsBusRes?.status === 'fulfilled') {
      try {
        const { feedTimestamp, vehicles } = decodeVehiclePositions(gtfsBusRes.value.data);
        const hasUsefulData = vehicles.some(v => v.occupancyStatus != null
          && v.occupancyStatus !== 0 && v.occupancyStatus !== 7);
        if (hasUsefulData) {
          if (busOccupancyAvailable !== true) {
            console.log(`[poller] GTFS-RT bus occupancy now AVAILABLE (${vehicles.length} vehicles)`);
            busOccupancyAvailable = true;
          }
          await BusOccupancy.create({ snapshotAt, feedTimestamp, vehicles });
        } else {
          if (busOccupancyAvailable !== false) {
            const hist = vehicles.reduce((a, v) => { a[v.occupancyStatus ?? 'null'] = (a[v.occupancyStatus ?? 'null'] || 0) + 1; return a; }, {});
            console.log(`[poller] GTFS-RT bus occupancy UNAVAILABLE — histogram: ${JSON.stringify(hist)} (${vehicles.length} vehicles)`);
            busOccupancyAvailable = false;
          }
        }
      } catch (err) {
        console.error('GTFS-RT bus decode/save error:', err.message);
      }
    } else if (GTFS_BUS_ENABLED && gtfsBusRes) {
      console.error('GTFS-RT bus fetch error:', gtfsBusRes.reason?.message);
    }

    if (GTFS_TRIP_UPDATES_ENABLED && gtfsTripUpdatesRes?.status === 'fulfilled') {
      try {
        const { feedTimestamp: tuFeedTs, feedTimestampSec, trips: rawTrips } =
          decodeTripUpdates(gtfsTripUpdatesRes.value.data);

        // VP join: fill trainId from tripToTrainMap (built from rail VP feed)
        // For unjoined trips, fall back to vehicleId if it looks like a TrainId (digits only)
        for (const trip of rawTrips) {
          trip.trainId = tripToTrainMap.get(trip.tripId)
            ?? (/^\d+$/.test(trip.vehicleId ?? '') ? trip.vehicleId : null);
        }

        // Static schedule lookup — compute delaySeconds per trip
        const activeVer = await GtfsVersion.findOne({ status: 'active' }, { _id: 1 }).lean();
        const matchableTrips = rawTrips.filter(t => t.refStopSequence != null);

        if (activeVer && matchableTrips.length) {
          // Batch-query all reference stops in a single MongoDB query
          const refPairs = matchableTrips.map(t => ({ tripId: t.tripId, stopSequence: t.refStopSequence }));
          const staticRows = await GtfsStopTime.find({
            version: activeVer._id,
            $or: refPairs,
          }).lean();

          const schedMap = new Map();
          for (const r of staticRows) schedMap.set(`${r.tripId}:${r.stopSequence}`, r);

          const matchCount = matchableTrips.filter(t =>
            schedMap.has(`${t.tripId}:${t.refStopSequence}`)
          ).length;
          const matchRate = matchableTrips.length > 0 ? matchCount / matchableTrips.length : 0;
          const degraded  = matchRate < 0.80;
          if (degraded) {
            console.warn(`[poller] TripUpdate degraded: match rate ${(matchRate * 100).toFixed(1)}%`);
          }

          // Compute delay = actual arrival time − scheduled arrival time
          for (const trip of rawTrips) {
            if (trip.refStopSequence == null) continue;
            const row = schedMap.get(`${trip.tripId}:${trip.refStopSequence}`);
            if (!row) continue;

            // Convert YYYYMMDD startDate to "YYYY-MM-DD" for gtfsToUtc
            const dateStr = trip.startDate
              ? `${trip.startDate.slice(0, 4)}-${trip.startDate.slice(4, 6)}-${trip.startDate.slice(6, 8)}`
              : new Date(tuFeedTs).toLocaleDateString('en-CA', { timeZone: 'America/New_York' });

            // GtfsStopTime stores seconds-since-midnight (arrivalSec / departureSec)
            const scheduledSec = row.arrivalSec ?? row.departureSec;
            const scheduledTimeSec = Math.floor(
              gtfsToUtc(dateStr, scheduledSec).getTime() / 1000
            );
            trip.delaySeconds   = trip.refActualTimeSec - scheduledTimeSec;
            trip.delayLabel     = classifyDelay(trip.delaySeconds);
            trip.refActualTime  = new Date(trip.refActualTimeSec * 1000);
          }

          // Save slim TripUpdate doc
          if (rawTrips.length) {
            await TripUpdate.create({ snapshotAt, feedTimestamp: tuFeedTs, trips: rawTrips });
          }

          // Compute and persist schedule adherence snapshot
          try {
            const sas = computeScheduleAdherence(rawTrips, degraded, matchRate);
            await ScheduleAdherenceSnapshot.create({ snapshotAt, feedTimestamp: tuFeedTs, ...sas });
          } catch (err) {
            console.error('[poller] ScheduleAdherence computation error:', err.message);
          }
        } else {
          // No active GTFS static version — save trips with null delays, skip adherence snapshot
          if (!activeVer) {
            console.warn('[poller] No active GTFS static version — skipping delay computation');
          }
          if (rawTrips.length) {
            await TripUpdate.create({ snapshotAt, feedTimestamp: tuFeedTs, trips: rawTrips });
          }
        }
      } catch (err) {
        console.error('[poller] GTFS-RT trip updates error:', err.message);
      }
    } else if (GTFS_TRIP_UPDATES_ENABLED && gtfsTripUpdatesRes) {
      console.error('[poller] GTFS-RT trip updates fetch error:', gtfsTripUpdatesRes.reason?.message);
    }

    // Compute and persist headway adherence if we have train positions
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
  wmataUsage.scheduleDailyReset();
  wmataUsage.scheduleHourlyLog();
}

module.exports = { startPolling, fetchAndStore, computeScheduleAdherence };
