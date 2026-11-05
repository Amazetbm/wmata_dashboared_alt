'use strict';

// Tests for server/src/middleware/wmata.js
// We capture the axios interceptors by mocking axios.create, then call the
// interceptor functions directly — no real HTTP requests.

let capturedRequestFn;
let capturedOkFn;
let capturedErrFn;
let mockWmataClient;

jest.mock('axios', () => ({
  create: () => {
    // Create a callable function so wmataClient(config) works in retry path
    const fn = jest.fn().mockRejectedValue(new Error('no more retries'));
    fn.interceptors = {
      request:  { use: jest.fn(fn2 => { capturedRequestFn = fn2; }) },
      response: { use: jest.fn((ok, err) => { capturedOkFn = ok; capturedErrFn = err; }) },
    };
    mockWmataClient = fn;
    return fn;
  },
}));

let wmataUsage;

beforeEach(() => {
  jest.useFakeTimers();
  jest.resetModules();
  capturedRequestFn  = undefined;
  capturedOkFn       = undefined;
  capturedErrFn      = undefined;

  require('../../middleware/wmata');
  wmataUsage = require('../../lib/wmataUsage');
  wmataUsage.resetDay();
  jest.spyOn(wmataUsage, 'increment');
  jest.spyOn(wmataUsage, 'increment429');
});

afterEach(() => {
  jest.useRealTimers();
});

// ── Response success interceptor ──────────────────────────────────────────────

test('usage counter increments on successful response', () => {
  const fakeResponse = {
    config: { url: '/Rail.svc/json/jStations', baseURL: 'https://api.wmata.com' },
  };
  capturedOkFn(fakeResponse);
  expect(wmataUsage.increment).toHaveBeenCalledWith('/Rail.svc/json/jStations');
});

test('usage counter increments with query-string URL (strips query)', () => {
  const fakeResponse = {
    config: { url: '/TrainPositions/TrainPositions?contentType=json', baseURL: 'https://api.wmata.com' },
  };
  capturedOkFn(fakeResponse);
  expect(wmataUsage.increment).toHaveBeenCalledWith('/TrainPositions/TrainPositions');
});

// ── 429 handling ──────────────────────────────────────────────────────────────

test('429 error: increments 429 counter', async () => {
  const fakeConfig = {
    url: '/Bus.svc/json/jBusPositions',
    baseURL: 'https://api.wmata.com',
    _retryCount: 2, // already at MAX_RETRIES → will not retry, will throw
  };
  const fakeError = {
    config:   fakeConfig,
    response: { status: 429, headers: {} },
  };

  await expect(capturedErrFn(fakeError)).rejects.toBeDefined();
  expect(wmataUsage.increment429).toHaveBeenCalledWith('/Bus.svc/json/jBusPositions');
});

test('429 with Retry-After header: retries after waiting', async () => {
  // _retryCount=0 → will retry; mockWmataClient returns success on retry
  mockWmataClient.mockResolvedValueOnce({ config: {}, data: 'ok' });

  const fakeConfig = {
    url: '/Bus.svc/json/jBusPositions',
    baseURL: 'https://api.wmata.com',
    _retryCount: 0,
  };
  const fakeError = {
    config:   fakeConfig,
    response: { status: 429, headers: { 'retry-after': '0.001' } },
  };

  const retryPromise = capturedErrFn(fakeError);
  expect(wmataUsage.increment429).toHaveBeenCalledWith('/Bus.svc/json/jBusPositions');

  // Advance past the 1ms Retry-After wait (not runAllTimers — that hits bucket interval)
  await jest.advanceTimersByTimeAsync(100);
  await retryPromise;
});

test('429 at MAX_RETRIES → throws immediately without retrying', async () => {
  // _retryCount already at 2 (MAX_RETRIES); handler increments to 3, sees 3 > 2, throws
  const fakeConfig = {
    url: '/x',
    baseURL: 'https://api.wmata.com',
    _retryCount: 2,
  };
  const fakeError = {
    config:   fakeConfig,
    response: { status: 429, headers: {} },
  };

  await expect(capturedErrFn(fakeError)).rejects.toBe(fakeError);
  expect(mockWmataClient).not.toHaveBeenCalled();
});

test('error without config is rethrown immediately', async () => {
  const bare = new Error('no config');
  await expect(capturedErrFn(bare)).rejects.toThrow('no config');
  expect(wmataUsage.increment429).not.toHaveBeenCalled();
});

// ── wmataUsage unit tests ──────────────────────────────────────────────────────

test('increment accumulates across multiple endpoints', () => {
  wmataUsage.increment('/a');
  wmataUsage.increment('/a');
  wmataUsage.increment('/b');
  const u = wmataUsage.getUsage();
  expect(u.totalCalls).toBe(3);
  expect(u.calls['/a']).toBe(2);
  expect(u.calls['/b']).toBe(1);
});

test('resetDay zeroes all counters', () => {
  wmataUsage.increment('/x');
  wmataUsage.increment429('/x');
  wmataUsage.resetDay();
  const u = wmataUsage.getUsage();
  expect(u.totalCalls).toBe(0);
  expect(Object.keys(u.calls)).toHaveLength(0);
  expect(Object.keys(u.errors429)).toHaveLength(0);
});
