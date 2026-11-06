'use strict';

const STALE_MS = 2 * 60 * 1000; // 2 minutes

// Delay labels for classifyDelay() — 4 buckets aligned with classifyScheduleDelay3()
const DELAY_LABELS = {
  early:       'Early',
  onTime:      'On Time',
  minorDelay:  'Minor Delay',
  delay:       'Delay',
};

// ── 3-bucket classification for schedule adherence ────────────────────────────
// Maps the 5-label scale to 3 reporting buckets:
//   Early (≤EARLY_SEC)  →  'early'
//   On Time             →  'onTime'  (EARLY_SEC < seconds ≤ ONTIME_SEC)
//   Minor delay         →  'minor'   (ONTIME_SEC < seconds ≤ MINOR_SEC)
//   Significant delay   →  'significant' (> MINOR_SEC)
//
// Thresholds are read once at module load from environment variables so they
// can be tuned without code changes. Defaults: −60 s / +120 s / +300 s.
const EARLY_SEC  = -Math.abs(Number(process.env.SCHEDULE_EARLY_SEC)  || 60);
const ONTIME_SEC =  Number(process.env.SCHEDULE_ONTIME_SEC)  || 120;
const MINOR_SEC  =  Number(process.env.SCHEDULE_MINOR_SEC)   || 300;

function classifyScheduleDelay3(seconds) {
  if (seconds <= EARLY_SEC)  return 'early';
  if (seconds <= ONTIME_SEC) return 'onTime';
  if (seconds <= MINOR_SEC)  return 'minor';
  return 'significant';
}

function classifyDelay(seconds) {
  if (seconds === null || seconds === undefined) return 'unknown';
  if (seconds <= EARLY_SEC)   return DELAY_LABELS.early;
  if (seconds <= ONTIME_SEC)  return DELAY_LABELS.onTime;
  if (seconds <= MINOR_SEC)   return DELAY_LABELS.minorDelay;
  return DELAY_LABELS.delay;
}

/**
 * Build dual lookup maps from a TripUpdate doc.
 *
 * Returns:
 *   trainIdMap:   Map<trainId,  trip>  — primary (VP-joined trips)
 *   vehicleIdMap: Map<vehicleId, trip> — fallback (all trips with vehicleId)
 *
 * @param {object|null} doc
 * @returns {{ trainIdMap: Map, vehicleIdMap: Map }}
 */
function buildTripUpdateMap(doc) {
  const trainIdMap   = new Map();
  const vehicleIdMap = new Map();
  if (!doc?.trips) return { trainIdMap, vehicleIdMap };

  for (const trip of doc.trips) {
    if (trip.trainId != null) {
      trainIdMap.set(String(trip.trainId).trim(), trip);
    }
    if (trip.vehicleId != null) {
      vehicleIdMap.set(String(trip.vehicleId).trim(), trip);
    }
  }
  return { trainIdMap, vehicleIdMap };
}

/**
 * Enrich an array of vehicle objects with a `scheduleDelay` field.
 *
 * Lookup order: trainIdMap (primary, VP-joined) → vehicleIdMap (fallback).
 * delaySeconds and delayLabel are pre-computed by the poller; this enricher
 * only passes them through.
 *
 * @param {object[]} vehicles
 * @param {string}   idField   - property name on each vehicle holding the vehicle/train ID
 * @param {boolean}  enabled   - feature flag; returns original array unchanged when false
 * @param {() => Promise<object|null>} getDoc - injected DB lookup; tests pass a mock
 * @returns {Promise<object[]>}
 */
async function enrichWithTripUpdates(vehicles, idField, enabled, getDoc) {
  if (!enabled) return vehicles;

  const doc = await getDoc();

  if (!doc) {
    return vehicles.map(v => ({ ...v, scheduleDelay: null }));
  }

  const stale = (Date.now() - new Date(doc.snapshotAt).getTime()) > STALE_MS;
  if (stale) {
    return vehicles.map(v => ({ ...v, scheduleDelay: null }));
  }

  const { trainIdMap, vehicleIdMap } = buildTripUpdateMap(doc);

  return vehicles.map(v => {
    const raw  = v[idField];
    const id   = raw != null ? String(raw).trim() : null;
    const trip = id !== null
      ? (trainIdMap.get(id) ?? vehicleIdMap.get(id) ?? null)
      : null;

    return {
      ...v,
      scheduleDelay: trip != null && trip.delaySeconds != null
        ? { seconds: trip.delaySeconds, label: trip.delayLabel }
        : null,
    };
  });
}

module.exports = {
  buildTripUpdateMap,
  enrichWithTripUpdates,
  classifyDelay,
  classifyScheduleDelay3,
  DELAY_LABELS,
  EARLY_SEC,
  ONTIME_SEC,
  MINOR_SEC,
  STALE_MS,
};
