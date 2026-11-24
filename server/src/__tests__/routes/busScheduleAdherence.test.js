'use strict';

const request = require('supertest');
const express = require('express');

const sampleSnapshot = {
  snapshotAt:    new Date('2026-11-16T14:00:00.000Z'),
  feedTimestamp: new Date('2026-11-16T14:00:00.000Z'),
  coverageRate:  0.82,
  degraded:      false,
  matchedActive: 180,
  matchedPrevious: 0,
  summary: { total: 200, early: 5, onTime: 140, minor: 40, significant: 15, noPrediction: 30, canceled: 2, unscheduled: 0, added: 1 },
  routeSummaries: [
    { routeId: 'A11', total: 20, early: 1, onTime: 14, minor: 4, significant: 1, noPrediction: 2 },
    { routeId: 'B30', total: 15, early: 0, onTime: 10, minor: 3, significant: 2, noPrediction: 1 },
  ],
  buses: [
    { vehicleId: 'BUS001', routeId: 'A11', tripId: 'trip_A11_1', delaySeconds: 900, delayLabel: 'significant' },
  ],
};

// Creates a fresh app + mocked model with env flags set/unset.
// jest.resetModules() ensures isEnabled() reads from the new env values.
function makeApp(enabled = true) {
  process.env.GTFS_BUS_TRIP_UPDATES = enabled ? 'true' : 'false';
  process.env.GTFS_BUS_SCHEDULE     = enabled ? 'true' : 'false';
  jest.resetModules();
  jest.mock('../../models/BusScheduleAdherenceSnapshot');
  const routes = require('../../routes/busScheduleAdherence');
  const BusAdherenceSnapshot = require('../../models/BusScheduleAdherenceSnapshot');
  const app = express();
  app.use('/api/bus/adherence/schedule', routes);
  return { app, Snap: BusAdherenceSnapshot };
}

afterEach(() => {
  jest.clearAllMocks();
  delete process.env.GTFS_BUS_TRIP_UPDATES;
  delete process.env.GTFS_BUS_SCHEDULE;
});

// ── flag guards ───────────────────────────────────────────────────────────────

describe('feature flag disabled', () => {
  test('GET /live → 503', async () => {
    const { app } = makeApp(false);
    const res = await request(app).get('/api/bus/adherence/schedule/live');
    expect(res.status).toBe(503);
    expect(res.body.error).toMatch(/not enabled/i);
  });

  test('GET /history → 503', async () => {
    const { app } = makeApp(false);
    const res = await request(app).get('/api/bus/adherence/schedule/history');
    expect(res.status).toBe(503);
    expect(res.body.error).toMatch(/not enabled/i);
  });

  test('GET /snapshot → 503', async () => {
    const { app } = makeApp(false);
    const res = await request(app).get('/api/bus/adherence/schedule/snapshot?at=2026-11-16T14:00:00.000Z');
    expect(res.status).toBe(503);
    expect(res.body.error).toMatch(/not enabled/i);
  });
});

// ── /live ─────────────────────────────────────────────────────────────────────

describe('GET /live', () => {
  test('returns 200 with latest snapshot', async () => {
    const { app, Snap } = makeApp(true);
    Snap.findOne.mockReturnValue({
      sort: jest.fn().mockReturnValue({ lean: jest.fn().mockResolvedValue(sampleSnapshot) }),
    });

    const res = await request(app).get('/api/bus/adherence/schedule/live');

    expect(res.status).toBe(200);
    expect(res.body.summary.total).toBe(200);
    expect(res.body.coverageRate).toBeCloseTo(0.82);
    expect(res.body.degraded).toBe(false);
    expect(res.body.buses).toHaveLength(1);
    expect(res.body.routeSummaries).toHaveLength(2);
  });

  test('returns 503 when no snapshot exists', async () => {
    const { app, Snap } = makeApp(true);
    Snap.findOne.mockReturnValue({
      sort: jest.fn().mockReturnValue({ lean: jest.fn().mockResolvedValue(null) }),
    });

    const res = await request(app).get('/api/bus/adherence/schedule/live');

    expect(res.status).toBe(503);
    expect(res.body.error).toMatch(/no.*snapshot/i);
  });

  test('returns 500 on DB error', async () => {
    const { app, Snap } = makeApp(true);
    Snap.findOne.mockReturnValue({
      sort: jest.fn().mockReturnValue({ lean: jest.fn().mockRejectedValue(new Error('db fail')) }),
    });

    const res = await request(app).get('/api/bus/adherence/schedule/live');
    expect(res.status).toBe(500);
  });

  test('?route=A11 filters buses to that route and uses per-route summary', async () => {
    const { app, Snap } = makeApp(true);
    Snap.findOne.mockReturnValue({
      sort: jest.fn().mockReturnValue({ lean: jest.fn().mockResolvedValue(sampleSnapshot) }),
    });

    const res = await request(app).get('/api/bus/adherence/schedule/live?route=A11');

    expect(res.status).toBe(200);
    expect(res.body.buses).toHaveLength(1);
    expect(res.body.buses[0].routeId).toBe('A11');
    expect(res.body.summary.routeId).toBe('A11');
    expect(res.body.summary.total).toBe(20);
    // routeSummaries stays intact (drives the dropdown)
    expect(res.body.routeSummaries).toHaveLength(2);
  });

  test('?route= with unknown route returns zeroed summary and no buses', async () => {
    const { app, Snap } = makeApp(true);
    Snap.findOne.mockReturnValue({
      sort: jest.fn().mockReturnValue({ lean: jest.fn().mockResolvedValue(sampleSnapshot) }),
    });

    const res = await request(app).get('/api/bus/adherence/schedule/live?route=Z99');

    expect(res.status).toBe(200);
    expect(res.body.buses).toHaveLength(0);
    expect(res.body.summary.total).toBe(0);
  });
});

// ── /history ──────────────────────────────────────────────────────────────────

describe('GET /history', () => {
  test('returns 503 when collection is empty', async () => {
    const { app, Snap } = makeApp(true);
    Snap.findOne.mockReturnValue({ lean: jest.fn().mockResolvedValue(null) });
    Snap.aggregate.mockResolvedValue([]);

    const res = await request(app).get('/api/bus/adherence/schedule/history');
    expect(res.status).toBe(503);
    expect(res.body.error).toMatch(/no.*snapshot/i);
  });

  test('returns aggregated bucket array', async () => {
    const { app, Snap } = makeApp(true);
    Snap.findOne.mockReturnValue({ lean: jest.fn().mockResolvedValue({ _id: 'exists' }) });
    Snap.aggregate.mockResolvedValue([
      { _id: 1_732_561_200_000, total: 200, early: 5, onTime: 140, minor: 40, significant: 15, noPrediction: 30, canceled: 2, unscheduled: 0, added: 1, coverageRate: 0.82, degraded: false },
    ]);

    const from = '2026-11-16T10:00:00.000Z';
    const to   = '2026-11-16T14:00:00.000Z';
    const res  = await request(app).get(`/api/bus/adherence/schedule/history?from=${from}&to=${to}`);

    expect(res.status).toBe(200);
    expect(Array.isArray(res.body)).toBe(true);
    expect(res.body).toHaveLength(1);
    expect(res.body[0]).toHaveProperty('snapshotAt');
    expect(res.body[0].summary.onTime).toBe(140);
  });

  test('buckets with zero predictions are dropped', async () => {
    const { app, Snap } = makeApp(true);
    Snap.findOne.mockReturnValue({ lean: jest.fn().mockResolvedValue({ _id: 'exists' }) });
    Snap.aggregate.mockResolvedValue([
      // bucket with predictions
      { _id: 1_000_000, total: 10, early: 1, onTime: 7, minor: 1, significant: 1, noPrediction: 2, canceled: 0, unscheduled: 0, added: 0, coverageRate: 0.9, degraded: false },
      // bucket with zero predictions (should be dropped)
      { _id: 2_000_000, total: 0, early: 0, onTime: 0, minor: 0, significant: 0, noPrediction: 5, canceled: 0, unscheduled: 0, added: 0, coverageRate: null, degraded: false },
    ]);

    const res = await request(app).get('/api/bus/adherence/schedule/history');

    expect(res.status).toBe(200);
    expect(res.body).toHaveLength(1);
    expect(res.body[0].summary.onTime).toBe(7);
  });

  test('with ?route= pipeline uses $unwind and $match on routeId', async () => {
    const { app, Snap } = makeApp(true);
    Snap.findOne.mockReturnValue({ lean: jest.fn().mockResolvedValue({ _id: 'exists' }) });
    Snap.aggregate.mockResolvedValue([
      { _id: 1_000_000, total: 20, early: 1, onTime: 14, minor: 4, significant: 1, noPrediction: 2, coverageRate: 0.82, degraded: false },
    ]);

    const res = await request(app).get('/api/bus/adherence/schedule/history?route=A11');

    expect(res.status).toBe(200);
    expect(res.body).toHaveLength(1);
    expect(res.body[0].summary.onTime).toBe(14);
    // Verify pipeline includes unwind and match stages
    const pipeline = Snap.aggregate.mock.calls[0][0];
    expect(pipeline).toContainEqual({ $unwind: '$routeSummaries' });
    expect(pipeline).toContainEqual({ $match: { 'routeSummaries.routeId': 'A11' } });
  });
});

// ── /snapshot ─────────────────────────────────────────────────────────────────

describe('GET /snapshot', () => {
  test('returns closest snapshot', async () => {
    const { app, Snap } = makeApp(true);
    Snap.findOne.mockReturnValue({
      sort: jest.fn().mockReturnValue({ lean: jest.fn().mockResolvedValue(sampleSnapshot) }),
    });

    const res = await request(app).get('/api/bus/adherence/schedule/snapshot?at=2026-11-16T14:00:00.000Z');

    expect(res.status).toBe(200);
    expect(res.body.summary.total).toBe(200);
  });

  test('returns 503 when no snapshot found', async () => {
    const { app, Snap } = makeApp(true);
    Snap.findOne.mockReturnValue({
      sort: jest.fn().mockReturnValue({ lean: jest.fn().mockResolvedValue(null) }),
    });

    const res = await request(app).get('/api/bus/adherence/schedule/snapshot?at=2026-11-16T14:00:00.000Z');

    expect(res.status).toBe(503);
    expect(res.body.error).toMatch(/no.*snapshot/i);
  });
});
