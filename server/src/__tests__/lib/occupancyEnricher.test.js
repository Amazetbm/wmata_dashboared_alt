'use strict';

const {
  buildOccupancyMap,
  enrichTrainsWithOccupancy,
  OCCUPANCY_LABELS,
} = require('../../lib/occupancyEnricher');

const NOW = 1700000000000; // fixed reference time

// A fresh doc (feedTimestamp within the last 2 minutes)
function makeDoc(vehicles, feedOffsetMs = 0) {
  return {
    feedTimestamp: new Date(NOW - feedOffsetMs),
    vehicles,
  };
}

beforeEach(() => {
  jest.spyOn(Date, 'now').mockReturnValue(NOW);
});

afterEach(() => {
  jest.restoreAllMocks();
});

// ── buildOccupancyMap ─────────────────────────────────────────────────────────

test('buildOccupancyMap returns empty map for null doc', () => {
  expect(buildOccupancyMap(null).size).toBe(0);
});

test('buildOccupancyMap returns empty map for doc with no vehicles', () => {
  expect(buildOccupancyMap({ vehicles: [] }).size).toBe(0);
});

test('buildOccupancyMap maps vehicleId → { status, label }', () => {
  const doc = makeDoc([
    { vehicleId: 'V1', occupancyStatus: 1 },
    { vehicleId: 'V2', occupancyStatus: 5 },
  ]);
  const map = buildOccupancyMap(doc);
  expect(map.get('V1')).toEqual({ status: 1, label: OCCUPANCY_LABELS[1] });
  expect(map.get('V2')).toEqual({ status: 5, label: OCCUPANCY_LABELS[5] });
});

test('buildOccupancyMap sets label to null for unknown status', () => {
  const doc = makeDoc([{ vehicleId: 'V3', occupancyStatus: 99 }]);
  const map = buildOccupancyMap(doc);
  expect(map.get('V3').label).toBeNull();
});

test('buildOccupancyMap skips entries with null vehicleId', () => {
  const doc = makeDoc([{ vehicleId: null, occupancyStatus: 1 }]);
  expect(buildOccupancyMap(doc).size).toBe(0);
});

// ── enrichTrainsWithOccupancy — flag off ──────────────────────────────────────

test('returns trains unchanged when enabled=false', async () => {
  const trains = [{ TrainId: 'T1' }];
  const getDoc = jest.fn();
  const result = await enrichTrainsWithOccupancy(trains, 'TrainId', false, getDoc);
  expect(result).toBe(trains); // same reference
  expect(getDoc).not.toHaveBeenCalled();
});

// ── enrichTrainsWithOccupancy — null doc ──────────────────────────────────────

test('returns occupancy: null for all trains when doc is null', async () => {
  const trains = [{ TrainId: 'T1' }, { TrainId: 'T2' }];
  const result = await enrichTrainsWithOccupancy(trains, 'TrainId', true, async () => null);
  expect(result.every(t => t.occupancy === null)).toBe(true);
});

// ── enrichTrainsWithOccupancy — stale feed ────────────────────────────────────

test('returns occupancy: null for all trains when feedTimestamp > 2 min old', async () => {
  const doc = makeDoc([{ vehicleId: 'T1', occupancyStatus: 1 }], 3 * 60 * 1000); // 3 min ago
  const trains = [{ TrainId: 'T1' }];
  const result = await enrichTrainsWithOccupancy(trains, 'TrainId', true, async () => doc);
  expect(result[0].occupancy).toBeNull();
});

// ── enrichTrainsWithOccupancy — match ─────────────────────────────────────────

test('sets occupancy to { status, label } for matched trains', async () => {
  const doc = makeDoc([{ vehicleId: 'T1', occupancyStatus: 2 }]);
  const trains = [{ TrainId: 'T1' }];
  const result = await enrichTrainsWithOccupancy(trains, 'TrainId', true, async () => doc);
  expect(result[0].occupancy).toEqual({ status: 2, label: OCCUPANCY_LABELS[2] });
});

// ── enrichTrainsWithOccupancy — miss ──────────────────────────────────────────

test('sets occupancy: null for unmatched trains', async () => {
  const doc = makeDoc([{ vehicleId: 'OTHER', occupancyStatus: 1 }]);
  const trains = [{ TrainId: 'T1' }];
  const result = await enrichTrainsWithOccupancy(trains, 'TrainId', true, async () => doc);
  expect(result[0].occupancy).toBeNull();
});

// ── enrichTrainsWithOccupancy — camelCase idField ─────────────────────────────

test('works with camelCase idField (trainId)', async () => {
  const doc = makeDoc([{ vehicleId: 'T5', occupancyStatus: 5 }]);
  const trains = [{ trainId: 'T5', lineCode: 'RD' }];
  const result = await enrichTrainsWithOccupancy(trains, 'trainId', true, async () => doc);
  expect(result[0].occupancy).toEqual({ status: 5, label: OCCUPANCY_LABELS[5] });
});

// ── enrichTrainsWithOccupancy — unmatched train not dropped ───────────────────

test('unmatched train is preserved with occupancy: null, not dropped', async () => {
  const doc = makeDoc([{ vehicleId: 'T1', occupancyStatus: 1 }]);
  const trains = [
    { TrainId: 'T1' },
    { TrainId: 'T2' }, // no GTFS entry for this one
  ];
  const result = await enrichTrainsWithOccupancy(trains, 'TrainId', true, async () => doc);
  expect(result).toHaveLength(2);          // not dropped
  expect(result[0].occupancy).not.toBeNull();
  expect(result[1].occupancy).toBeNull();  // graceful miss
});

// ── enrichTrainsWithOccupancy — ID normalization ──────────────────────────────

test('normalizes numeric vehicleId to match string TrainId', async () => {
  const doc = makeDoc([{ vehicleId: 101, occupancyStatus: 2 }]); // numeric
  const trains = [{ TrainId: '101' }];                            // string
  const result = await enrichTrainsWithOccupancy(trains, 'TrainId', true, async () => doc);
  expect(result[0].occupancy).toEqual({ status: 2, label: OCCUPANCY_LABELS[2] });
});

// ── OCCUPANCY_LABELS export ───────────────────────────────────────────────────

test('OCCUPANCY_LABELS has entries for statuses 1, 2, and 5', () => {
  expect(OCCUPANCY_LABELS[1]).toMatch(/Many seats/);
  expect(OCCUPANCY_LABELS[2]).toMatch(/Few seats/);
  expect(OCCUPANCY_LABELS[5]).toMatch(/Full/);
});
