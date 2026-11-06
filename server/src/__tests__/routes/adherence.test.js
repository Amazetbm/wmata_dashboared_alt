'use strict';

jest.mock('../../assistant/toolHandlers/getScheduleAdherence');

const request = require('supertest');
const express = require('express');
const { getScheduleAdherence } = require('../../assistant/toolHandlers/getScheduleAdherence');

const LIVE_RESULT = {
  snapshotAt: '2026-11-06T12:00:00.000Z',
  summary: { total: 100, onTime: 70, early: 5, minor: 15, significant: 10, noPrediction: 5 },
  lineSummaries: [],
  trains: [],
};

function makeApp(gtfsEnabled = false) {
  process.env.GTFS_RAIL_TRIP_UPDATES = gtfsEnabled ? 'true' : 'false';
  jest.resetModules();
  jest.mock('../../assistant/toolHandlers/getScheduleAdherence');
  const adherenceRoutes = require('../../routes/adherence');
  const app = express();
  app.use('/api/adherence', adherenceRoutes);
  return { app, getHandler: require('../../assistant/toolHandlers/getScheduleAdherence').getScheduleAdherence };
}

beforeEach(() => {
  jest.clearAllMocks();
});

afterEach(() => {
  delete process.env.GTFS_RAIL_TRIP_UPDATES;
});

describe('GET /api/adherence/summary — validation', () => {
  it('returns 400 for invalid method', async () => {
    const { app } = makeApp();
    const res = await request(app).get('/api/adherence/summary?method=invalid');
    expect(res.status).toBe(400);
    expect(res.body.error).toMatch(/method/);
  });

  it('returns 400 for invalid mode', async () => {
    const { app } = makeApp();
    const res = await request(app).get('/api/adherence/summary?method=headway&mode=invalid');
    expect(res.status).toBe(400);
    expect(res.body.error).toMatch(/mode/);
  });

  it('returns 503 when method=schedule and GTFS_RAIL_TRIP_UPDATES is false', async () => {
    const { app } = makeApp(false);
    const res = await request(app).get('/api/adherence/summary?method=schedule&mode=live');
    expect(res.status).toBe(503);
    expect(res.body.error).toMatch(/GTFS_RAIL_TRIP_UPDATES/);
  });
});

describe('GET /api/adherence/summary — headway', () => {
  it('returns 200 with correct shape for method=headway&mode=live', async () => {
    const { app, getHandler } = makeApp(false);
    getHandler.mockResolvedValue(LIVE_RESULT);
    const res = await request(app).get('/api/adherence/summary?method=headway&mode=live');
    expect(res.status).toBe(200);
    expect(res.body.summary).toBeDefined();
    expect(getHandler).toHaveBeenCalledWith(expect.objectContaining({ method: 'headway', mode: 'live' }));
  });

  it('returns 200 with history data for method=headway&mode=history&days=7', async () => {
    const { app, getHandler } = makeApp(false);
    getHandler.mockResolvedValue({ snapshotCount: 50, averages: null, lineTrends: {} });
    const res = await request(app).get('/api/adherence/summary?method=headway&mode=history&days=7');
    expect(res.status).toBe(200);
    expect(getHandler).toHaveBeenCalledWith(expect.objectContaining({ method: 'headway', mode: 'history' }));
  });
});

describe('GET /api/adherence/summary — schedule', () => {
  it('returns 200 for method=schedule&mode=live when GTFS enabled', async () => {
    const { app, getHandler } = makeApp(true);
    getHandler.mockResolvedValue(LIVE_RESULT);
    const res = await request(app).get('/api/adherence/summary?method=schedule&mode=live');
    expect(res.status).toBe(200);
    expect(getHandler).toHaveBeenCalledWith(expect.objectContaining({ method: 'schedule', mode: 'live' }));
  });

  it('returns 200 for method=schedule&mode=history when GTFS enabled', async () => {
    const { app, getHandler } = makeApp(true);
    getHandler.mockResolvedValue({ snapshotCount: 10, averages: null, lineTrends: {}, degradedCount: 0, avgCoverageRate: null });
    const res = await request(app).get('/api/adherence/summary?method=schedule&mode=history&days=3');
    expect(res.status).toBe(200);
    expect(getHandler).toHaveBeenCalledWith(expect.objectContaining({ method: 'schedule', mode: 'history' }));
  });
});
