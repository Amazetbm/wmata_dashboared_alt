import { jest } from '@jest/globals';
import { createRequire } from 'module';
import { liveTrainsHandler } from '../tools/live_trains.js';

const require = createRequire(import.meta.url);
const adherenceLive = require('./fixtures/adherence_live.json');

describe('liveTrainsHandler', () => {
  it('filters trains to the requested line', async () => {
    const fetcher = jest.fn().mockResolvedValue(adherenceLive);
    const result = await liveTrainsHandler({ line: 'RD' }, fetcher as any);

    expect(result.isError).toBeUndefined();
    const data = JSON.parse(result.content[0].text);
    expect(data.line).toBe('RD');
    expect(data.trainCount).toBe(2);
    expect(data.trains.every((t: { trainId: string }) => ['T123', 'T124'].includes(t.trainId))).toBe(true);
  });

  it('maps train fields to simplified shape', async () => {
    const fetcher = jest.fn().mockResolvedValue(adherenceLive);
    const result = await liveTrainsHandler({ line: 'RD' }, fetcher as any);

    const data = JSON.parse(result.content[0].text);
    expect(data.trains[0]).toMatchObject({
      trainId: 'T123',
      direction: 1,
      circuitId: 1234,
      currentSeq: 10,
      deviation: 0,
      status: 'on-time',
      cars: 8,
    });
    // Internal fields should not be present
    expect(data.trains[0]).not.toHaveProperty('trainNumber');
    expect(data.trains[0]).not.toHaveProperty('expectedSeq');
    expect(data.trains[0]).not.toHaveProperty('lineCode');
  });

  it('includes matching lineSummary', async () => {
    const fetcher = jest.fn().mockResolvedValue(adherenceLive);
    const result = await liveTrainsHandler({ line: 'RD' }, fetcher as any);

    const data = JSON.parse(result.content[0].text);
    expect(data.lineSummary).toMatchObject({ lineCode: 'RD', total: 20, onTime: 16 });
  });

  it('returns empty trains and null lineSummary for line with no trains', async () => {
    const fetcher = jest.fn().mockResolvedValue(adherenceLive);
    const result = await liveTrainsHandler({ line: 'GR' }, fetcher as any);

    const data = JSON.parse(result.content[0].text);
    expect(data.trainCount).toBe(0);
    expect(data.trains).toEqual([]);
    expect(data.lineSummary).toBeNull();
  });

  it('includes snapshotAt in output', async () => {
    const fetcher = jest.fn().mockResolvedValue(adherenceLive);
    const result = await liveTrainsHandler({ line: 'BL' }, fetcher as any);

    const data = JSON.parse(result.content[0].text);
    expect(data.snapshotAt).toBe('2026-09-24T12:00:00.000Z');
  });

  it('returns isError on fetch failure', async () => {
    const fetcher = jest.fn().mockRejectedValue(new Error('Network timeout'));
    const result = await liveTrainsHandler({ line: 'RD' }, fetcher as any);
    expect(result.isError).toBe(true);
  });
});
