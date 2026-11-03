'use strict';

// Mock all DB-touching modules so requiring poller doesn't crash in tests
jest.mock('../../jobs/scheduleLoader', () => ({ init: jest.fn() }));
jest.mock('../../lib/railGeometry', () => ({
  buildRouteMaps: jest.fn().mockReturnValue({ circuitMap: {}, routeLen: {} }),
  getStandardRoutes: jest.fn().mockResolvedValue([]),
  getCachedRoutes: jest.fn().mockResolvedValue([]),
}));

const { computeScheduleAdherence } = require('../../jobs/poller');
const { classifyDelay } = require('../../lib/tripUpdateEnricher');

// Build a trip as it would exist after VP join + delay computation.
// scheduleRelationship defaults to 0 (SCHEDULED).
function makeTrip(overrides = {}) {
  const delay = overrides.delaySeconds ?? null;
  return {
    tripId:               overrides.tripId               ?? `trip-${overrides.trainId ?? 'T1'}`,
    lineCode:             overrides.lineCode              ?? 'RD',
    trainId:              overrides.trainId               ?? null,
    vehicleId:            overrides.vehicleId             ?? null,
    delaySeconds:         delay,
    delayLabel:           delay != null ? classifyDelay(delay) : null,
    scheduleRelationship: overrides.scheduleRelationship  ?? 0,
  };
}

// ── Summary counts — 3-bucket classification ─────────────────────────────────
// Default thresholds: early ≤ −60 s, onTime ≤ +120 s, minor ≤ +300 s,
//   significant > +300 s.

test('summary counts match spread delays across all 3 buckets + noPrediction', () => {
  const trips = [
    makeTrip({ trainId: 'T1', lineCode: 'RD', delaySeconds: -90 }),   // early
    makeTrip({ trainId: 'T2', lineCode: 'RD', delaySeconds:  30 }),   // onTime
    makeTrip({ trainId: 'T3', lineCode: 'BL', delaySeconds: 200 }),   // minor
    makeTrip({ trainId: 'T4', lineCode: 'BL', delaySeconds: 400 }),   // significant
    makeTrip({ trainId: 'T5', lineCode: 'GR', delaySeconds: null }),  // noPrediction
  ];

  const result = computeScheduleAdherence(trips, false, 0.9);

  expect(result.summary.total).toBe(5);
  expect(result.summary.early).toBe(1);
  expect(result.summary.onTime).toBe(1);
  expect(result.summary.minor).toBe(1);
  expect(result.summary.significant).toBe(1);
  expect(result.summary.noPrediction).toBe(1);
});

// ── Per-line summaries ────────────────────────────────────────────────────────

test('lineSummaries group correctly by lineCode', () => {
  const trips = [
    makeTrip({ trainId: 'T1', lineCode: 'RD', delaySeconds:  30 }),   // onTime
    makeTrip({ trainId: 'T2', lineCode: 'RD', delaySeconds: 400 }),   // significant
    makeTrip({ trainId: 'T3', lineCode: 'BL', delaySeconds: -90 }),   // early
  ];

  const result = computeScheduleAdherence(trips, false, 1.0);

  const rd = result.lineSummaries.find(l => l.lineCode === 'RD');
  expect(rd.total).toBe(2);
  expect(rd.onTime).toBe(1);
  expect(rd.significant).toBe(1);

  const bl = result.lineSummaries.find(l => l.lineCode === 'BL');
  expect(bl.total).toBe(1);
  expect(bl.early).toBe(1);
});

// ── coverageRate and degraded forwarded ───────────────────────────────────────

test('coverageRate < 0.80 → degraded=true in result', () => {
  const result = computeScheduleAdherence(
    [makeTrip({ trainId: 'T1', delaySeconds: 0 })],
    true,   // degraded
    0.72,
  );
  expect(result.degraded).toBe(true);
  expect(result.coverageRate).toBeCloseTo(0.72);
});

test('coverageRate >= 0.80 → degraded=false', () => {
  const result = computeScheduleAdherence(
    [makeTrip({ trainId: 'T1', delaySeconds: 0 })],
    false,
    0.95,
  );
  expect(result.degraded).toBe(false);
  expect(result.coverageRate).toBeCloseTo(0.95);
});

// ── Only trips with trainId appear in trainRecords ────────────────────────────

test('trainId match: only trips with trainId appear in trainRecords', () => {
  const trips = [
    makeTrip({ trainId: 'T5', vehicleId: 'V5', lineCode: 'OR', delaySeconds: 200 }),
    makeTrip({ trainId: null,  vehicleId: 'V9', lineCode: 'OR', delaySeconds: 600 }),
  ];

  const result = computeScheduleAdherence(trips, false, 1.0);
  expect(result.trains).toHaveLength(1);
  expect(result.trains[0].trainId).toBe('T5');
  expect(result.trains[0].delaySeconds).toBe(200);
});

// ── Non-SCHEDULED trip types ──────────────────────────────────────────────────

test('CANCELED trips counted under canceled and excluded from total', () => {
  const trips = [
    makeTrip({ lineCode: 'RD', delaySeconds: 30, scheduleRelationship: 0 }),
    makeTrip({ lineCode: 'RD', scheduleRelationship: 3 }),
  ];

  const result = computeScheduleAdherence(trips, false, 1.0);
  expect(result.summary.total).toBe(1);
  expect(result.summary.canceled).toBe(1);
});

test('UNSCHEDULED and ADDED trips counted separately, not in total', () => {
  const trips = [
    makeTrip({ lineCode: 'BL', scheduleRelationship: 2 }),  // unscheduled
    makeTrip({ lineCode: 'BL', scheduleRelationship: 1 }),  // added
  ];

  const result = computeScheduleAdherence(trips, false, 1.0);
  expect(result.summary.total).toBe(0);
  expect(result.summary.unscheduled).toBe(1);
  expect(result.summary.added).toBe(1);
});

// ── Per-train record fields ───────────────────────────────────────────────────

test('train record includes tripId, delaySeconds, delayLabel', () => {
  const trips = [{
    tripId: 'trip-X', lineCode: 'RD', trainId: 'T1', vehicleId: null,
    delaySeconds: 45, delayLabel: 'On Time', scheduleRelationship: 0,
  }];

  const result = computeScheduleAdherence(trips, false, 1.0);
  const rec = result.trains[0];
  expect(rec.tripId).toBe('trip-X');
  expect(rec.delaySeconds).toBe(45);
  expect(rec.delayLabel).toBe('On Time');
});
