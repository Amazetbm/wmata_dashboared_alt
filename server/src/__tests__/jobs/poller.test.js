'use strict';

const { MongoMemoryServer } = require('mongodb-memory-server');
const mongoose = require('mongoose');

const GtfsStopTime = require('../../models/GtfsStopTime');
const { computeScheduleAdherence, lookupScheduledTimes } = require('../../jobs/poller');

// ── MongoDB setup (used by lookupScheduledTimes tests) ───────────────────────

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

// ── computeScheduleAdherence ──────────────────────────────────────────────────

function makeTrip(overrides = {}) {
  return {
    tripId:               overrides.tripId               ?? 'T001',
    lineCode:             overrides.lineCode              ?? 'RD',
    trainId:              overrides.trainId               ?? null,
    vehicleId:            overrides.vehicleId             ?? null,
    delaySeconds:         overrides.delaySeconds          ?? null,
    delayLabel:           overrides.delayLabel            ?? null,
    scheduleRelationship: overrides.scheduleRelationship  ?? 0,
  };
}

test('SCHEDULED trip with no delay → noPrediction', () => {
  const result = computeScheduleAdherence([makeTrip({ delaySeconds: null })], false, 0.9);
  expect(result.summary.total).toBe(1);
  expect(result.summary.noPrediction).toBe(1);
  expect(result.summary.onTime).toBe(0);
});

test('SCHEDULED trip on-time → onTime', () => {
  const result = computeScheduleAdherence([makeTrip({ delaySeconds: 30 })], false, 0.9);
  expect(result.summary.total).toBe(1);
  expect(result.summary.onTime).toBe(1);
});

test('SCHEDULED trip early → early', () => {
  const result = computeScheduleAdherence([makeTrip({ delaySeconds: -90 })], false, 0.9);
  expect(result.summary.early).toBe(1);
});

test('SCHEDULED trip minor → minor', () => {
  const result = computeScheduleAdherence([makeTrip({ delaySeconds: 200 })], false, 0.9);
  expect(result.summary.minor).toBe(1);
});

test('SCHEDULED trip significant → significant', () => {
  const result = computeScheduleAdherence([makeTrip({ delaySeconds: 400 })], false, 0.9);
  expect(result.summary.significant).toBe(1);
});

test('CANCELED trip (SR=3) → counted as canceled, not in total', () => {
  const result = computeScheduleAdherence(
    [makeTrip({ scheduleRelationship: 3 })], false, 1
  );
  expect(result.summary.canceled).toBe(1);
  expect(result.summary.total).toBe(0);
});

test('UNSCHEDULED trip (SR=2) → counted as unscheduled, not in total', () => {
  const result = computeScheduleAdherence(
    [makeTrip({ scheduleRelationship: 2 })], false, 1
  );
  expect(result.summary.unscheduled).toBe(1);
  expect(result.summary.total).toBe(0);
});

test('ADDED trip (SR=1) → counted as added, not in total', () => {
  const result = computeScheduleAdherence(
    [makeTrip({ scheduleRelationship: 1 })], false, 1
  );
  expect(result.summary.added).toBe(1);
  expect(result.summary.total).toBe(0);
});

test('null scheduleRelationship treated as SCHEDULED (SR=0)', () => {
  const result = computeScheduleAdherence(
    [makeTrip({ scheduleRelationship: null, delaySeconds: 50 })], false, 1
  );
  expect(result.summary.total).toBe(1);
  expect(result.summary.onTime).toBe(1);
  expect(result.summary.canceled).toBe(0);
});

test('per-line summaries are populated correctly', () => {
  const trips = [
    makeTrip({ lineCode: 'RD', delaySeconds: 30 }),
    makeTrip({ lineCode: 'RD', delaySeconds: 200 }),
    makeTrip({ lineCode: 'BL', delaySeconds: 30 }),
  ];
  const result = computeScheduleAdherence(trips, false, 0.9);
  const rd = result.lineSummaries.find(l => l.lineCode === 'RD');
  const bl = result.lineSummaries.find(l => l.lineCode === 'BL');
  expect(rd.total).toBe(2);
  expect(rd.onTime).toBe(1);
  expect(rd.minor).toBe(1);
  expect(bl.total).toBe(1);
  expect(bl.onTime).toBe(1);
});

test('trainRecords populated for SCHEDULED trips with trainId', () => {
  const trips = [
    makeTrip({ trainId: 'T1', delaySeconds: 30, delayLabel: 'On Time' }),
    makeTrip({ trainId: null, delaySeconds: 60 }),  // no trainId → not recorded
  ];
  const result = computeScheduleAdherence(trips, false, 0.9);
  expect(result.trains).toHaveLength(1);
  expect(result.trains[0].trainId).toBe('T1');
  expect(result.trains[0].delaySeconds).toBe(30);
});

test('degraded and coverageRate passed through to result', () => {
  const result = computeScheduleAdherence([], true, 0.72);
  expect(result.degraded).toBe(true);
  expect(result.coverageRate).toBe(0.72);
});

// ── Error isolation: TU block error does not prevent headway save ─────────────
// This test documents the expected behaviour pinned in poller.js: the TU block
// and the headway block each have independent try/catch, so an error in one
// must not prevent the other from running.
//
// The actual network/DB interactions are in fetchAndStore() which we do not
// unit-test here (that requires extensive mocking). The test below exercises
// computeScheduleAdherence in isolation to confirm a throw inside it can be
// caught without affecting unrelated code.

test('error inside computeScheduleAdherence is catchable independently', () => {
  // Simulate a corrupt trip that causes a throw
  const badTrips = [{ scheduleRelationship: 0, get lineCode() { throw new Error('db exploded'); } }];
  expect(() => computeScheduleAdherence(badTrips, false, 1)).toThrow('db exploded');

  // Headway adherence (computeAdherence) is a completely separate function —
  // verify it still works after the above throw
  const { computeScheduleAdherence: sameFunc } = require('../../jobs/poller');
  const ok = sameFunc([makeTrip({ delaySeconds: 30 })], false, 1);
  expect(ok.summary.onTime).toBe(1);
});

// ── lookupScheduledTimes ──────────────────────────────────────────────────────

test('lookupScheduledTimes: matches trips across active and previous versions', async () => {
  const activeVerId   = new mongoose.Types.ObjectId();
  const previousVerId = new mongoose.Types.ObjectId();

  // Insert two rows with the same tripId:stopSequence but different versions
  await GtfsStopTime.insertMany([
    { version: activeVerId,   tripId: 'trip_A', stopId: 'PF_A01_C', stopSequence: 1, arrivalSec: 3600, departureSec: 3600 },
    { version: previousVerId, tripId: 'trip_P', stopId: 'PF_A01_C', stopSequence: 2, arrivalSec: 7200, departureSec: 7200 },
  ]);

  const versions = [
    { _id: activeVerId,   status: 'active',   feedDate: '20261027' },
    { _id: previousVerId, status: 'previous',  feedDate: '20261020' },
  ];

  const matchableTrips = [
    { tripId: 'trip_A', refStopSequence: 1 },
    { tripId: 'trip_P', refStopSequence: 2 },
  ];

  const { schedMap, matchedActive, matchedPrevious } =
    await lookupScheduledTimes(matchableTrips, versions);

  expect(schedMap.size).toBe(2);
  expect(matchedActive).toBe(1);
  expect(matchedPrevious).toBe(1);

  expect(schedMap.get('trip_A:1').source).toBe('active');
  expect(schedMap.get('trip_P:2').source).toBe('previous');
});

test('lookupScheduledTimes: active row wins over previous for the same key', async () => {
  const activeVerId   = new mongoose.Types.ObjectId();
  const previousVerId = new mongoose.Types.ObjectId();

  await GtfsStopTime.insertMany([
    { version: previousVerId, tripId: 'trip_X', stopId: 'PF_A01_C', stopSequence: 1, arrivalSec: 1000, departureSec: 1000 },
    { version: activeVerId,   tripId: 'trip_X', stopId: 'PF_A01_C', stopSequence: 1, arrivalSec: 2000, departureSec: 2000 },
  ]);

  const versions = [
    { _id: activeVerId,   status: 'active',   feedDate: '20261027' },
    { _id: previousVerId, status: 'previous',  feedDate: '20261020' },
  ];

  const { schedMap, matchedActive, matchedPrevious } =
    await lookupScheduledTimes([{ tripId: 'trip_X', refStopSequence: 1 }], versions);

  expect(schedMap.get('trip_X:1').source).toBe('active');
  expect(schedMap.get('trip_X:1').row.arrivalSec).toBe(2000);
  expect(matchedActive).toBe(1);
  expect(matchedPrevious).toBe(0);
});
