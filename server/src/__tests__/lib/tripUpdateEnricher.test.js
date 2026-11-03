'use strict';

const {
  buildTripUpdateMap,
  enrichWithTripUpdates,
  DELAY_LABELS,
} = require('../../lib/tripUpdateEnricher');

const NOW = 1700000000000; // fixed reference time

function makeDoc(trips, snapshotOffsetMs = 0) {
  return {
    snapshotAt: new Date(NOW - snapshotOffsetMs),
    feedTimestamp: new Date(NOW - snapshotOffsetMs),
    trips,
  };
}

function makeTrip(vehicleId, currentDelaySeconds) {
  return {
    tripId: `trip-${vehicleId}`,
    routeId: 'RED',
    lineCode: 'RD',
    vehicleId,
    currentDelaySeconds,
  };
}

beforeEach(() => {
  jest.spyOn(Date, 'now').mockReturnValue(NOW);
});

afterEach(() => {
  jest.restoreAllMocks();
});

// ── buildTripUpdateMap ────────────────────────────────────────────────────────

test('buildTripUpdateMap returns empty map for null doc', () => {
  expect(buildTripUpdateMap(null).size).toBe(0);
});

test('buildTripUpdateMap returns empty map for doc with no trips', () => {
  expect(buildTripUpdateMap({ trips: [] }).size).toBe(0);
});

test('buildTripUpdateMap maps vehicleId → trip info', () => {
  const doc = makeDoc([makeTrip('V1', 120), makeTrip('V2', -90)]);
  const map = buildTripUpdateMap(doc);
  expect(map.size).toBe(2);
  expect(map.get('V1').currentDelaySeconds).toBe(120);
  expect(map.get('V2').currentDelaySeconds).toBe(-90);
});

test('buildTripUpdateMap skips entries with null vehicleId', () => {
  const doc = makeDoc([makeTrip(null, 60)]);
  expect(buildTripUpdateMap(doc).size).toBe(0);
});

test('buildTripUpdateMap attaches delayLabel', () => {
  const doc = makeDoc([makeTrip('V1', 350)]);
  const map = buildTripUpdateMap(doc);
  expect(map.get('V1').delayLabel).toBe(DELAY_LABELS.delay);
});

test('buildTripUpdateMap sets delayLabel null when currentDelaySeconds is null', () => {
  const doc = makeDoc([makeTrip('V1', null)]);
  const map = buildTripUpdateMap(doc);
  expect(map.get('V1').delayLabel).toBeNull();
});

// ── Delay classification boundaries ──────────────────────────────────────────

test.each([
  [-61,  'Early'],
  [-60,  'Early'],
  [0,    'On Time'],
  [59,   'On Time'],
  [60,   'Slight Delay'],
  [299,  'Slight Delay'],
  [300,  'Delay'],
  [599,  'Delay'],
  [600,  'Significant Delay'],
  [1200, 'Significant Delay'],
])('delay %ds → label %s', (seconds, expectedLabel) => {
  const doc = makeDoc([makeTrip('V1', seconds)]);
  const map = buildTripUpdateMap(doc);
  expect(map.get('V1').delayLabel).toBe(expectedLabel);
});

// ── enrichWithTripUpdates — flag off ─────────────────────────────────────────

test('returns vehicles unchanged when enabled=false', async () => {
  const vehicles = [{ TrainId: 'T1' }];
  const getDoc = jest.fn();
  const result = await enrichWithTripUpdates(vehicles, 'TrainId', false, getDoc);
  expect(result).toBe(vehicles); // same reference
  expect(getDoc).not.toHaveBeenCalled();
});

// ── enrichWithTripUpdates — null doc ─────────────────────────────────────────

test('returns scheduleDelay: null for all when doc is null', async () => {
  const vehicles = [{ TrainId: 'T1' }, { TrainId: 'T2' }];
  const result = await enrichWithTripUpdates(vehicles, 'TrainId', true, async () => null);
  expect(result.every(v => v.scheduleDelay === null)).toBe(true);
});

// ── enrichWithTripUpdates — stale doc ────────────────────────────────────────

test('returns scheduleDelay: null for all when snapshotAt > 2 min old', async () => {
  const doc = makeDoc([makeTrip('T1', 120)], 3 * 60 * 1000); // 3 min ago
  const vehicles = [{ TrainId: 'T1' }];
  const result = await enrichWithTripUpdates(vehicles, 'TrainId', true, async () => doc);
  expect(result[0].scheduleDelay).toBeNull();
});

// ── enrichWithTripUpdates — match ─────────────────────────────────────────────

test('sets scheduleDelay to { seconds, label } for matched vehicle', async () => {
  const doc = makeDoc([makeTrip('T1', 200)]);
  const vehicles = [{ TrainId: 'T1' }];
  const result = await enrichWithTripUpdates(vehicles, 'TrainId', true, async () => doc);
  expect(result[0].scheduleDelay).toEqual({ seconds: 200, label: 'Slight Delay' });
});

// ── enrichWithTripUpdates — miss ─────────────────────────────────────────────

test('sets scheduleDelay: null for unmatched vehicle', async () => {
  const doc = makeDoc([makeTrip('OTHER', 60)]);
  const vehicles = [{ TrainId: 'T1' }];
  const result = await enrichWithTripUpdates(vehicles, 'TrainId', true, async () => doc);
  expect(result[0].scheduleDelay).toBeNull();
});

// ── enrichWithTripUpdates — camelCase idField ─────────────────────────────────

test('works with camelCase idField (trainId)', async () => {
  const doc = makeDoc([makeTrip('T5', 700)]);
  const vehicles = [{ trainId: 'T5', lineCode: 'RD' }];
  const result = await enrichWithTripUpdates(vehicles, 'trainId', true, async () => doc);
  expect(result[0].scheduleDelay).toEqual({ seconds: 700, label: 'Significant Delay' });
});

// ── enrichWithTripUpdates — null currentDelaySeconds ────────────────────────

test('sets scheduleDelay: null when currentDelaySeconds is null even if vehicle matched', async () => {
  const doc = makeDoc([makeTrip('T1', null)]);
  const vehicles = [{ TrainId: 'T1' }];
  const result = await enrichWithTripUpdates(vehicles, 'TrainId', true, async () => doc);
  expect(result[0].scheduleDelay).toBeNull();
});

// ── enrichWithTripUpdates — all vehicles present ──────────────────────────────

test('unmatched vehicle is preserved with scheduleDelay: null, not dropped', async () => {
  const doc = makeDoc([makeTrip('T1', 30)]);
  const vehicles = [
    { TrainId: 'T1' },
    { TrainId: 'T2' }, // no trip entry
  ];
  const result = await enrichWithTripUpdates(vehicles, 'TrainId', true, async () => doc);
  expect(result).toHaveLength(2);
  expect(result[0].scheduleDelay).not.toBeNull();
  expect(result[1].scheduleDelay).toBeNull();
});

// ── DELAY_LABELS export ───────────────────────────────────────────────────────

test('DELAY_LABELS has all expected entries', () => {
  expect(DELAY_LABELS.early).toBe('Early');
  expect(DELAY_LABELS.onTime).toBe('On Time');
  expect(DELAY_LABELS.slightDelay).toBe('Slight Delay');
  expect(DELAY_LABELS.delay).toBe('Delay');
  expect(DELAY_LABELS.significantDelay).toBe('Significant Delay');
});
