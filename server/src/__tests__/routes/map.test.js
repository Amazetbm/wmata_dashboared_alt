'use strict';

// ── Mocks (hoisted before any require) ───────────────────────────────────────

const mockSnapshotGet    = jest.fn();
const mockSnapshotIsStale = jest.fn();
const mockGetStations    = jest.fn().mockResolvedValue([
  { Code: 'A01', Name: 'Metro Center', Lat: 38.898, Lon: -77.028,
    LineCode1: 'RD', LineCode2: 'BL', LineCode3: null, LineCode4: null },
]);
const mockGetStdRoutes   = jest.fn().mockResolvedValue([]);
const mockGetCachedRoutes = jest.fn().mockReturnValue([]);
const mockBuildCircuitPositionMap = jest.fn().mockReturnValue(new Map());
const mockBuildCSBracketMap       = jest.fn().mockReturnValue({});

jest.mock('../../lib/snapshotCache', () => ({
  get:     mockSnapshotGet,
  isStale: mockSnapshotIsStale,
}));
jest.mock('../../lib/staticCache', () => ({
  getStations: mockGetStations,
}));
jest.mock('../../lib/railGeometry', () => ({
  getStandardRoutes:            mockGetStdRoutes,
  getCachedRoutes:              mockGetCachedRoutes,
  buildCircuitPositionMap:      mockBuildCircuitPositionMap,
  buildCircuitStationBracketMap: mockBuildCSBracketMap,
}));
jest.mock('../../models/RailOccupancy', () => ({
  findOne: jest.fn().mockReturnValue({ sort: () => ({ lean: () => Promise.resolve(null) }) }),
}));
jest.mock('../../models/TripUpdate', () => ({
  findOne: jest.fn().mockReturnValue({ sort: () => ({ lean: () => Promise.resolve(null) }) }),
}));
jest.mock('../../lib/occupancyEnricher', () => ({
  enrichTrainsWithOccupancy: async (trains) => trains,
}));
jest.mock('../../lib/tripUpdateEnricher', () => ({
  enrichWithTripUpdates: async (trains) => trains,
}));

// ── App setup (once) ──────────────────────────────────────────────────────────

const request   = require('supertest');
const express   = require('express');
const mapRoutes = require('../../routes/map');

const app = express();
app.use(express.json());
app.use('/api/map', mapRoutes);

// ── Helpers ───────────────────────────────────────────────────────────────────

function freshSnapshot() {
  return { data: [], snapshotAt: Date.now() };
}

beforeEach(() => {
  jest.clearAllMocks();
  mockGetStations.mockResolvedValue([
    { Code: 'A01', Name: 'Metro Center', Lat: 38.898, Lon: -77.028,
      LineCode1: 'RD', LineCode2: null, LineCode3: null, LineCode4: null },
  ]);
  mockGetStdRoutes.mockResolvedValue([]);
  mockGetCachedRoutes.mockReturnValue([]);
  mockBuildCircuitPositionMap.mockReturnValue(new Map());
});

// ── Tests ─────────────────────────────────────────────────────────────────────

test('GET /api/map: reads from snapshotCache and staticCache, no wmataClient calls', async () => {
  mockSnapshotGet.mockReturnValue(freshSnapshot());
  mockSnapshotIsStale.mockReturnValue(false);

  const res = await request(app).get('/api/map');

  expect(res.status).toBe(200);
  expect(mockGetStations).toHaveBeenCalled();
});

test('GET /api/map: stale trainPositions snapshot → response includes stale:true', async () => {
  mockSnapshotGet.mockReturnValue(freshSnapshot());
  mockSnapshotIsStale.mockReturnValue(true);

  const res = await request(app).get('/api/map');

  expect(res.status).toBe(200);
  expect(res.body.stale).toBe(true);
});

test('GET /api/map: fresh snapshot → no stale field', async () => {
  mockSnapshotGet.mockReturnValue(freshSnapshot());
  mockSnapshotIsStale.mockReturnValue(false);

  const res = await request(app).get('/api/map');

  expect(res.status).toBe(200);
  expect(res.body).not.toHaveProperty('stale');
});
