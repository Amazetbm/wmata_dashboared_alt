'use strict';

const { transit_realtime: { FeedMessage } } = require('gtfs-realtime-bindings');
const { decodeBusTripUpdates } = require('../../lib/gtfsRt/tripUpdateDecoder');

function buildFeed({ timestamp, entities = [] }) {
  return FeedMessage.encode({
    header: { gtfsRealtimeVersion: '2.0', incrementality: 0, timestamp: timestamp ?? Math.floor(Date.now() / 1000) },
    entity: entities,
  }).finish();
}

function busTripEntity(overrides = {}) {
  const tripUpdate = {
    trip: {
      tripId:               overrides.tripId   ?? 'BUS_T100',
      routeId:              overrides.routeId  ?? 'A11',
      startDate:            overrides.startDate ?? '20261116',
      scheduleRelationship: overrides.sr ?? 0,
    },
    vehicle:        { id: overrides.vehicleId ?? 'BUS_V001' },
    stopTimeUpdate: overrides.stus ?? [],
  };
  if (overrides.startTime !== undefined) tripUpdate.trip.startTime = overrides.startTime;
  if (overrides.delay !== undefined)     tripUpdate.delay = overrides.delay;
  return { id: overrides.id ?? 'e1', tripUpdate };
}

const feedTs = 1700000000;

// ── feedTimestamp ─────────────────────────────────────────────────────────────

test('extracts feedTimestamp from header.timestamp', () => {
  const buf = buildFeed({ timestamp: feedTs });
  const { feedTimestamp, feedTimestampSec } = decodeBusTripUpdates(buf);
  expect(feedTimestamp.getTime()).toBe(feedTs * 1000);
  expect(feedTimestampSec).toBe(feedTs);
});

// ── lineCode always null for bus ──────────────────────────────────────────────

test('lineCode is always null for bus trips (no ROUTE_TO_LINE mapping)', () => {
  const buf = buildFeed({ timestamp: feedTs, entities: [busTripEntity({ routeId: 'A11' })] });
  const { trips } = decodeBusTripUpdates(buf);
  expect(trips[0].lineCode).toBeNull();
  expect(trips[0].routeId).toBe('A11');
});

// ── refCandidates for SCHEDULED trips ────────────────────────────────────────

test('collects ALL future STUs into refCandidates (no cap)', () => {
  const buf = buildFeed({
    timestamp: feedTs,
    entities: [busTripEntity({
      stus: [
        { stopSequence: 1, arrival: { time: feedTs - 100 } },  // past — excluded
        { stopSequence: 2, arrival: { time: feedTs + 60 } },   // future 1
        { stopSequence: 3, arrival: { time: feedTs + 120 } },  // future 2
        { stopSequence: 4, arrival: { time: feedTs + 180 } },  // future 3
        { stopSequence: 5, arrival: { time: feedTs + 240 } },  // future 4
        { stopSequence: 6, arrival: { time: feedTs + 300 } },  // future 5
        { stopSequence: 7, arrival: { time: feedTs + 360 } },  // future 6 — now included (no cap)
      ],
    })],
  });
  const { trips } = decodeBusTripUpdates(buf);
  expect(trips[0].refCandidates).toHaveLength(6);
  expect(trips[0].refCandidates[0]).toEqual({ stopSequence: 2, actualTimeSec: feedTs + 60 });
  expect(trips[0].refCandidates[5]).toEqual({ stopSequence: 7, actualTimeSec: feedTs + 360 });
});

test('all past STUs → refCandidates = [] (noPrediction)', () => {
  const buf = buildFeed({
    timestamp: feedTs,
    entities: [busTripEntity({
      stus: [
        { stopSequence: 1, arrival: { time: feedTs - 200 } },
        { stopSequence: 2, arrival: { time: feedTs - 100 } },
      ],
    })],
  });
  const { trips } = decodeBusTripUpdates(buf);
  expect(trips[0].refCandidates).toEqual([]);
});

test('no STUs → refCandidates = [] (noPrediction)', () => {
  const buf = buildFeed({ timestamp: feedTs, entities: [busTripEntity({ stus: [] })] });
  const { trips } = decodeBusTripUpdates(buf);
  expect(trips[0].refCandidates).toEqual([]);
});

test('uses departure.time when arrival.time is absent', () => {
  const buf = buildFeed({
    timestamp: feedTs,
    entities: [busTripEntity({
      stus: [{ stopSequence: 1, departure: { time: feedTs + 60 } }],
    })],
  });
  const { trips } = decodeBusTripUpdates(buf);
  expect(trips[0].refCandidates).toHaveLength(1);
  expect(trips[0].refCandidates[0].actualTimeSec).toBe(feedTs + 60);
});

test('refCandidates sorted ascending by stopSequence even if feed is out of order', () => {
  const buf = buildFeed({
    timestamp: feedTs,
    entities: [busTripEntity({
      stus: [
        { stopSequence: 5, arrival: { time: feedTs + 300 } },
        { stopSequence: 2, arrival: { time: feedTs + 60 } },
        { stopSequence: 3, arrival: { time: feedTs + 120 } },
      ],
    })],
  });
  const { trips } = decodeBusTripUpdates(buf);
  const seqs = trips[0].refCandidates.map(c => c.stopSequence);
  expect(seqs).toEqual([2, 3, 5]);
});

// ── Non-SCHEDULED trips ───────────────────────────────────────────────────────

test('CANCELED trip (SR=3) has empty refCandidates regardless of STUs', () => {
  const buf = buildFeed({
    timestamp: feedTs,
    entities: [busTripEntity({
      sr: 3,
      stus: [{ stopSequence: 1, arrival: { time: feedTs + 100 } }],
    })],
  });
  const { trips } = decodeBusTripUpdates(buf);
  expect(trips[0].scheduleRelationship).toBe(3);
  expect(trips[0].refCandidates).toEqual([]);
});

test('ADDED trip (SR=1) has empty refCandidates', () => {
  const buf = buildFeed({
    timestamp: feedTs,
    entities: [busTripEntity({ sr: 1 })],
  });
  const { trips } = decodeBusTripUpdates(buf);
  expect(trips[0].scheduleRelationship).toBe(1);
  expect(trips[0].refCandidates).toEqual([]);
});

// ── routeId passed through ────────────────────────────────────────────────────

test('routeId is passed through from trip proto', () => {
  const buf = buildFeed({
    timestamp: feedTs,
    entities: [busTripEntity({ routeId: 'Z2' })],
  });
  const { trips } = decodeBusTripUpdates(buf);
  expect(trips[0].routeId).toBe('Z2');
});

// ── Slim output — no refStopSequence or refActualTimeSec fields ───────────────

test('returned trip has refCandidates but no refStopSequence field', () => {
  const buf = buildFeed({ timestamp: feedTs, entities: [busTripEntity()] });
  const { trips } = decodeBusTripUpdates(buf);
  expect(trips[0]).toHaveProperty('refCandidates');
  expect(trips[0]).not.toHaveProperty('refStopSequence');
  expect(trips[0]).not.toHaveProperty('refActualTimeSec');
});

// ── tripDelay (trip-level delay field) ────────────────────────────────────────

test('tripDelay decoded when tu.delay is present (positive)', () => {
  const buf = buildFeed({ timestamp: feedTs, entities: [busTripEntity({ delay: 180 })] });
  const { trips } = decodeBusTripUpdates(buf);
  expect(trips[0].tripDelay).toBe(180);
});

test('tripDelay decoded when tu.delay=0 (zero is a valid delay, not a protobuf default)', () => {
  const buf = buildFeed({ timestamp: feedTs, entities: [busTripEntity({ delay: 0 })] });
  const { trips } = decodeBusTripUpdates(buf);
  expect(trips[0].tripDelay).toBe(0);
});

test('tripDelay is null when tu.delay is not present', () => {
  const buf = buildFeed({ timestamp: feedTs, entities: [busTripEntity()] });
  const { trips } = decodeBusTripUpdates(buf);
  expect(trips[0].tripDelay).toBeNull();
});

// ── startTime ─────────────────────────────────────────────────────────────────

test('startTime decoded from trip.startTime', () => {
  const buf = buildFeed({ timestamp: feedTs, entities: [busTripEntity({ startTime: '08:30:00' })] });
  const { trips } = decodeBusTripUpdates(buf);
  expect(trips[0].startTime).toBe('08:30:00');
});

test('startTime is null when trip.startTime is absent', () => {
  const buf = buildFeed({ timestamp: feedTs, entities: [busTripEntity()] });
  const { trips } = decodeBusTripUpdates(buf);
  expect(trips[0].startTime).toBeNull();
});

// ── No cap: 10 future STUs → 10 candidates ───────────────────────────────────

test('10 future STUs produce 10 refCandidates (no cap)', () => {
  const stus = Array.from({ length: 10 }, (_, i) => ({
    stopSequence: i + 1,
    arrival: { time: feedTs + (i + 1) * 60 },
  }));
  const buf = buildFeed({ timestamp: feedTs, entities: [busTripEntity({ stus })] });
  const { trips } = decodeBusTripUpdates(buf);
  expect(trips[0].refCandidates).toHaveLength(10);
});
