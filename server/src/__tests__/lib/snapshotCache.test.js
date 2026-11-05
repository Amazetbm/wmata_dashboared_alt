'use strict';

jest.useFakeTimers();

// Re-require each test so the module store is fresh
let cache;
beforeEach(() => {
  jest.resetModules();
  cache = require('../../lib/snapshotCache');
  jest.setSystemTime(0);
});

afterEach(() => {
  jest.useRealTimers();
  jest.useFakeTimers();
});

test('set + get round-trip returns stored data', () => {
  const data = [{ id: 1 }];
  cache.set('trainPositions', data);
  expect(cache.get('trainPositions').data).toBe(data);
});

test('get on unknown key returns { data: null, snapshotAt: 0 }', () => {
  const entry = cache.get('nonexistent');
  expect(entry.data).toBeNull();
  expect(entry.snapshotAt).toBe(0);
});

test('isStale returns false immediately after set', () => {
  cache.set('incidents', []);
  expect(cache.isStale('incidents')).toBe(false);
});

test('isStale returns true before any set', () => {
  expect(cache.isStale('elevators')).toBe(true);
});

test('isStale returns true after 90 s', () => {
  jest.setSystemTime(1000);
  cache.set('busPositions', []);
  jest.setSystemTime(1000 + 90_001);
  expect(cache.isStale('busPositions')).toBe(true);
});

test('isStale returns false at exactly 89 s', () => {
  jest.setSystemTime(0);
  cache.set('busIncidents', []);
  jest.setSystemTime(89_999);
  expect(cache.isStale('busIncidents')).toBe(false);
});

test('overwriting a key refreshes snapshotAt', () => {
  jest.setSystemTime(0);
  cache.set('elevators', ['old']);
  jest.setSystemTime(89_999);
  cache.set('elevators', ['new']);
  jest.setSystemTime(89_999 + 89_000);
  expect(cache.isStale('elevators')).toBe(false);
  expect(cache.get('elevators').data).toEqual(['new']);
});
