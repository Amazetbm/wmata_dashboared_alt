import { jest } from '@jest/globals';
import { createRequire } from 'module';
import { nextArrivalsHandler } from '../tools/next_arrivals.js';

const require = createRequire(import.meta.url);
const predictionsFixture = require('./fixtures/predictions.json');

describe('nextArrivalsHandler', () => {
  it('maps trains to simplified shape', async () => {
    const fetcher = jest.fn().mockResolvedValue(predictionsFixture);
    const result = await nextArrivalsHandler({ stationCode: 'A01' }, fetcher as any);

    expect(result.isError).toBeUndefined();
    const arrivals = JSON.parse(result.content[0].text);
    expect(arrivals).toHaveLength(3);
    expect(arrivals[0]).toEqual({ minutes: '3', line: 'RD', destination: 'Shady Grove', cars: '8' });
    expect(arrivals[1]).toEqual({ minutes: 'BRD', line: 'RD', destination: 'Glenmont', cars: '6' });
  });

  it('calls the correct endpoint', async () => {
    const fetcher = jest.fn().mockResolvedValue({ Trains: [] });
    await nextArrivalsHandler({ stationCode: 'B03' }, fetcher as any);
    expect(fetcher).toHaveBeenCalledWith('/api/predictions/B03');
  });

  it('returns empty array when Trains is missing', async () => {
    const fetcher = jest.fn().mockResolvedValue({});
    const result = await nextArrivalsHandler({ stationCode: 'A01' }, fetcher as any);
    expect(JSON.parse(result.content[0].text)).toEqual([]);
  });

  it('returns isError on fetch failure', async () => {
    const fetcher = jest.fn().mockRejectedValue(new Error('Network error'));
    const result = await nextArrivalsHandler({ stationCode: 'A01' }, fetcher as any);
    expect(result.isError).toBe(true);
    expect(JSON.parse(result.content[0].text)).toHaveProperty('error');
  });
});
