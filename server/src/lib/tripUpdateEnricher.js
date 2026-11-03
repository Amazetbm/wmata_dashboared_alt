'use strict';

const STALE_MS = 2 * 60 * 1000; // 2 minutes

// Delay thresholds (seconds)
// <= -60  → 'Early'
// < 60    → 'On Time'
// < 300   → 'Slight Delay'
// < 600   → 'Delay'
// >= 600  → 'Significant Delay'
const DELAY_LABELS = {
  early:            'Early',
  onTime:           'On Time',
  slightDelay:      'Slight Delay',
  delay:            'Delay',
  significantDelay: 'Significant Delay',
};

function classifyDelay(seconds) {
  if (seconds <= -60)  return DELAY_LABELS.early;
  if (seconds < 60)    return DELAY_LABELS.onTime;
  if (seconds < 300)   return DELAY_LABELS.slightDelay;
  if (seconds < 600)   return DELAY_LABELS.delay;
  return DELAY_LABELS.significantDelay;
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
  DELAY_LABELS,
  STALE_MS,
};
