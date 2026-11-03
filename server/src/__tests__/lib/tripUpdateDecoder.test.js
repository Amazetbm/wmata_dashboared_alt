'use strict';

const { transit_realtime: { FeedMessage } } = require('gtfs-realtime-bindings');
const { decodeTripUpdates } = require('../../lib/gtfsRt/tripUpdateDecoder');

function buildFeed({ timestamp, entities = [] }) {
  return FeedMessage.encode({
    header: {
      gtfsRealtimeVersion: '2.0',
      incrementality: 0,
      timestamp: timestamp ?? Math.floor(Date.now() / 1000),
    },
    entity: entities,
  }).finish();
}

function scheduledTrip(overrides = {}) {
  return {
    id: overrides.id ?? 'e1',
    tripUpdate: {
      trip: {
        tripId:               overrides.tripId   ?? 'T100',
        routeId:              overrides.routeId  ?? 'RED',
        directionId:          0,
        startDate:            overrides.startDate ?? '20261102',
        startTime:            '08:00:00',
        scheduleRelationship: overrides.sr ?? 0, // SCHEDULED
      },
      vehicle:        { id: overrides.vehicleId ?? 'V001' },
      stopTimeUpdate: overrides.stus ?? [],
    },
  };
}

// ── feedTimestamp ─────────────────────────────────────────────────────────────

test('extracts feedTimestamp from header.timestamp', () => {
  const ts = 1700000000;
  const buf = buildFeed({ timestamp: ts });
  const { feedTimestamp, feedTimestampSec } = decodeTripUpdates(buf);
  expect(feedTimestamp.getTime()).toBe(ts * 1000);
  expect(feedTimestampSec).toBe(ts);
});

test('uses current time when header.timestamp is 0', () => {
  const before = Math.floor(Date.now() / 1000);
  const buf = buildFeed({ timestamp: 0 });
  const { feedTimestampSec } = decodeTripUpdates(buf);
  const after = Math.floor(Date.now() / 1000);
  expect(feedTimestampSec).toBeGreaterThanOrEqual(before);
  expect(feedTimestampSec).toBeLessThanOrEqual(after);
});

// ── empty feed ────────────────────────────────────────────────────────────────

test('returns empty trips array for empty feed', () => {
  const buf = buildFeed({ entities: [] });
  const { trips } = decodeTripUpdates(buf);
  expect(trips).toEqual([]);
});

// ── Non-SCHEDULED trips passed through with correct scheduleRelationship ──────

test('passes through UNSCHEDULED trip (SR=2) with scheduleRelationship=2', () => {
  const buf = buildFeed({
    timestamp: 1700000000,
    entities: [scheduledTrip({ sr: 2, tripId: 'T_NR' })],
  });
  const { trips } = decodeTripUpdates(buf);
  expect(trips).toHaveLength(1);
  expect(trips[0].scheduleRelationship).toBe(2);
  expect(trips[0].tripId).toBe('T_NR');
  // Non-SCHEDULED → no reference stop lookup
  expect(trips[0].refStopSequence).toBeNull();
  expect(trips[0].refActualTimeSec).toBeNull();
});

test('passes through ADDED trip (SR=1) with scheduleRelationship=1', () => {
  const buf = buildFeed({
    timestamp: 1700000000,
    entities: [scheduledTrip({ sr: 1, tripId: 'T_ADDED' })],
  });
  const { trips } = decodeTripUpdates(buf);
  expect(trips).toHaveLength(1);
  expect(trips[0].scheduleRelationship).toBe(1);
  expect(trips[0].refStopSequence).toBeNull();
});

test('passes through CANCELED trip (SR=3) with scheduleRelationship=3 and no reference stop', () => {
  const feedTs = 1700000000;
  const buf = buildFeed({
    timestamp: feedTs,
    entities: [
      scheduledTrip({
        sr: 3,
        tripId: 'T_CANCELED',
        // STUs present but should be ignored for non-SCHEDULED
        stus: [{ stopId: 'PF_A01_C', stopSequence: 1, arrival: { time: feedTs + 200 } }],
      }),
    ],
  });
  const { trips } = decodeTripUpdates(buf);
  expect(trips).toHaveLength(1);
  expect(trips[0].scheduleRelationship).toBe(3);
  expect(trips[0].refStopSequence).toBeNull();
  expect(trips[0].refActualTimeSec).toBeNull();
});

// ── SCHEDULED trip included ───────────────────────────────────────────────────

test('includes SCHEDULED trip and maps routeId to lineCode', () => {
  const buf = buildFeed({
    timestamp: 1700000000,
    entities: [scheduledTrip({ routeId: 'RED', vehicleId: 'V001' })],
  });
  const { trips } = decodeTripUpdates(buf);
  expect(trips).toHaveLength(1);
  expect(trips[0].routeId).toBe('RED');
  expect(trips[0].lineCode).toBe('RD');
  expect(trips[0].vehicleId).toBe('V001');
  // SR=0 → scheduleRelationship=0
  expect(trips[0].scheduleRelationship).toBe(0);
});

test('includes trip when scheduleRelationship is absent (null treated as SCHEDULED)', () => {
  const buf = buildFeed({
    timestamp: 1700000000,
    entities: [
      {
        id: 'e_null_sr',
        tripUpdate: {
          trip: { tripId: 'T_NULL', routeId: 'BLUE' },
          vehicle: { id: 'V_NULL' },
          stopTimeUpdate: [],
        },
      },
    ],
  });
  const { trips } = decodeTripUpdates(buf);
  expect(trips).toHaveLength(1);
  expect(trips[0].lineCode).toBe('BL');
  // Absent SR in protobuf3 → decoded as default value 0; scheduleRelationship=0
  expect(trips[0].scheduleRelationship).toBe(0);
});

// ── ROUTE_TO_LINE mapping ─────────────────────────────────────────────────────

test.each([
  ['RED',    'RD'],
  ['BLUE',   'BL'],
  ['GREEN',  'GR'],
  ['YELLOW', 'YL'],
  ['ORANGE', 'OR'],
  ['SILVER', 'SV'],
])('maps routeId %s to lineCode %s', (routeId, expected) => {
  const buf = buildFeed({
    timestamp: 1700000000,
    entities: [scheduledTrip({ routeId })],
  });
  const { trips } = decodeTripUpdates(buf);
  expect(trips[0].lineCode).toBe(expected);
});

test('lineCode is null for unknown routeId', () => {
  const buf = buildFeed({
    timestamp: 1700000000,
    entities: [scheduledTrip({ routeId: 'UNKNOWN' })],
  });
  const { trips } = decodeTripUpdates(buf);
  expect(trips[0].lineCode).toBeNull();
});

// ── startDate passed through ──────────────────────────────────────────────────

test('startDate is passed through from trip proto', () => {
  const buf = buildFeed({
    timestamp: 1700000000,
    entities: [scheduledTrip({ startDate: '20261102' })],
  });
  const { trips } = decodeTripUpdates(buf);
  expect(trips[0].startDate).toBe('20261102');
});

// ── First future STU selection ────────────────────────────────────────────────

test('refActualTimeSec is first STU with time >= feedTimestampSec (arrival)', () => {
  const feedTs = 1700000000;
  const buf = buildFeed({
    timestamp: feedTs,
    entities: [
      scheduledTrip({
        stus: [
          // past: feedTs - 100
          { stopId: 'PF_A01_C', stopSequence: 1, arrival: { time: feedTs - 100 } },
          // future: feedTs + 200 ← should pick this
          { stopId: 'PF_A02_C', stopSequence: 2, arrival: { time: feedTs + 200 } },
          { stopId: 'PF_A03_C', stopSequence: 3, arrival: { time: feedTs + 500 } },
        ],
      }),
    ],
  });
  const { trips } = decodeTripUpdates(buf);
  expect(trips[0].refStopSequence).toBe(2);
  expect(trips[0].refStopId).toBe('PF_A02_C');
  expect(trips[0].refActualTimeSec).toBe(feedTs + 200);
});

test('refActualTimeSec uses departure when no arrival.time present', () => {
  const feedTs = 1700000000;
  const buf = buildFeed({
    timestamp: feedTs,
    entities: [
      scheduledTrip({
        stus: [
          { stopId: 'PF_A01_C', stopSequence: 1, departure: { time: feedTs + 60 } },
        ],
      }),
    ],
  });
  const { trips } = decodeTripUpdates(buf);
  expect(trips[0].refActualTimeSec).toBe(feedTs + 60);
  expect(trips[0].refStopSequence).toBe(1);
});

test('all past STUs → refStopSequence null and refActualTimeSec null (noPrediction)', () => {
  const feedTs = 1700000000;
  const buf = buildFeed({
    timestamp: feedTs,
    entities: [
      scheduledTrip({
        stus: [
          { stopId: 'PF_A01_C', stopSequence: 1, arrival: { time: feedTs - 800 } },
          { stopId: 'PF_A02_C', stopSequence: 2, arrival: { time: feedTs - 200 } },
        ],
      }),
    ],
  });
  const { trips } = decodeTripUpdates(buf);
  expect(trips[0].refStopSequence).toBeNull();
  expect(trips[0].refActualTimeSec).toBeNull();
  expect(trips[0].refStopId).toBeNull();
});

test('no STUs → refStopSequence null (noPrediction)', () => {
  const feedTs = 1700000000;
  const buf = buildFeed({
    timestamp: feedTs,
    entities: [scheduledTrip({ stus: [] })],
  });
  const { trips } = decodeTripUpdates(buf);
  expect(trips[0].refStopSequence).toBeNull();
  expect(trips[0].refActualTimeSec).toBeNull();
});

// ── Field presence: absence of time field treated as null ────────────────────

test('arrival.time=0 treated as null (not a real timestamp)', () => {
  const feedTs = 1700000000;
  const buf = buildFeed({
    timestamp: feedTs,
    entities: [
      scheduledTrip({
        stus: [
          { stopId: 'PF_A01_C', stopSequence: 1, arrival: { time: 0 } },
          { stopId: 'PF_A02_C', stopSequence: 2, arrival: { time: feedTs + 100 } },
        ],
      }),
    ],
  });
  const { trips } = decodeTripUpdates(buf);
  // time=0 should be ignored; first real future STU is seq 2
  expect(trips[0].refStopSequence).toBe(2);
  expect(trips[0].refActualTimeSec).toBe(feedTs + 100);
});

// ── Slim output — no stus array ───────────────────────────────────────────────

test('returned trip has no stus field', () => {
  const buf = buildFeed({
    timestamp: 1700000000,
    entities: [scheduledTrip({ stus: [{ stopId: 'PF_A01_C', stopSequence: 1, arrival: { time: 1700001000 } }] })],
  });
  const { trips } = decodeTripUpdates(buf);
  expect(trips[0]).not.toHaveProperty('stus');
  expect(trips[0]).not.toHaveProperty('currentDelaySeconds');
});

// ── vehicle.id location ───────────────────────────────────────────────────────

test('vehicle.id is at tripUpdate.vehicle.id (not entity.vehicle)', () => {
  const buf = buildFeed({
    timestamp: 1700000000,
    entities: [scheduledTrip({ vehicleId: 'TRAIN_42' })],
  });
  const { trips } = decodeTripUpdates(buf);
  expect(trips[0].vehicleId).toBe('TRAIN_42');
});
