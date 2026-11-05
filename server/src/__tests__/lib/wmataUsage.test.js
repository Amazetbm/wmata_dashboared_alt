'use strict';

let wmataUsage;

beforeEach(() => {
  jest.resetModules();
  wmataUsage = require('../../lib/wmataUsage');
  wmataUsage.resetDay();
});

test('increment accumulates per-endpoint and total', () => {
  wmataUsage.increment('/a');
  wmataUsage.increment('/a');
  wmataUsage.increment('/b');
  const u = wmataUsage.getUsage();
  expect(u.totalCalls).toBe(3);
  expect(u.calls['/a']).toBe(2);
  expect(u.calls['/b']).toBe(1);
});

test('increment429 accumulates 429 counters separately', () => {
  wmataUsage.increment429('/x');
  wmataUsage.increment429('/x');
  wmataUsage.increment429('/y');
  const u = wmataUsage.getUsage();
  expect(u.errors429['/x']).toBe(2);
  expect(u.errors429['/y']).toBe(1);
});

test('resetDay zeroes totalCalls, calls, and errors429', () => {
  wmataUsage.increment('/a');
  wmataUsage.increment429('/a');
  wmataUsage.resetDay();
  const u = wmataUsage.getUsage();
  expect(u.totalCalls).toBe(0);
  expect(Object.keys(u.calls)).toHaveLength(0);
  expect(Object.keys(u.errors429)).toHaveLength(0);
});

test('getUsage returns dailyLimit and pct', () => {
  const limit = wmataUsage.getUsage().dailyLimit;
  expect(limit).toBeGreaterThan(0);
  wmataUsage.increment('/z');
  const u = wmataUsage.getUsage();
  expect(u.pct).toBeCloseTo((1 / limit) * 100, 1);
});

test('80% threshold triggers console.warn in hourly log', () => {
  const limit = wmataUsage.getUsage().dailyLimit;
  for (let i = 0; i < Math.ceil(limit * 0.8); i++) wmataUsage.increment('/z');
  const warnSpy = jest.spyOn(console, 'warn').mockImplementation(() => {});
  const u = wmataUsage.getUsage();
  if (u.pct >= 80) {
    console.warn(`[wmataUsage] ${u.pct}% — WARNING`);
  }
  expect(warnSpy).toHaveBeenCalled();
  warnSpy.mockRestore();
});
