import { jest } from '@jest/globals';
import { createRequire } from 'module';
import { busPositionsHandler } from '../tools/bus_positions.js';
import { ApiError } from '../client.js';

const require = createRequire(import.meta.url);
const summarySample = require('./fixtures/bus_positions_summary.json');
const routeSample = require('./fixtures/bus_positions_route.json');

const emptySummary = { snapshotAt: null, totalBuses: 0, routesShown: 0, routes: [] };
const emptyRoute = { snapshotAt: null, route: '16Y', count: 0, buses: [] };

describe('busPositionsHandler', () => {
  it('calls /api/bus/positions without query when no route_id', async () => {
    const fetcher = jest.fn().mockResolvedValue(summarySample);
    await busPositionsHandler({}, fetcher as any);

    expect(fetcher).toHaveBeenCalledWith('/api/bus/positions');
  });

  it('calls /api/bus/positions with route_id param when provided', async () => {
    const fetcher = jest.fn().mockResolvedValue(routeSample);
    await busPositionsHandler({ route_id: '16Y' }, fetcher as any);

    expect(fetcher).toHaveBeenCalledWith('/api/bus/positions?route_id=16Y');
  });

  it('returns unfiltered summary shape when no route_id', async () => {
    const fetcher = jest.fn().mockResolvedValue(summarySample);
    const result = await busPositionsHandler({}, fetcher as any);

    expect(result.isError).toBeUndefined();
    const data = JSON.parse(result.content[0].text);
    expect(data.totalBuses).toBe(1200);
    expect(data.routesShown).toBe(3);
    expect(data.routes).toHaveLength(3);
    expect(data.routes[0].route).toBe('16Y');
    expect(data).not.toHaveProperty('buses');
  });

  it('returns filtered bus list shape when route_id provided', async () => {
    const fetcher = jest.fn().mockResolvedValue(routeSample);
    const result = await busPositionsHandler({ route_id: '16Y' }, fetcher as any);

    expect(result.isError).toBeUndefined();
    const data = JSON.parse(result.content[0].text);
    expect(data.route).toBe('16Y');
    expect(data.count).toBe(2);
    expect(data.buses).toHaveLength(2);
    expect(data.buses[0]).toMatchObject({
      vehicleId: 'V1',
      direction: 'NORTH',
      headsign: 'Farragut Square',
      lat: 38.9,
      lon: -77.0,
      deviation: 2,
    });
    expect(data).not.toHaveProperty('routes');
  });

  it('returns empty summary shape when snapshot is absent and no route_id', async () => {
    const fetcher = jest.fn().mockResolvedValue(emptySummary);
    const result = await busPositionsHandler({}, fetcher as any);

    const data = JSON.parse(result.content[0].text);
    expect(data.totalBuses).toBe(0);
    expect(data.routes).toEqual([]);
    expect(data).not.toHaveProperty('buses');
  });

  it('returns empty filtered shape when snapshot is absent and route_id provided', async () => {
    const fetcher = jest.fn().mockResolvedValue(emptyRoute);
    const result = await busPositionsHandler({ route_id: '16Y' }, fetcher as any);

    const data = JSON.parse(result.content[0].text);
    expect(data.route).toBe('16Y');
    expect(data.count).toBe(0);
    expect(data.buses).toEqual([]);
  });

  it('returns isError on fetch failure', async () => {
    const fetcher = jest.fn().mockRejectedValue(new Error('Network timeout'));
    const result = await busPositionsHandler({}, fetcher as any);

    expect(result.isError).toBe(true);
    const data = JSON.parse(result.content[0].text);
    expect(data.error).toContain('Network timeout');
  });

  it('includes API error status in message on ApiError', async () => {
    const fetcher = jest.fn().mockRejectedValue(new ApiError(404, 'Not Found'));
    const result = await busPositionsHandler({ route_id: '16Y' }, fetcher as any);

    expect(result.isError).toBe(true);
    const data = JSON.parse(result.content[0].text);
    expect(data.error).toMatch(/404/);
  });
});
