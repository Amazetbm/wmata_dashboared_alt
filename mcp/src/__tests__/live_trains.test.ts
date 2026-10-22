import { jest } from '@jest/globals';
import { createRequire } from 'module';
import { liveTrainsHandler } from '../tools/live_trains.js';
import { ApiError } from '../client.js';

const require = createRequire(import.meta.url);
const trainsLocated = require('./fixtures/trains_located.json');

describe('liveTrainsHandler', () => {
  it('calls /api/trains/located with line param when line is provided', async () => {
    const fetcher = jest.fn().mockResolvedValue(trainsLocated);
    await liveTrainsHandler({ line: 'RD' }, fetcher as any);

    expect(fetcher).toHaveBeenCalledWith('/api/trains/located?line=RD');
  });

  it('calls /api/trains/located without query when no line provided', async () => {
    const fetcher = jest.fn().mockResolvedValue(trainsLocated);
    await liveTrainsHandler({}, fetcher as any);

    expect(fetcher).toHaveBeenCalledWith('/api/trains/located');
  });

  it('returns trains with location and destination fields', async () => {
    const fetcher = jest.fn().mockResolvedValue(trainsLocated);
    const result = await liveTrainsHandler({ line: 'RD' }, fetcher as any);

    expect(result.isError).toBeUndefined();
    const data = JSON.parse(result.content[0].text);
    expect(data.trainCount).toBe(2);
    expect(data.trains[0]).toMatchObject({
      trainId: 'T123',
      lineCode: 'RD',
      cars: 8,
      status: 'on-time',
      location: 'at Metro Center (A01)',
      destination: 'Shady Grove',
    });
  });

  it('does not include raw circuitId, currentSeq, or direction', async () => {
    const fetcher = jest.fn().mockResolvedValue(trainsLocated);
    const result = await liveTrainsHandler({ line: 'RD' }, fetcher as any);

    const data = JSON.parse(result.content[0].text);
    const train = data.trains[0];
    expect(train).not.toHaveProperty('circuitId');
    expect(train).not.toHaveProperty('currentSeq');
    expect(train).not.toHaveProperty('direction');
    expect(train).not.toHaveProperty('directionNum');
    expect(train).not.toHaveProperty('deviation');
  });

  it('includes summary in output', async () => {
    const fetcher = jest.fn().mockResolvedValue(trainsLocated);
    const result = await liveTrainsHandler({ line: 'RD' }, fetcher as any);

    const data = JSON.parse(result.content[0].text);
    expect(data.summary).toMatchObject({ lineCode: 'RD', total: 20, onTime: 16 });
  });

  it('includes line in output when line is provided', async () => {
    const fetcher = jest.fn().mockResolvedValue(trainsLocated);
    const result = await liveTrainsHandler({ line: 'RD' }, fetcher as any);

    const data = JSON.parse(result.content[0].text);
    expect(data.line).toBe('RD');
  });

  it('omits line key from output when no line provided', async () => {
    const fetcher = jest.fn().mockResolvedValue(trainsLocated);
    const result = await liveTrainsHandler({}, fetcher as any);

    const data = JSON.parse(result.content[0].text);
    expect(data).not.toHaveProperty('line');
  });

  it('includes snapshotAt in output', async () => {
    const fetcher = jest.fn().mockResolvedValue(trainsLocated);
    const result = await liveTrainsHandler({ line: 'RD' }, fetcher as any);

    const data = JSON.parse(result.content[0].text);
    expect(data.snapshotAt).toBe('2026-09-24T12:00:00.000Z');
  });

  it('returns isError on fetch failure', async () => {
    const fetcher = jest.fn().mockRejectedValue(new Error('Network timeout'));
    const result = await liveTrainsHandler({ line: 'RD' }, fetcher as any);
    expect(result.isError).toBe(true);
  });

  it('includes API error status in message on ApiError', async () => {
    const fetcher = jest.fn().mockRejectedValue(new ApiError(503, 'Service Unavailable'));
    const result = await liveTrainsHandler({ line: 'RD' }, fetcher as any);

    expect(result.isError).toBe(true);
    const data = JSON.parse(result.content[0].text);
    expect(data.error).toMatch(/503/);
  });

  it('passes occupancy through when present on a train', async () => {
    const fetcher = jest.fn().mockResolvedValue(trainsLocated);
    const result = await liveTrainsHandler({ line: 'RD' }, fetcher as any);

    const data = JSON.parse(result.content[0].text);
    expect(data.trains[0].occupancy).toMatchObject({ status: 1, label: 'Many seats (<20% full)' });
  });

  it('omits occupancy key when not present on train', async () => {
    const fetcher = jest.fn().mockResolvedValue(trainsLocated);
    const result = await liveTrainsHandler({ line: 'RD' }, fetcher as any);

    const data = JSON.parse(result.content[0].text);
    expect(data.trains[1]).not.toHaveProperty('occupancy');
  });
});
