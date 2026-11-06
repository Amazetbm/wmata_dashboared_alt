import { jest } from '@jest/globals';
import { createRequire } from 'module';
import { serviceHistoryHandler } from '../tools/service_history.js';
import { ApiError } from '../client.js';

const require = createRequire(import.meta.url);
const adherenceHistory = require('./fixtures/adherence_history.json');
const incidentsHistory = require('./fixtures/incidents_history.json');

const RANGE = {
  from: '2026-09-24T00:00:00-04:00',
  to: '2026-09-24T23:59:59-04:00',
};

function makeFetcher(adherence = adherenceHistory, incidents = incidentsHistory) {
  return jest.fn().mockImplementation((path: string) => {
    if (path.includes('/adherence/history')) return Promise.resolve(adherence);
    if (path.includes('/incidents/history')) return Promise.resolve(incidents);
    return Promise.reject(new Error(`Unexpected path: ${path}`));
  });
}

describe('serviceHistoryHandler', () => {
  it('aggregates adherence totals across snapshots', async () => {
    const fetcher = makeFetcher();
    const result = await serviceHistoryHandler(RANGE, fetcher as any);

    expect(result.isError).toBeUndefined();
    const data = JSON.parse(result.content[0].text);
    expect(data.snapshotCount).toBe(2);
    // 50 + 48 = 98 total; 40 + 38 = 78 onTime
    expect(data.adherence.total).toBe(98);
    expect(data.adherence.onTime).toBe(78);
    expect(data.adherence.onTimePct).toBeCloseTo(79.6, 0);
  });

  it('deduplicates incidents by IncidentID', async () => {
    const fetcher = makeFetcher();
    const result = await serviceHistoryHandler(RANGE, fetcher as any);

    const data = JSON.parse(result.content[0].text);
    // INC001 appears twice in fixture; INC002 once → should deduplicate to 2
    expect(data.incidentCount).toBe(2);
  });

  it('filters incidents by line', async () => {
    const fetcher = makeFetcher();
    const result = await serviceHistoryHandler({ ...RANGE, line: 'RD' }, fetcher as any);

    const data = JSON.parse(result.content[0].text);
    // Only INC001 affects RD
    expect(data.incidentCount).toBe(1);
    expect(data.incidents[0].id).toBe('INC001');
  });

  it('passes line param to adherence history endpoint', async () => {
    const fetcher = makeFetcher();
    await serviceHistoryHandler({ ...RANGE, line: 'RD' }, fetcher as any);

    const calls = fetcher.mock.calls.map((c: unknown[]) => c[0] as string);
    const adherenceCall = calls.find((p: string) => p.includes('/adherence/history'));
    expect(adherenceCall).toContain('line=RD');
  });

  it('returns onTimePct null when no snapshots', async () => {
    const fetcher = makeFetcher([], []);
    const result = await serviceHistoryHandler(RANGE, fetcher as any);

    const data = JSON.parse(result.content[0].text);
    expect(data.adherence.onTimePct).toBeNull();
  });

  it('returns isError on fetch failure', async () => {
    const fetcher = jest.fn().mockRejectedValue(new Error('DB error'));
    const result = await serviceHistoryHandler(RANGE, fetcher as any);
    expect(result.isError).toBe(true);
  });
});

describe('serviceHistoryHandler — schedule method', () => {
  const SCHEDULE_RESPONSE = {
    from: RANGE.from,
    to: RANGE.to,
    snapshotCount: 24,
    averages: { onTimePct: 72, earlyPct: 5, minorPct: 15, significantPct: 8, noPredictionPct: 3, canceled: 0, unscheduled: 0, added: 0 },
    lineTrends: { RD: { onTimePct: 75 } },
    degradedCount: 1,
    avgCoverageRate: 0.88,
  };

  function makeScheduleFetcher(scheduleResponse = SCHEDULE_RESPONSE, incidents: any[] = []) {
    return jest.fn().mockImplementation((path: string) => {
      if (path.includes('/adherence/summary')) return Promise.resolve(scheduleResponse);
      if (path.includes('/incidents/history')) return Promise.resolve(incidents);
      return Promise.reject(new Error(`Unexpected path: ${path}`));
    });
  }

  it('calls summary endpoint with from= and to= params (not days=)', async () => {
    const fetcher = makeScheduleFetcher();
    await serviceHistoryHandler({ ...RANGE, method: 'schedule' }, fetcher as any);

    const calls = (fetcher.mock.calls as string[][]).map(c => c[0]);
    const summaryCall = calls.find(p => p.includes('/adherence/summary'));
    expect(summaryCall).toContain('/api/adherence/summary?method=schedule&mode=history');
    expect(summaryCall).toContain('from=');
    expect(summaryCall).toContain('to=');
    expect(summaryCall).not.toContain('days=');
  });

  it('appends line param when line is provided for schedule method', async () => {
    const fetcher = makeScheduleFetcher();
    await serviceHistoryHandler({ ...RANGE, method: 'schedule', line: 'RD' }, fetcher as any);

    const calls = (fetcher.mock.calls as string[][]).map(c => c[0]);
    const summaryCall = calls.find(p => p.includes('/adherence/summary'));
    expect(summaryCall).toContain('line=RD');
  });

  it('returns schedule history with degradedCount and avgCoverageRate', async () => {
    const fetcher = makeScheduleFetcher();
    const result = await serviceHistoryHandler({ ...RANGE, method: 'schedule' }, fetcher as any);

    expect(result.isError).toBeUndefined();
    const data = JSON.parse(result.content[0].text);
    expect(data.method).toBe('schedule');
    expect(data.degradedCount).toBe(1);
    expect(data.avgCoverageRate).toBe(0.88);
    expect(data.averages.onTimePct).toBe(72);
  });

  it('includes incidentCount and incidents in schedule response', async () => {
    const incidents = [
      { IncidentID: 'INC001', Description: 'Signal problem', IncidentType: 'Delay', LinesAffected: 'RD;', DateUpdated: '2026-09-24T10:00:00Z', snapshotAt: '' },
    ];
    const fetcher = makeScheduleFetcher(SCHEDULE_RESPONSE, incidents);
    const result = await serviceHistoryHandler({ ...RANGE, method: 'schedule' }, fetcher as any);

    const data = JSON.parse(result.content[0].text);
    expect(data.incidentCount).toBe(1);
    expect(data.incidents).toHaveLength(1);
    expect(data.incidents[0].id).toBe('INC001');
  });

  it('sub-day range passes exact from/to ISO strings to summary endpoint', async () => {
    const shortRange = { from: '2026-11-05T06:00:00Z', to: '2026-11-05T10:00:00Z' };
    const fetcher = makeScheduleFetcher();
    await serviceHistoryHandler({ ...shortRange, method: 'schedule' }, fetcher as any);

    const calls = (fetcher.mock.calls as string[][]).map(c => c[0]);
    const summaryCall = calls.find(p => p.includes('/adherence/summary'));
    expect(summaryCall).toContain(encodeURIComponent(shortRange.from));
    expect(summaryCall).toContain(encodeURIComponent(shortRange.to));
  });

  it('returns isError when API returns 503 for schedule method', async () => {
    const fetcher = jest.fn().mockRejectedValue(new ApiError(503, 'GTFS not enabled'));
    const result = await serviceHistoryHandler({ ...RANGE, method: 'schedule' }, fetcher as any);

    expect(result.isError).toBe(true);
    expect(result.content[0].text).toContain('GTFS_RAIL_TRIP_UPDATES');
  });
});
