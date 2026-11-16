import { jest } from '@jest/globals';
import { createRequire } from 'module';
import { busScheduleAdherenceHandler } from '../tools/bus_schedule_adherence.js';
import { ApiError } from '../client.js';

const require = createRequire(import.meta.url);
const fixture = require('./fixtures/bus_schedule_adherence_live.json');

describe('busScheduleAdherenceHandler', () => {
  it('calls /api/bus/adherence/summary?method=schedule&mode=live without route', async () => {
    const fetcher = jest.fn().mockResolvedValue(fixture);
    await busScheduleAdherenceHandler({}, fetcher as any);

    expect(fetcher).toHaveBeenCalledWith('/api/bus/adherence/summary?method=schedule&mode=live');
  });

  it('appends route param when route is provided', async () => {
    const fetcher = jest.fn().mockResolvedValue(fixture);
    await busScheduleAdherenceHandler({ route: 'A11' }, fetcher as any);

    expect(fetcher).toHaveBeenCalledWith('/api/bus/adherence/summary?method=schedule&mode=live&route=A11');
  });

  it('returns mostDelayed sorted by delaySeconds descending (nulls excluded)', async () => {
    const fetcher = jest.fn().mockResolvedValue(fixture);
    const result = await busScheduleAdherenceHandler({}, fetcher as any);

    expect(result.isError).toBeUndefined();
    const data = JSON.parse(result.content[0].text);
    // BUS004 has null delaySeconds — excluded
    const vehicleIds = data.mostDelayed.map((b: { vehicleId: string }) => b.vehicleId);
    expect(vehicleIds).not.toContain('BUS004');
    // BUS001 has 900s — most delayed
    expect(data.mostDelayed[0].vehicleId).toBe('BUS001');
    expect(data.mostDelayed[0].delaySeconds).toBe(900);
    // Sorted descending
    const delays = data.mostDelayed.map((b: { delaySeconds: number }) => b.delaySeconds);
    expect(delays).toEqual([...delays].sort((a, b) => b - a));
  });

  it('computes onTimePct excluding noPrediction from denominator', async () => {
    const fetcher = jest.fn().mockResolvedValue(fixture);
    const result = await busScheduleAdherenceHandler({}, fetcher as any);

    const data = JSON.parse(result.content[0].text);
    // early(5) + onTime(140) + minor(40) + significant(15) = 200; onTime/200 = 70%
    const predictedTotal = 5 + 140 + 40 + 15;
    const expected = Math.round((140 / predictedTotal) * 100);
    expect(data.summary.onTimePct).toBe(expected);
  });

  it('byRoute maps routeSummaries with onTimePct', async () => {
    const fetcher = jest.fn().mockResolvedValue(fixture);
    const result = await busScheduleAdherenceHandler({}, fetcher as any);

    const data = JSON.parse(result.content[0].text);
    const a11 = data.byRoute.find((r: { routeId: string }) => r.routeId === 'A11');
    expect(a11).toBeDefined();
    // early(1) + onTime(14) + minor(4) + significant(1) = 20; onTime(14)/20 = 70%
    expect(a11.onTimePct).toBe(Math.round(14 / 20 * 100));
  });

  it('returns isError=true with 503 message when feature is disabled', async () => {
    const fetcher = jest.fn().mockRejectedValue(new ApiError(503, 'disabled'));
    const result = await busScheduleAdherenceHandler({}, fetcher as any);

    expect(result.isError).toBe(true);
    expect(result.content[0].text).toContain('GTFS_BUS_TRIP_UPDATES=true');
  });

  it('returns isError=true with error message for other API errors', async () => {
    const fetcher = jest.fn().mockRejectedValue(new ApiError(500, 'Internal Server Error'));
    const result = await busScheduleAdherenceHandler({}, fetcher as any);

    expect(result.isError).toBe(true);
    expect(result.content[0].text).toContain('API error 500');
  });

  it('tool is registered via registerBusScheduleAdherence', async () => {
    const { createServer } = await import('../factory.js');
    const server = createServer();
    // The MCP server stores registered tools; check that bus_schedule_adherence is present
    const tools = (server as any)._registeredTools ?? (server as any).tools ?? {};
    const toolNames = Object.keys(tools);
    expect(toolNames).toContain('bus_schedule_adherence');
  });
});
