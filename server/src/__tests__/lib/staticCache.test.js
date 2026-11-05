'use strict';

jest.useFakeTimers();

const mockGet = jest.fn();

jest.mock('../../middleware/wmata', () => ({
  wmataClient: { get: mockGet },
}));

let staticCache;

beforeEach(() => {
  jest.resetModules();
  jest.setSystemTime(0);
  mockGet.mockReset();
  // Re-require so internal cache vars are fresh
  staticCache = require('../../lib/staticCache');
});

afterEach(() => {
  jest.useRealTimers();
  jest.useFakeTimers();
});

// ── getStations (6 h TTL) ─────────────────────────────────────────────────────

test('getStations: single WMATA call for N requests within TTL', async () => {
  mockGet.mockResolvedValue({ data: { Stations: [{ Code: 'A01', Name: 'Metro Center' }] } });

  await staticCache.getStations();
  await staticCache.getStations();
  await staticCache.getStations();

  expect(mockGet).toHaveBeenCalledTimes(1);
});

test('getStations: re-fetches after 6-hour TTL', async () => {
  mockGet.mockResolvedValue({ data: { Stations: [] } });

  await staticCache.getStations();
  jest.setSystemTime(6 * 60 * 60 * 1000 + 1);
  await staticCache.getStations();

  expect(mockGet).toHaveBeenCalledTimes(2);
});

// ── getStandardRoutes (15 m TTL) ──────────────────────────────────────────────

test('getStandardRoutes: single WMATA call within 15 m', async () => {
  mockGet.mockResolvedValue({ data: { StandardRoutes: [] } });

  await staticCache.getStandardRoutes();
  await staticCache.getStandardRoutes();

  expect(mockGet).toHaveBeenCalledTimes(1);
});

test('getStandardRoutes: re-fetches after 15 m', async () => {
  mockGet.mockResolvedValue({ data: { StandardRoutes: [] } });

  await staticCache.getStandardRoutes();
  jest.setSystemTime(15 * 60 * 1000 + 1);
  await staticCache.getStandardRoutes();

  expect(mockGet).toHaveBeenCalledTimes(2);
});

test('getStandardRoutes(force=true): bypasses cache', async () => {
  mockGet.mockResolvedValue({ data: { StandardRoutes: [] } });

  await staticCache.getStandardRoutes();
  await staticCache.getStandardRoutes(true);

  expect(mockGet).toHaveBeenCalledTimes(2);
});

// ── getRoutes (24 h TTL) ──────────────────────────────────────────────────────

test('getRoutes: single WMATA call within 24 h', async () => {
  mockGet.mockResolvedValue({ data: { Routes: [] } });

  await staticCache.getRoutes();
  await staticCache.getRoutes();

  expect(mockGet).toHaveBeenCalledTimes(1);
});

test('getRoutes: re-fetches after 24 h', async () => {
  mockGet.mockResolvedValue({ data: { Routes: [] } });

  await staticCache.getRoutes();
  jest.setSystemTime(24 * 60 * 60 * 1000 + 1);
  await staticCache.getRoutes();

  expect(mockGet).toHaveBeenCalledTimes(2);
});

// ── getStops (24 h TTL) ───────────────────────────────────────────────────────

test('getStops: single WMATA call within 24 h', async () => {
  mockGet.mockResolvedValue({ data: { Stops: [] } });

  await staticCache.getStops();
  await staticCache.getStops();

  expect(mockGet).toHaveBeenCalledTimes(1);
});

// ── getCachedRoutes ───────────────────────────────────────────────────────────

test('getCachedRoutes returns [] before any fetch', () => {
  expect(staticCache.getCachedRoutes()).toEqual([]);
});

test('getCachedRoutes returns last fetched value synchronously', async () => {
  const routes = [{ LineCode: 'RD' }];
  mockGet.mockResolvedValue({ data: { StandardRoutes: routes } });
  await staticCache.getStandardRoutes();
  expect(staticCache.getCachedRoutes()).toEqual(routes);
});
