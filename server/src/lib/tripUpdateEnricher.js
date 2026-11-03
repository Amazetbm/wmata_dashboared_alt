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
 * Build a Map<vehicleId, { tripId, lineCode, currentDelaySeconds, delayLabel }> from a TripUpdate doc.
 *
 * @param {object|null} doc
 * @returns {Map<string, object>}
 */
function buildTripUpdateMap(doc) {
  const map = new Map();
  if (!doc?.trips) return map;
  for (const trip of doc.trips) {
    if (trip.vehicleId == null) continue;
    const key = String(trip.vehicleId).trim();
    map.set(key, {
      tripId:              trip.tripId              ?? null,
      lineCode:            trip.lineCode            ?? null,
      currentDelaySeconds: trip.currentDelaySeconds ?? null,
      delayLabel: trip.currentDelaySeconds != null
        ? classifyDelay(trip.currentDelaySeconds)
        : null,
    });
  }
  return map;
}

/**
 * Enrich an array of vehicle objects with a `scheduleDelay` field.
 *
 * @param {object[]} vehicles
 * @param {string}   idField   - property name on each vehicle holding the vehicle ID
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

  const tuMap = buildTripUpdateMap(doc);

  return vehicles.map(v => {
    const raw = v[idField];
    const id  = raw != null ? String(raw).trim() : null;
    const tu  = (id !== null && tuMap.has(id)) ? tuMap.get(id) : null;
    return {
      ...v,
      scheduleDelay: tu && tu.currentDelaySeconds != null
        ? { seconds: tu.currentDelaySeconds, label: tu.delayLabel }
        : null,
    };
  });
}

module.exports = {
  buildTripUpdateMap,
  enrichWithTripUpdates,
  DELAY_LABELS,
};
