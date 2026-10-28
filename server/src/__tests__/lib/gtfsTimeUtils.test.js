'use strict';

const { parseGtfsTime, gtfsToUtc } = require('../../lib/gtfsStatic/timeUtils');

describe('parseGtfsTime', () => {
  it('parses "00:00:00" as 0 seconds', () => {
    expect(parseGtfsTime('00:00:00')).toBe(0);
  });

  it('parses "06:00:00" as 21600 seconds', () => {
    expect(parseGtfsTime('06:00:00')).toBe(6 * 3600);
  });

  it('parses "25:30:00" as 91800 seconds (next-day trip)', () => {
    expect(parseGtfsTime('25:30:00')).toBe(25 * 3600 + 30 * 60);
  });

  it('parses "27:15:00" (WMATA rail max) correctly', () => {
    expect(parseGtfsTime('27:15:00')).toBe(27 * 3600 + 15 * 60);
  });
});

describe('gtfsToUtc', () => {
  it('converts 7 AM EST (UTC-5) on a winter day', () => {
    // 2026-01-15 07:00:00 EST = 2026-01-15T12:00:00Z
    const result = gtfsToUtc('2026-01-15', 7 * 3600);
    expect(result.toISOString()).toBe('2026-01-15T12:00:00.000Z');
  });

  it('converts midnight (0 sec) on a winter day to 05:00 UTC', () => {
    // Midnight ET (UTC-5) = 05:00 UTC
    const result = gtfsToUtc('2026-01-15', 0);
    expect(result.toISOString()).toBe('2026-01-15T05:00:00.000Z');
  });

  it('handles spring-forward: 2026-03-08T02:30 (in DST gap) → 2026-03-08T06:30 UTC', () => {
    // Service date 2026-03-08. Clocks spring forward 2→3 AM (UTC-5 → UTC-4).
    // Midnight ET = 2026-03-08T05:00:00 UTC (pre-spring-forward).
    // noon ET = 2026-03-08T16:00:00 UTC (EDT, UTC-4)
    // noon-12h = 2026-03-08T04:00:00 UTC  ← service-day midnight
    // 02:30 = 9000 sec → 04:00 + 9000s = 06:30 UTC
    const result = gtfsToUtc('2026-03-08', 9000);
    expect(result.toISOString()).toBe('2026-03-08T06:30:00.000Z');
  });

  it('handles fall-back: 2026-11-01T25:30 → 2026-11-02T06:30 UTC', () => {
    // Service date 2026-11-01. Clocks fall back 2→1 AM (UTC-4 → UTC-5).
    // Noon ET = 2026-11-01T17:00:00 UTC (EDT, UTC-4)
    // noon-12h = 2026-11-01T05:00:00 UTC ← service-day midnight
    // 25:30 = 91800 sec → 05:00 + 91800s = 2026-11-02T06:30:00 UTC
    const result = gtfsToUtc('2026-11-01', 91800);
    expect(result.toISOString()).toBe('2026-11-02T06:30:00.000Z');
  });

  it('handles midnight boundary: 86400 sec on 2026-06-01 → start of June 2 EDT', () => {
    // Noon EDT = 2026-06-01T16:00 UTC → noon-12h = 2026-06-01T04:00 UTC
    // 86400s = exactly 24h → 2026-06-02T04:00:00 UTC = midnight June 2 EDT
    const result = gtfsToUtc('2026-06-01', 86400);
    expect(result.toISOString()).toBe('2026-06-02T04:00:00.000Z');
  });
});
