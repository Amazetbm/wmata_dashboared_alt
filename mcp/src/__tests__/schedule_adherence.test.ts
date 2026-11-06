import { jest } from '@jest/globals';
import { createRequire } from 'module';
import { scheduleAdherenceHandler } from '../tools/schedule_adherence.js';
import { ApiError } from '../client.js';

const require = createRequire(import.meta.url);
const fixture = require('./fixtures/schedule_adherence_live.json');

describe('scheduleAdherenceHandler', () => {
  it('calls /api/adherence/summary?method=schedule&mode=live without line', async () => {
    const fetcher = jest.fn().mockResolvedValue(fixture);
    await scheduleAdherenceHandler({}, fetcher as any);

    expect(fetcher).toHaveBeenCalledWith('/api/adherence/summary?method=schedule&mode=live');
  });

  it('appends line param when line is provided', async () => {
    const fetcher = jest.fn().mockResolvedValue(fixture);
    await scheduleAdherenceHandler({ line: 'RD' }, fetcher as any);

    expect(fetcher).toHaveBeenCalledWith('/api/adherence/summary?method=schedule&mode=live&line=RD');
  });

  it('returns mostDelayed sorted by delaySeconds descending', async () => {
    const fetcher = jest.fn().mockResolvedValue(fixture);
    const result = await scheduleAdherenceHandler({}, fetcher as any);

    expect(result.isError).toBeUndefined();
    const data = JSON.parse(result.content[0].text);
    const delays = data.mostDelayed.map((t: { delaySeconds: number }) => t.delaySeconds);
    expect(delays).toEqual([...delays].sort((a, b) => b - a));
    // Most delayed train should be T003 with 600s
    expect(data.mostDelayed[0].trainId).toBe('T003');
    expect(data.mostDelayed[0].delaySeconds).toBe(600);
  });

  it('excludes trains with null scheduleDelay from mostDelayed', async () => {
    const fetcher = jest.fn().mockResolvedValue(fixture);
    const result = await scheduleAdherenceHandler({}, fetcher as any);

    const data = JSON.parse(result.content[0].text);
    const trainIds = data.mostDelayed.map((t: { trainId: string }) => t.trainId);
    // T005 has null scheduleDelay — should not appear
    expect(trainIds).not.toContain('T005');
  });

  it('computes onTimePct excluding noPrediction from denominator', async () => {
    const fetcher = jest.fn().mockResolvedValue(fixture);
    const result = await scheduleAdherenceHandler({}, fetcher as any);

    const data = JSON.parse(result.content[0].text);
    // early(8) + onTime(70) + minor(25) + significant(7) = 110; onTime/110 = ~64%
    const predictedTotal = 8 + 70 + 25 + 7;
    const expected = Math.round((70 / predictedTotal) * 100);
    expect(data.summary.onTimePct).toBe(expected);
    // noPrediction(10) must NOT be in denominator
    const withNoPrediction = Math.round((70 / 120) * 100);
    expect(data.summary.onTimePct).not.toBe(withNoPrediction);
  });

  it('includes coverageRate and degraded fields', async () => {
    const fetcher = jest.fn().mockResolvedValue(fixture);
    const result = await scheduleAdherenceHandler({}, fetcher as any);

    const data = JSON.parse(result.content[0].text);
    expect(data.coverageRate).toBe(0.87);
    expect(data.degraded).toBe(false);
    expect(data.asOf).toBe('2026-11-06T12:00:00.000Z');
  });

  it('includes byLine array with per-line onTimePct', async () => {
    const fetcher = jest.fn().mockResolvedValue(fixture);
    const result = await scheduleAdherenceHandler({}, fetcher as any);

    const data = JSON.parse(result.content[0].text);
    expect(data.byLine).toHaveLength(3);
    const rd = data.byLine.find((l: { lineCode: string }) => l.lineCode === 'RD');
    expect(rd).toBeDefined();
    // RD: early(3)+onTime(25)+minor(8)+significant(2)=38; onTimePct = round(25/38*100)=66
    expect(rd.onTimePct).toBe(Math.round(25 / 38 * 100));
  });

  it('returns isError when API returns 503', async () => {
    const fetcher = jest.fn().mockRejectedValue(new ApiError(503, 'GTFS_RAIL_TRIP_UPDATES is not enabled'));
    const result = await scheduleAdherenceHandler({}, fetcher as any);

    expect(result.isError).toBe(true);
    expect(result.content[0].text).toContain('GTFS_RAIL_TRIP_UPDATES');
  });

  it('returns isError on generic fetch failure', async () => {
    const fetcher = jest.fn().mockRejectedValue(new Error('Network error'));
    const result = await scheduleAdherenceHandler({}, fetcher as any);

    expect(result.isError).toBe(true);
  });
});
