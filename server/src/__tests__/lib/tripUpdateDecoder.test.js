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
        tripId: overrides.tripId ?? 'T100',
        routeId: overrides.routeId ?? 'RED',
        directionId: 0,
        startDate: '20261102',
        startTime: '08:00:00',
        scheduleRelationship: 0, // SCHEDULED
      },
      vehicle: { id: overrides.vehicleId ?? 'V001' },
      stopTimeUpdate: overrides.stus ?? [],
    },
  };
}

// ── feedTimestamp ─────────────────────────────────────────────────────────────

test('extracts feedTimestamp from header.timestamp', () => {
  const ts = 1700000000;
  const buf = buildFeed({ timestamp: ts });
  const { feedTimestamp } = decodeTripUpdates(buf);
  expect(feedTimestamp.getTime()).toBe(ts * 1000);
});

test('uses current time when header.timestamp is 0', () => {
  const before = Date.now();
  const buf = buildFeed({ timestamp: 0 });
  const { feedTimestamp } = decodeTripUpdates(buf);
  const after = Date.now();
  expect(feedTimestamp.getTime()).toBeGreaterThanOrEqual(before);
  expect(feedTimestamp.getTime()).toBeLessThanOrEqual(after);
});

// ── empty feed ────────────────────────────────────────────────────────────────

test('returns empty trips array for empty feed', () => {
  const buf = buildFeed({ entities: [] });
  const { trips } = decodeTripUpdates(buf);
  expect(trips).toEqual([]);
});

// ── ADDED trip excluded ───────────────────────────────────────────────────────

test('skips ADDED trips (scheduleRelationship=1)', () => {
  const buf = buildFeed({
    timestamp: 1700000000,
    entities: [
      {
        id: 'e_added',
        tripUpdate: {
          trip: {
            tripId: 'T_ADDED',
            routeId: 'BLUE',
            scheduleRelationship: 1, // ADDED
          },
          vehicle: { id: 'V999' },
          stopTimeUpdate: [],
        },
      },
    ],
  });
  const { trips } = decodeTripUpdates(buf);
  expect(trips).toHaveLength(0);
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
});

// ── ROUTE_TO_LINE mapping ─────────────────────────────────────────────────────

test.each([
  ['RED', 'RD'],
  ['BLUE', 'BL'],
  ['GREEN', 'GR'],
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

// ── STU extraction ────────────────────────────────────────────────────────────

test('extracts STU fields including arrivalTime, departureTime, delays', () => {
  const arrTs = 1700001000;
  const depTs = 1700000800;
  const buf = buildFeed({
    timestamp: 1700000000,
    entities: [
      scheduledTrip({
        stus: [
          {
            stopId: 'PF_A15_C',
            stopSequence: 1,
            departure: { time: depTs, delay: 30 },  // origin: departure only
          },
          {
            stopId: 'PF_A16_B',
            stopSequence: 2,
            arrival: { time: arrTs, delay: 45 },
          },
        ],
      }),
    ],
  });
  const { trips } = decodeTripUpdates(buf);
  expect(trips[0].stus).toHaveLength(2);

  // First STU: departure only
  expect(trips[0].stus[0].stopId).toBe('PF_A15_C');
  expect(trips[0].stus[0].stopSequence).toBe(1);
  expect(trips[0].stus[0].arrivalTime).toBeNull();
  expect(trips[0].stus[0].departureTime).toEqual(new Date(depTs * 1000));
  expect(trips[0].stus[0].arrivalDelay).toBeNull();
  expect(trips[0].stus[0].departureDelay).toBe(30);

  // Second STU: arrival
  expect(trips[0].stus[1].arrivalTime).toEqual(new Date(arrTs * 1000));
  expect(trips[0].stus[1].arrivalDelay).toBe(45);
});

// ── currentDelaySeconds — origin pattern (departure only) ────────────────────

test('currentDelaySeconds uses departureDelay when first STU has no arrivalDelay', () => {
  const buf = buildFeed({
    timestamp: 1700000000,
    entities: [
      scheduledTrip({
        stus: [
          { stopId: 'PF_A01_C', stopSequence: 1, departure: { time: 1700000800, delay: 30 } },
          { stopId: 'PF_A02_B', stopSequence: 2, arrival: { time: 1700001200, delay: 45 } },
        ],
      }),
    ],
  });
  const { trips } = decodeTripUpdates(buf);
  expect(trips[0].currentDelaySeconds).toBe(30);
});

test('currentDelaySeconds uses arrivalDelay when present on first STU', () => {
  const buf = buildFeed({
    timestamp: 1700000000,
    entities: [
      scheduledTrip({
        stus: [
          { stopId: 'PF_A02_B', stopSequence: 1, arrival: { time: 1700001200, delay: 120 } },
        ],
      }),
    ],
  });
  const { trips } = decodeTripUpdates(buf);
  expect(trips[0].currentDelaySeconds).toBe(120);
});

test('currentDelaySeconds is null when no STUs', () => {
  const buf = buildFeed({
    timestamp: 1700000000,
    entities: [scheduledTrip({ stus: [] })],
  });
  const { trips } = decodeTripUpdates(buf);
  expect(trips[0].currentDelaySeconds).toBeNull();
});

// ── timestamp 0 treated as null ───────────────────────────────────────────────

test('timestamp 0 treated as null (arrivalTime null)', () => {
  const buf = buildFeed({
    timestamp: 1700000000,
    entities: [
      scheduledTrip({
        stus: [
          { stopId: 'PF_A01_C', stopSequence: 1, arrival: { time: 0, delay: 60 } },
        ],
      }),
    ],
  });
  const { trips } = decodeTripUpdates(buf);
  expect(trips[0].stus[0].arrivalTime).toBeNull();
  // delay still extracted
  expect(trips[0].stus[0].arrivalDelay).toBe(60);
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
