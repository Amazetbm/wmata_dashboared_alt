'use strict';

const { MongoMemoryServer } = require('mongodb-memory-server');
const mongoose = require('mongoose');

const GtfsVersion = require('../../models/GtfsVersion');
const GtfsStopTime = require('../../models/GtfsStopTime');
const { computeBusScheduleAdherence, lookupBusScheduledTimes, classifyBusDelay } = require('../../jobs/poller');

let mongod;

beforeAll(async () => {
  mongod = await MongoMemoryServer.create();
  await mongoose.connect(mongod.getUri());
});

afterAll(async () => {
  await mongoose.disconnect();
  await mongod.stop();
});

afterEach(async () => {
  const db = mongoose.connection.db;
  const cols = await db.listCollections().toArray();
  for (const c of cols) await db.dropCollection(c.name).catch(() => {});
});

// ── classifyBusDelay ──────────────────────────────────────────────────────────

describe('classifyBusDelay (default thresholds: early=120, onTime=420, minor=900)', () => {
  // Default env: BUS_SCHEDULE_EARLY_SEC=120, BUS_SCHEDULE_ONTIME_SEC=420, BUS_SCHEDULE_MINOR_SEC=900
  test('negative beyond early threshold → early', () => {
    expect(classifyBusDelay(-121)).toBe('early');
  });
  test('exactly -120 → early', () => {
    expect(classifyBusDelay(-120)).toBe('early');
  });
  test('0 seconds → onTime', () => {
    expect(classifyBusDelay(0)).toBe('onTime');
  });
  test('+420 seconds → onTime', () => {
    expect(classifyBusDelay(420)).toBe('onTime');
  });
  test('+421 seconds → minor', () => {
    expect(classifyBusDelay(421)).toBe('minor');
  });
  test('+900 seconds → minor', () => {
    expect(classifyBusDelay(900)).toBe('minor');
  });
  test('+901 seconds → significant', () => {
    expect(classifyBusDelay(901)).toBe('significant');
  });
});

// ── computeBusScheduleAdherence ───────────────────────────────────────────────

function makeBusTrip(overrides = {}) {
  return {
    tripId:               overrides.tripId               ?? 'BUS_T001',
    routeId:              overrides.routeId              ?? 'A11',
    vehicleId:            'vehicleId' in overrides ? overrides.vehicleId : 'V001',
    delaySeconds:         overrides.delaySeconds         ?? null,
    delayLabel:           overrides.delayLabel           ?? null,
    scheduleRelationship: overrides.scheduleRelationship ?? 0,
  };
}

test('SCHEDULED trip with no delay → noPrediction', () => {
  const result = computeBusScheduleAdherence([makeBusTrip()], false, 0.9);
  expect(result.summary.total).toBe(1);
  expect(result.summary.noPrediction).toBe(1);
  expect(result.summary.onTime).toBe(0);
});

test('SCHEDULED on-time → onTime in summary and routeSummary', () => {
  const result = computeBusScheduleAdherence([makeBusTrip({ delaySeconds: 60, delayLabel: 'onTime' })], false, 1.0);
  expect(result.summary.onTime).toBe(1);
  expect(result.routeSummaries[0].routeId).toBe('A11');
  expect(result.routeSummaries[0].onTime).toBe(1);
});

test('CANCELED trip (SR=3) counted in canceled', () => {
  const result = computeBusScheduleAdherence([makeBusTrip({ scheduleRelationship: 3 })], false, 1.0);
  expect(result.summary.canceled).toBe(1);
  expect(result.summary.total).toBe(0);
});

test('ADDED trip (SR=1) counted in added', () => {
  const result = computeBusScheduleAdherence([makeBusTrip({ scheduleRelationship: 1 })], false, 1.0);
  expect(result.summary.added).toBe(1);
});

test('UNSCHEDULED trip (SR=2) counted in unscheduled', () => {
  const result = computeBusScheduleAdherence([makeBusTrip({ scheduleRelationship: 2 })], false, 1.0);
  expect(result.summary.unscheduled).toBe(1);
});

test('groups by routeId correctly with multiple routes', () => {
  const trips = [
    makeBusTrip({ routeId: 'A11', vehicleId: 'V1', delaySeconds: 60,  delayLabel: 'onTime' }),
    makeBusTrip({ routeId: 'A11', vehicleId: 'V2', delaySeconds: 500, delayLabel: 'minor' }),
    makeBusTrip({ routeId: 'B30', vehicleId: 'V3', delaySeconds: 60,  delayLabel: 'onTime' }),
  ];
  const result = computeBusScheduleAdherence(trips, false, 1.0);
  expect(result.summary.total).toBe(3);

  const a11 = result.routeSummaries.find(r => r.routeId === 'A11');
  expect(a11.total).toBe(2);
  expect(a11.onTime).toBe(1);
  expect(a11.minor).toBe(1);

  const b30 = result.routeSummaries.find(r => r.routeId === 'B30');
  expect(b30.total).toBe(1);
  expect(b30.onTime).toBe(1);
});

test('buses array contains SCHEDULED trips with vehicleId', () => {
  const trips = [
    makeBusTrip({ vehicleId: 'V1', delaySeconds: 60, delayLabel: 'onTime' }),
    makeBusTrip({ vehicleId: null, delaySeconds: 60, delayLabel: 'onTime' }), // no vehicleId — excluded
  ];
  const result = computeBusScheduleAdherence(trips, false, 1.0);
  expect(result.buses).toHaveLength(1);
  expect(result.buses[0].vehicleId).toBe('V1');
});

test('degraded and coverageRate are passed through', () => {
  const result = computeBusScheduleAdherence([], true, 0.55);
  expect(result.degraded).toBe(true);
  expect(result.coverageRate).toBe(0.55);
});

// ── lookupBusScheduledTimes ───────────────────────────────────────────────────

async function makeVersion(status = 'active', mode = 'bus') {
  return GtfsVersion.create({
    feedHash: `hash-${Date.now()}-${Math.random()}`,
    feedDate: '20261116',
    mode,
    status,
  });
}

async function makeStopTime(versionId, tripId, stopSequence, arrivalSec = 3600) {
  return GtfsStopTime.create({ version: versionId, tripId, stopId: 'BUS_STOP_1', stopSequence, arrivalSec, departureSec: arrivalSec });
}

test('first candidate that matches wins; subsequent candidates not needed', async () => {
  const v = await makeVersion('active', 'bus');
  await makeStopTime(v._id, 'BUS_T1', 3, 3600);  // seq 3 exists
  await makeStopTime(v._id, 'BUS_T1', 5, 3700);  // seq 5 also exists

  const trip = {
    tripId: 'BUS_T1',
    refCandidates: [
      { stopSequence: 3, actualTimeSec: 3800 }, // first → should win
      { stopSequence: 5, actualTimeSec: 3900 },
    ],
  };

  await lookupBusScheduledTimes([trip], [{ _id: v._id, status: 'active', feedDate: '20261116' }]);

  expect(trip.refStopSequence).toBe(3);
  expect(trip.refActualTimeSec).toBe(3800);
});

test('falls through to second candidate when first does not exist in static', async () => {
  const v = await makeVersion('active', 'bus');
  // seq 2 does not exist; seq 4 does
  await makeStopTime(v._id, 'BUS_T2', 4, 3600);

  const trip = {
    tripId: 'BUS_T2',
    refCandidates: [
      { stopSequence: 2, actualTimeSec: 3700 }, // miss
      { stopSequence: 4, actualTimeSec: 3800 }, // hit
    ],
  };

  await lookupBusScheduledTimes([trip], [{ _id: v._id, status: 'active', feedDate: '20261116' }]);

  expect(trip.refStopSequence).toBe(4);
});

test('all candidates miss → trip.refStopSequence stays undefined (noPrediction)', async () => {
  const v = await makeVersion('active', 'bus');

  const trip = {
    tripId: 'BUS_T3',
    refCandidates: [
      { stopSequence: 1, actualTimeSec: 3700 },
      { stopSequence: 2, actualTimeSec: 3800 },
    ],
  };

  await lookupBusScheduledTimes([trip], [{ _id: v._id, status: 'active', feedDate: '20261116' }]);

  expect(trip.refStopSequence).toBeUndefined();
});

test('active version overrides previous version on same key', async () => {
  const prevV = await makeVersion('previous', 'bus');
  const actV  = await makeVersion('active',   'bus');

  await makeStopTime(prevV._id, 'BUS_T4', 1, 3600);
  await makeStopTime(actV._id,  'BUS_T4', 1, 4000);

  const trip = {
    tripId: 'BUS_T4',
    refCandidates: [{ stopSequence: 1, actualTimeSec: 5000 }],
  };

  const { schedMap, matchedActive, matchedPrevious } = await lookupBusScheduledTimes(
    [trip],
    [
      { _id: prevV._id, status: 'previous', feedDate: '20261115' },
      { _id: actV._id,  status: 'active',   feedDate: '20261116' },
    ],
  );

  const entry = schedMap.get('BUS_T4:1');
  expect(entry?.source).toBe('active');
  expect(matchedActive).toBe(1);
  expect(matchedPrevious).toBe(0);
});

test('empty matchableTrips returns empty schedMap', async () => {
  const v = await makeVersion('active', 'bus');
  const { schedMap, matchedActive, matchedPrevious } = await lookupBusScheduledTimes(
    [],
    [{ _id: v._id, status: 'active', feedDate: '20261116' }],
  );
  expect(schedMap.size).toBe(0);
  expect(matchedActive).toBe(0);
  expect(matchedPrevious).toBe(0);
});
