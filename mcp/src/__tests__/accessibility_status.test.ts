import { jest } from '@jest/globals';
import { createRequire } from 'module';
import { accessibilityStatusHandler } from '../tools/accessibility_status.js';

const require = createRequire(import.meta.url);
const outagesFixture = require('./fixtures/outages.json');

describe('accessibilityStatusHandler', () => {
  it('returns all outages when no filters given', async () => {
    const fetcher = jest.fn().mockResolvedValue(outagesFixture);
    const result = await accessibilityStatusHandler({}, fetcher as any);

    expect(result.isError).toBeUndefined();
    const data = JSON.parse(result.content[0].text);
    expect(data.count).toBe(3);
    expect(data.outages).toHaveLength(3);
  });

  it('filters by stationCode', async () => {
    const fetcher = jest.fn().mockResolvedValue(outagesFixture);
    const result = await accessibilityStatusHandler({ stationCode: 'A01' }, fetcher as any);

    const data = JSON.parse(result.content[0].text);
    expect(data.count).toBe(2);
    expect(data.outages.every((o: { stationCode: string }) => o.stationCode === 'A01')).toBe(true);
  });

  it('filters by unitType', async () => {
    const fetcher = jest.fn().mockResolvedValue(outagesFixture);
    const result = await accessibilityStatusHandler({ unitType: 'ELEVATOR' }, fetcher as any);

    const data = JSON.parse(result.content[0].text);
    expect(data.count).toBe(1);
    expect(data.outages[0].unit).toBe('A01X01');
    expect(data.outages[0].type).toBe('ELEVATOR');
  });

  it('maps fields to expected shape', async () => {
    const fetcher = jest.fn().mockResolvedValue(outagesFixture);
    const result = await accessibilityStatusHandler({ stationCode: 'A01', unitType: 'ELEVATOR' }, fetcher as any);

    const data = JSON.parse(result.content[0].text);
    expect(data.outages[0]).toMatchObject({
      unit: 'A01X01',
      type: 'ELEVATOR',
      station: 'Metro Center',
      stationCode: 'A01',
      location: 'Mezzanine to Platform',
      symptom: 'Door problem',
      outSince: '2026-09-24T08:00:00',
      estReturn: '2026-09-24T16:00:00',
    });
  });

  it('returns empty list when nothing matches', async () => {
    const fetcher = jest.fn().mockResolvedValue(outagesFixture);
    const result = await accessibilityStatusHandler({ stationCode: 'Z99' }, fetcher as any);

    const data = JSON.parse(result.content[0].text);
    expect(data.count).toBe(0);
    expect(data.outages).toEqual([]);
  });

  it('returns isError on fetch failure', async () => {
    const fetcher = jest.fn().mockRejectedValue(new Error('502'));
    const result = await accessibilityStatusHandler({}, fetcher as any);
    expect(result.isError).toBe(true);
  });
});
