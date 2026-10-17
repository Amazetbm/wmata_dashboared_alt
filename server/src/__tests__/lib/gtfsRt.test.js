'use strict';

const { transit_realtime: { FeedMessage } } = require('gtfs-realtime-bindings');
const { decodeVehiclePositions } = require('../../lib/gtfsRt');

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

test('extracts feedTimestamp from header.timestamp', () => {
  const ts = 1700000000; // 2023-11-14T22:13:20Z
  const buf = buildFeed({ timestamp: ts });
  const { feedTimestamp } = decodeVehiclePositions(buf);
  expect(feedTimestamp.getTime()).toBe(ts * 1000);
});

test('uses current time when header.timestamp is missing', () => {
  const before = Date.now();
  const buf = buildFeed({ timestamp: 0 });
  const { feedTimestamp } = decodeVehiclePositions(buf);
  const after = Date.now();
  expect(feedTimestamp.getTime()).toBeGreaterThanOrEqual(before);
  expect(feedTimestamp.getTime()).toBeLessThanOrEqual(after);
});

test('returns empty vehicles array for empty feed', () => {
  const buf = buildFeed({ entities: [] });
  const { vehicles } = decodeVehiclePositions(buf);
  expect(vehicles).toEqual([]);
});

test('extracts vehicleId, vehicleLabel, occupancyStatus, lat, lon', () => {
  const buf = buildFeed({
    timestamp: 1700000000,
    entities: [
      {
        id: 'e1',
        vehicle: {
          vehicle: { id: 'V001', label: '1234' },
          occupancyStatus: 1,
          position: { latitude: 38.9, longitude: -77.0 },
        },
      },
    ],
  });
  const { vehicles } = decodeVehiclePositions(buf);
  expect(vehicles).toHaveLength(1);
  expect(vehicles[0].vehicleId).toBe('V001');
  expect(vehicles[0].vehicleLabel).toBe('1234');
  expect(vehicles[0].occupancyStatus).toBe(1);
  expect(vehicles[0].lat).toBeCloseTo(38.9, 3);
  expect(vehicles[0].lon).toBeCloseTo(-77.0, 3);
});

test('defaults to null for missing position fields', () => {
  const buf = buildFeed({
    timestamp: 1700000000,
    entities: [
      {
        id: 'e2',
        vehicle: {
          vehicle: { id: 'V002' },
          occupancyStatus: 2,
          // no position
        },
      },
    ],
  });
  const { vehicles } = decodeVehiclePositions(buf);
  expect(vehicles[0].lat).toBeNull();
  expect(vehicles[0].lon).toBeNull();
});

test('defaults occupancyStatus to 0 when not present', () => {
  const buf = buildFeed({
    timestamp: 1700000000,
    entities: [
      {
        id: 'e3',
        vehicle: {
          vehicle: { id: 'V003' },
          // no occupancyStatus
        },
      },
    ],
  });
  const { vehicles } = decodeVehiclePositions(buf);
  expect(vehicles[0].occupancyStatus).toBe(0);
});

test('skips entities without vehicle field', () => {
  const buf = buildFeed({
    timestamp: 1700000000,
    entities: [
      { id: 'e4', alert: {} },
    ],
  });
  const { vehicles } = decodeVehiclePositions(buf);
  expect(vehicles).toHaveLength(0);
});
