'use strict';

// Mock all DB-touching modules so requiring poller doesn't crash in tests
jest.mock('../../jobs/scheduleLoader', () => ({ init: jest.fn() }));
jest.mock('../../lib/railGeometry', () => ({
  buildRouteMaps: jest.fn().mockReturnValue({ circuitMap: {}, routeLen: {} }),
  getStandardRoutes: jest.fn().mockResolvedValue([]),
  getCachedRoutes: jest.fn().mockResolvedValue([]),
}));

const { computeScheduleAdherence } = require('../../jobs/poller');

// Helper to build a minimal TrainPosition object
function makeTrain(overrides = {}) {
  return {
    TrainId:                 overrides.TrainId         ?? 'T1',
    TrainNumber:             overrides.TrainNumber      ?? '101',
    LineCode:                overrides.LineCode         ?? 'RD',
    DirectionNum:            overrides.DirectionNum     ?? 1,
    CircuitId:               overrides.CircuitId        ?? 1000,
    ServiceType:             overrides.ServiceType      ?? 'Normal',
    DestinationStationCode:  overrides.DestinationStationCode ?? 'A11',
  };
}

// Helper to build a slim trip object (as stored in TripUpdate after poller computes it)
function makeTrip(trainId, delaySeconds) {
  const { classifyDelay } = require('../../lib/tripUpdateEnricher');
  return {
    tripId:       `trip-${trainId}`,
    trainId,
    vehicleId:    trainId,
    delaySeconds,
    delayLabel:   delaySeconds != null ? classifyDelay(delaySeconds) : null,
  };
}

// ── Summary counts with spread delays ────────────────────────────────────────

test('summary counts match spread delays across all categories', () => {
  const trains = [
    makeTrain({ TrainId: 'T1', LineCode: 'RD' }),  // early
    makeTrain({ TrainId: 'T2', LineCode: 'RD' }),  // on-time
    makeTrain({ TrainId: 'T3', LineCode: 'BL' }),  // slight delay
    makeTrain({ TrainId: 'T4', LineCode: 'BL' }),  // delay
    makeTrain({ TrainId: 'T5', LineCode: 'GR' }),  // significant delay
    makeTrain({ TrainId: 'T6', LineCode: 'GR' }),  // noPrediction
  ];
  const trips = [
    makeTrip('T1', -90),    // Early
    makeTrip('T2',  30),    // On Time
    makeTrip('T3', 150),    // Slight Delay
    makeTrip('T4', 400),    // Delay
    makeTrip('T5', 700),    // Significant Delay
    // T6 has no trip → noPrediction
  ];

  const result = computeScheduleAdherence(trains, trips, false, 0.9);

  expect(result.summary.total).toBe(6);
  expect(result.summary.early).toBe(1);
  expect(result.summary.onTime).toBe(1);
  expect(result.summary.slightDelay).toBe(1);
  expect(result.summary.delay).toBe(1);
  expect(result.summary.significantDelay).toBe(1);
  expect(result.summary.noPrediction).toBe(1);
});

// ── Per-line summaries ────────────────────────────────────────────────────────

test('lineSummaries group correctly by lineCode', () => {
  const trains = [
    makeTrain({ TrainId: 'T1', LineCode: 'RD' }),
    makeTrain({ TrainId: 'T2', LineCode: 'RD' }),
    makeTrain({ TrainId: 'T3', LineCode: 'BL' }),
  ];
  const trips = [
    makeTrip('T1', 30),    // On Time
    makeTrip('T2', 300),   // Delay
    makeTrip('T3', -90),   // Early
  ];

  const result = computeScheduleAdherence(trains, trips, false, 1.0);

  const rd = result.lineSummaries.find(l => l.lineCode === 'RD');
  expect(rd.total).toBe(2);
  expect(rd.onTime).toBe(1);
  expect(rd.delay).toBe(1);

  const bl = result.lineSummaries.find(l => l.lineCode === 'BL');
  expect(bl.total).toBe(1);
  expect(bl.early).toBe(1);
});

// ── coverageRate and degraded forwarded ───────────────────────────────────────

test('coverageRate < 0.80 → degraded=true in result', () => {
  const result = computeScheduleAdherence(
    [makeTrain({ TrainId: 'T1' })],
    [makeTrip('T1', 0)],
    true,   // degraded=true passed in
    0.72,   // coverageRate
  );
  expect(result.degraded).toBe(true);
  expect(result.coverageRate).toBeCloseTo(0.72);
});

test('coverageRate >= 0.80 → degraded=false', () => {
  const result = computeScheduleAdherence(
    [makeTrain({ TrainId: 'T1' })],
    [makeTrip('T1', 0)],
    false,
    0.95,
  );
  expect(result.degraded).toBe(false);
  expect(result.coverageRate).toBeCloseTo(0.95);
});

// ── VP join preferred over vehicleId fallback ─────────────────────────────────

test('trainId match preferred over vehicleId when both have data', () => {
  const trains = [makeTrain({ TrainId: 'T5', LineCode: 'OR' })];
  // Trip matched by trainId (200s); another trip with same vehicleId would give 600s
  const trips = [
    { tripId: 'trip-a', trainId: 'T5', vehicleId: 'V99', delaySeconds: 200, delayLabel: 'Slight Delay' },
    { tripId: 'trip-b', trainId: null,  vehicleId: 'T5', delaySeconds: 600, delayLabel: 'Significant Delay' },
  ];

  const result = computeScheduleAdherence(trains, trips, false, 1.0);
  expect(result.trains[0].delaySeconds).toBe(200);
  expect(result.trains[0].delayLabel).toBe('Slight Delay');
});

// ── Non-Normal service trains excluded ───────────────────────────────────────

test('trains with ServiceType !== Normal are excluded', () => {
  const trains = [
    makeTrain({ TrainId: 'T1', ServiceType: 'Normal' }),
    makeTrain({ TrainId: 'T2', ServiceType: 'NoPassengers' }),
    makeTrain({ TrainId: 'T3', ServiceType: 'Ghost' }),
  ];
  const trips = [
    makeTrip('T1', 0),
    makeTrip('T2', 0),
    makeTrip('T3', 0),
  ];

  const result = computeScheduleAdherence(trains, trips, false, 1.0);
  expect(result.summary.total).toBe(1);
  expect(result.trains).toHaveLength(1);
  expect(result.trains[0].trainId).toBe('T1');
});

// ── Trains without LineCode excluded ─────────────────────────────────────────

test('trains without LineCode are excluded', () => {
  const trains = [
    makeTrain({ TrainId: 'T1', LineCode: 'RD' }),
    { ...makeTrain({ TrainId: 'T2' }), LineCode: undefined },
  ];
  const trips = [makeTrip('T1', 50), makeTrip('T2', 50)];

  const result = computeScheduleAdherence(trains, trips, false, 1.0);
  expect(result.summary.total).toBe(1);
});

// ── Per-train record fields ───────────────────────────────────────────────────

test('train record includes tripId, delaySeconds, delayLabel, destinationCode', () => {
  const trains = [makeTrain({ TrainId: 'T1', LineCode: 'RD', DestinationStationCode: 'A11' })];
  const trips  = [{ tripId: 'trip-X', trainId: 'T1', vehicleId: null, delaySeconds: 45, delayLabel: 'On Time' }];

  const result = computeScheduleAdherence(trains, trips, false, 1.0);
  const rec = result.trains[0];
  expect(rec.tripId).toBe('trip-X');
  expect(rec.delaySeconds).toBe(45);
  expect(rec.delayLabel).toBe('On Time');
  expect(rec.destinationCode).toBe('A11');
});
