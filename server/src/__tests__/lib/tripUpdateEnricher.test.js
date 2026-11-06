'use strict';

const {
  buildTripUpdateMap,
  enrichWithTripUpdates,
  classifyDelay,
  DELAY_LABELS,
  EARLY_SEC,
  ONTIME_SEC,
  MINOR_SEC,
} = require('../../lib/tripUpdateEnricher');

const NOW = 1700000000000; // fixed reference time

function makeDoc(trips, snapshotOffsetMs = 0) {
  return {
    snapshotAt:    new Date(NOW - snapshotOffsetMs),
    feedTimestamp: new Date(NOW - snapshotOffsetMs),
    trips,
  };
}

/**
 * Create a slim trip object matching the new TripUpdate schema.
 * trainId is primary join key; vehicleId is fallback.
 */
function makeTrip({ vehicleId = null, trainId = null, delaySeconds = null, tripId = null } = {}) {
  return {
    tripId:       tripId ?? `trip-${trainId ?? vehicleId}`,
    routeId:      'RED',
    lineCode:     'RD',
    vehicleId,
    trainId,
    delaySeconds,
    delayLabel:   delaySeconds != null ? classifyDelay(delaySeconds) : null,
  };
}

beforeEach(() => {
  jest.spyOn(Date, 'now').mockReturnValue(NOW);
});

afterEach(() => {
  jest.restoreAllMocks();
});

// ── buildTripUpdateMap ────────────────────────────────────────────────────────

test('buildTripUpdateMap returns empty maps for null doc', () => {
  const { trainIdMap, vehicleIdMap } = buildTripUpdateMap(null);
  expect(trainIdMap.size).toBe(0);
  expect(vehicleIdMap.size).toBe(0);
});

test('buildTripUpdateMap returns empty maps for doc with no trips', () => {
  const { trainIdMap, vehicleIdMap } = buildTripUpdateMap({ trips: [] });
  expect(trainIdMap.size).toBe(0);
  expect(vehicleIdMap.size).toBe(0);
});

test('buildTripUpdateMap populates trainIdMap for trips with trainId', () => {
  const doc = makeDoc([makeTrip({ trainId: 'T1', delaySeconds: 120 })]);
  const { trainIdMap, vehicleIdMap } = buildTripUpdateMap(doc);
  expect(trainIdMap.size).toBe(1);
  expect(trainIdMap.get('T1').delaySeconds).toBe(120);
  expect(vehicleIdMap.size).toBe(0);
});

test('buildTripUpdateMap populates vehicleIdMap for trips with vehicleId (no trainId)', () => {
  const doc = makeDoc([makeTrip({ vehicleId: 'V2', delaySeconds: -90 })]);
  const { trainIdMap, vehicleIdMap } = buildTripUpdateMap(doc);
  expect(trainIdMap.size).toBe(0);
  expect(vehicleIdMap.size).toBe(1);
  expect(vehicleIdMap.get('V2').delaySeconds).toBe(-90);
});

test('buildTripUpdateMap populates both maps when trip has trainId and vehicleId', () => {
  const doc = makeDoc([makeTrip({ trainId: 'T3', vehicleId: 'V3', delaySeconds: 200 })]);
  const { trainIdMap, vehicleIdMap } = buildTripUpdateMap(doc);
  expect(trainIdMap.get('T3').delaySeconds).toBe(200);
  expect(vehicleIdMap.get('V3').delaySeconds).toBe(200);
});

test('buildTripUpdateMap skips trainId when null', () => {
  const doc = makeDoc([makeTrip({ trainId: null, vehicleId: null, delaySeconds: 60 })]);
  const { trainIdMap, vehicleIdMap } = buildTripUpdateMap(doc);
  expect(trainIdMap.size).toBe(0);
  expect(vehicleIdMap.size).toBe(0);
});

// ── classifyDelay boundaries ──────────────────────────────────────────────────
// EARLY_SEC default: -60, ONTIME_SEC default: 120, MINOR_SEC default: 300

test('classifyDelay returns unknown for null', () => {
  expect(classifyDelay(null)).toBe('unknown');
  expect(classifyDelay(undefined)).toBe('unknown');
});

test.each([
  [-61,  'Early'],
  [-60,  'Early'],       // <= EARLY_SEC (-60) → early
  [-59,  'On Time'],     // > EARLY_SEC → onTime
  [0,    'On Time'],
  [120,  'On Time'],     // <= ONTIME_SEC (120) → onTime
  [121,  'Minor Delay'], // > ONTIME_SEC → minorDelay
  [300,  'Minor Delay'], // <= MINOR_SEC (300) → minorDelay
  [301,  'Delay'],       // > MINOR_SEC → delay
  [1200, 'Delay'],
])('delay %ds → label %s', (seconds, expectedLabel) => {
  expect(classifyDelay(seconds)).toBe(expectedLabel);
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
  const doc = makeDoc([makeTrip({ trainId: 'T1', delaySeconds: 120 })], 3 * 60 * 1000);
  const vehicles = [{ TrainId: 'T1' }];
  const result = await enrichWithTripUpdates(vehicles, 'TrainId', true, async () => doc);
  expect(result[0].scheduleDelay).toBeNull();
});

// ── enrichWithTripUpdates — primary trainId match ────────────────────────────

test('sets scheduleDelay via trainIdMap (primary key)', async () => {
  const doc = makeDoc([makeTrip({ trainId: 'T1', delaySeconds: 200 })]);
  const vehicles = [{ TrainId: 'T1' }];
  const result = await enrichWithTripUpdates(vehicles, 'TrainId', true, async () => doc);
  expect(result[0].scheduleDelay).toEqual({ seconds: 200, label: 'Minor Delay' });
});

// ── enrichWithTripUpdates — fallback vehicleId match ─────────────────────────

test('falls back to vehicleIdMap when trainId not matched', async () => {
  // Trip has vehicleId='044' (no trainId) — vehicle also has TrainId='044'
  const doc = makeDoc([makeTrip({ vehicleId: '044', delaySeconds: 700 })]);
  const vehicles = [{ TrainId: '044' }];
  const result = await enrichWithTripUpdates(vehicles, 'TrainId', true, async () => doc);
  expect(result[0].scheduleDelay).toEqual({ seconds: 700, label: 'Delay' });
});

test('prefers trainIdMap over vehicleIdMap when both match the same id', async () => {
  // trainId='T5' has 200 s; vehicleId='T5' has 600 s — trainId should win
  const doc = makeDoc([
    makeTrip({ trainId: 'T5', delaySeconds: 200 }),
    makeTrip({ vehicleId: 'T5', delaySeconds: 600 }),
  ]);
  const vehicles = [{ TrainId: 'T5' }];
  const result = await enrichWithTripUpdates(vehicles, 'TrainId', true, async () => doc);
  expect(result[0].scheduleDelay?.seconds).toBe(200);
});

// ── enrichWithTripUpdates — miss ─────────────────────────────────────────────

test('sets scheduleDelay: null for unmatched vehicle', async () => {
  const doc = makeDoc([makeTrip({ trainId: 'OTHER', delaySeconds: 60 })]);
  const vehicles = [{ TrainId: 'T1' }];
  const result = await enrichWithTripUpdates(vehicles, 'TrainId', true, async () => doc);
  expect(result[0].scheduleDelay).toBeNull();
});

// ── enrichWithTripUpdates — camelCase idField ─────────────────────────────────

test('works with camelCase idField (trainId)', async () => {
  const doc = makeDoc([makeTrip({ trainId: 'T5', delaySeconds: 700 })]);
  const vehicles = [{ trainId: 'T5', lineCode: 'RD' }];
  const result = await enrichWithTripUpdates(vehicles, 'trainId', true, async () => doc);
  expect(result[0].scheduleDelay).toEqual({ seconds: 700, label: 'Delay' });
});

// ── enrichWithTripUpdates — null delaySeconds ─────────────────────────────────

test('sets scheduleDelay: null when delaySeconds is null even if vehicle matched', async () => {
  const doc = makeDoc([makeTrip({ trainId: 'T1', delaySeconds: null })]);
  const vehicles = [{ TrainId: 'T1' }];
  const result = await enrichWithTripUpdates(vehicles, 'TrainId', true, async () => doc);
  expect(result[0].scheduleDelay).toBeNull();
});

// ── enrichWithTripUpdates — all vehicles preserved ───────────────────────────

test('unmatched vehicle is preserved with scheduleDelay: null, not dropped', async () => {
  const doc = makeDoc([makeTrip({ trainId: 'T1', delaySeconds: 30 })]);
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
  expect(DELAY_LABELS.minorDelay).toBe('Minor Delay');
  expect(DELAY_LABELS.delay).toBe('Delay');
});
