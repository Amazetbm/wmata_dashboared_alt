'use strict';

const STALE_MS = 2 * 60 * 1000; // 2 minutes

const RAIL_OCCUPANCY_LABELS = {
  1: 'Many seats (<20% full)',
  2: 'Few seats (20–32% full)',
  5: 'Full (≥33% full)',
};

const BUS_OCCUPANCY_LABELS = {
  1: 'Many seats (<25% full)',
  2: 'Few seats (25–49% full)',
  5: 'Full (≥50% full)',
};

// Alias for backwards compatibility
const OCCUPANCY_LABELS = RAIL_OCCUPANCY_LABELS;

/**
 * Build a Map<vehicleId, { status, label }> from an occupancy DB document.
 *
 * @param {object|null} doc
 * @param {object} [labels] - label map keyed by occupancy status; defaults to RAIL_OCCUPANCY_LABELS
 * @returns {Map<string, { status: number, label: string|null }>}
 */
function buildOccupancyMap(doc, labels = RAIL_OCCUPANCY_LABELS) {
  const map = new Map();
  if (!doc?.vehicles) return map;
  for (const v of doc.vehicles) {
    if (v.vehicleId != null) {
      map.set(String(v.vehicleId).trim(), {
        status: v.occupancyStatus,
        label:  labels[v.occupancyStatus] ?? null,
      });
    }
  }
  return map;
}

/**
 * Enrich an array of vehicle objects with an `occupancy` field.
 *
 * @param {object[]} vehicles
 * @param {string}   idField   - property name on each vehicle holding the vehicle ID
 * @param {boolean}  enabled   - feature flag; returns original array unchanged when false
 * @param {() => Promise<object|null>} getDoc - injected DB lookup; tests pass a mock
 * @param {object}   [labels]  - label map; defaults to RAIL_OCCUPANCY_LABELS
 * @returns {Promise<object[]>}
 */
async function enrichWithOccupancy(vehicles, idField, enabled, getDoc, labels = RAIL_OCCUPANCY_LABELS) {
  if (!enabled) return vehicles;

  const doc = await getDoc();

  if (!doc) {
    return vehicles.map(v => ({ ...v, occupancy: null }));
  }

  const stale = (Date.now() - new Date(doc.feedTimestamp).getTime()) > STALE_MS;
  if (stale) {
    return vehicles.map(v => ({ ...v, occupancy: null }));
  }

  const occMap = buildOccupancyMap(doc, labels);

  return vehicles.map(v => {
    const raw = v[idField];
    const id  = raw != null ? String(raw).trim() : null;
    const occ = (id !== null && occMap.has(id)) ? occMap.get(id) : null;
    return { ...v, occupancy: occ };
  });
}

// Keep old name as alias so any external consumers still work
const enrichTrainsWithOccupancy = enrichWithOccupancy;

module.exports = {
  buildOccupancyMap,
  enrichWithOccupancy,
  enrichTrainsWithOccupancy,
  RAIL_OCCUPANCY_LABELS,
  BUS_OCCUPANCY_LABELS,
  OCCUPANCY_LABELS,
  STALE_MS,
};
