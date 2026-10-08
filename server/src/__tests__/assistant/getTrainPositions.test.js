'use strict';

jest.mock('../../models/AdherenceSnapshot');
jest.mock('../../lib/railGeometry');

const AdherenceSnapshot = require('../../models/AdherenceSnapshot');
const railGeometry      = require('../../lib/railGeometry');
const { getTrainPositions } = require('../../assistant/toolHandlers/getTrainPositions');

// ── Fixtures ──────────────────────────────────────────────────────────────────

const snapshotAt = new Date('2026-10-08T12:00:00Z');

const snapshotDoc = {
  snapshotAt,
  summary: { total: 2, onTime: 1, minor: 1, significant: 0 },
  lineSummaries: [{ lineCode: 'RD', total: 2, onTime: 1, minor: 1, significant: 0 }],
  trains: [
    {
      trainId: 'T1', lineCode: 'RD', carCount: 6, status: 'on-time',
      circuitId: 101, currentSeq: 10, expectedSeq: 10, deviation: 0,
      destinationCode: 'B35',
    },
    {
      trainId: 'T2', lineCode: 'RD', carCount: 8, status: 'minor',
      circuitId: 102, currentSeq: 15, expectedSeq: 12, deviation: 3,
      destinationCode: null,
    },
  ],
};

const stationsMap = new Map([
  ['B35', { Name: 'Shady Grove', Lat: 39.119, Lon: -77.165 }],
  ['A01', { Name: 'Metro Center', Lat: 38.898, Lon: -77.028 }],
]);

const standardRoutes = [
  {
    LineCode: 'RD', TrackNum: 1,
    TrackCircuits: [
      { SeqNum: 1, CircuitId: 101, StationCode: 'A01' },
      { SeqNum: 2, CircuitId: 102 },
    ],
  },
];

// bracketMap produced by buildCircuitStationBracketMap for the fixture routes above
const bracketMap = {
  101: { atStation: { code: 'A01', name: 'Metro Center' } },
  102: { yard: true },
};

// ── Setup ─────────────────────────────────────────────────────────────────────

beforeEach(() => {
  // Mock AdherenceSnapshot.findOne() chain
  AdherenceSnapshot.findOne.mockReturnValue({
    sort: jest.fn().mockReturnValue({
      lean: jest.fn().mockResolvedValue(snapshotDoc),
    }),
  });

  railGeometry.getStations.mockResolvedValue(stationsMap);
  railGeometry.getStandardRoutes.mockResolvedValue(standardRoutes);
  railGeometry.buildCircuitStationBracketMap.mockReturnValue(bracketMap);
  railGeometry.describeLocation.mockImplementation(entry => {
    if (!entry) return 'unknown';
    if (entry.atStation)   return `at ${entry.atStation.name} (${entry.atStation.code})`;
    if (entry.yard)        return 'in yard';
    return 'unknown';
  });
});

// ── Tests ─────────────────────────────────────────────────────────────────────

test('returns enriched trains with location and destination', async () => {
  const result = await getTrainPositions();

  expect(result.trains).toHaveLength(2);

  const t1 = result.trains[0];
  expect(t1.trainId).toBe('T1');
  expect(t1.location).toBe('at Metro Center (A01)');
  expect(t1.destination).toBe('Shady Grove');

  const t2 = result.trains[1];
  expect(t2.trainId).toBe('T2');
  expect(t2.location).toBe('in yard');
  expect(t2.destination).toBe('unknown');  // destinationCode: null
});

test('drops internal adherence fields from output', async () => {
  const result = await getTrainPositions();
  const t = result.trains[0];

  expect(t).not.toHaveProperty('circuitId');
  expect(t).not.toHaveProperty('currentSeq');
  expect(t).not.toHaveProperty('expectedSeq');
  expect(t).not.toHaveProperty('deviation');
  expect(t).not.toHaveProperty('directionNum');
  expect(t).not.toHaveProperty('trainNumber');
});

test('filters by line when provided', async () => {
  // Snapshot with mixed lines
  const mixedSnapshot = {
    ...snapshotDoc,
    trains: [
      { ...snapshotDoc.trains[0], lineCode: 'RD' },
      { ...snapshotDoc.trains[1], lineCode: 'BL' },
    ],
  };
  AdherenceSnapshot.findOne.mockReturnValue({
    sort: jest.fn().mockReturnValue({
      lean: jest.fn().mockResolvedValue(mixedSnapshot),
    }),
  });

  const result = await getTrainPositions({ line: 'rd' });
  expect(result.trains).toHaveLength(1);
  expect(result.trains[0].lineCode).toBe('RD');
});

test('returns empty result when no snapshot exists', async () => {
  AdherenceSnapshot.findOne.mockReturnValue({
    sort: jest.fn().mockReturnValue({
      lean: jest.fn().mockResolvedValue(null),
    }),
  });

  const result = await getTrainPositions();
  expect(result).toEqual({ snapshotAt: null, summary: {}, lineSummaries: [], trains: [] });
});

test('preserves snapshotAt and summary at top level', async () => {
  const result = await getTrainPositions();
  expect(result.snapshotAt).toEqual(snapshotAt);
  expect(result.summary.total).toBe(2);
  expect(result.lineSummaries).toHaveLength(1);
});
