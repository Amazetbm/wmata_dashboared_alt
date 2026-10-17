'use strict';

const STALE_MS = 2 * 60 * 1000; // 2 minutes

const OCCUPANCY_LABELS = {
  1: 'Many seats (<20% full)',
  2: 'Few seats (20–32% full)',
  5: 'Full (≥33% full)',
};

/**
 * Build a Map<vehicleId, { status, label }> from a RailOccupancy DB document.
 *
 * @param {object|null} doc
 * @returns {Map<string, { status: number, label: string|null }>}
 */
function buildOccupancyMap(doc) {
  const map = new Map();
  if (!doc?.vehicles) return map;
  for (const v of doc.vehicles) {
    if (v.vehicleId != null) {
      map.set(String(v.vehicleId).trim(), {
        status: v.occupancyStatus,
        label:  OCCUPANCY_LABELS[v.occupancyStatus] ?? null,
      });
    }
  }
  return map;
}

/**
 * Enrich an array of train objects with an `occupancy` field.
 *
 * @param {object[]} trains
 * @param {string}   idField   - property name on each train holding the vehicle ID
 * @param {boolean}  enabled   - feature flag; returns original array unchanged when false
 * @param {() => Promise<object|null>} getDoc - injected DB lookup; tests pass a mock
 * @returns {Promise<object[]>}
 */
async function enrichTrainsWithOccupancy(trains, idField, enabled, getDoc) {
  if (!enabled) return trains;

  const doc = await getDoc();

  if (!doc) {
    return trains.map(t => ({ ...t, occupancy: null }));
  }

  const stale = (Date.now() - new Date(doc.feedTimestamp).getTime()) > STALE_MS;
  if (stale) {
    return trains.map(t => ({ ...t, occupancy: null }));
  }

  const occMap = buildOccupancyMap(doc);

  return trains.map(t => {
    const raw = t[idField];
    const id  = raw != null ? String(raw).trim() : null;
    const occ = (id !== null && occMap.has(id)) ? occMap.get(id) : null;
    return { ...t, occupancy: occ };
  });
}

module.exports = { buildOccupancyMap, enrichTrainsWithOccupancy, OCCUPANCY_LABELS };
