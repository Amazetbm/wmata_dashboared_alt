'use strict';

jest.mock('../../models/BusScheduleAdherenceSnapshot');

const request = require('supertest');
const express = require('express');
const busScheduleAdherenceRoutes = require('../../routes/busScheduleAdherence');
const BusScheduleAdherenceSnapshot = require('../../models/BusScheduleAdherenceSnapshot');

const app = express();
app.use('/api/bus/adherence/schedule', busScheduleAdherenceRoutes);

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

beforeEach(() => { jest.clearAllMocks(); });

// ── /live ─────────────────────────────────────────────────────────────────────

test('GET /live returns 200 with latest snapshot', async () => {
  BusScheduleAdherenceSnapshot.findOne.mockReturnValue({
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

test('GET /live returns empty state when no snapshot', async () => {
  BusScheduleAdherenceSnapshot.findOne.mockReturnValue({
    sort: jest.fn().mockReturnValue({ lean: jest.fn().mockResolvedValue(null) }),
  });

  const res = await request(app).get('/api/bus/adherence/schedule/live');

  expect(res.status).toBe(200);
  expect(res.body.buses).toEqual([]);
  expect(res.body.coverageRate).toBeNull();
});

test('GET /live returns 500 on DB error', async () => {
  BusScheduleAdherenceSnapshot.findOne.mockReturnValue({
    sort: jest.fn().mockReturnValue({ lean: jest.fn().mockRejectedValue(new Error('db fail')) }),
  });

  const res = await request(app).get('/api/bus/adherence/schedule/live');
  expect(res.status).toBe(500);
});

// ── /history ──────────────────────────────────────────────────────────────────

test('GET /history returns 200 with snapshot array', async () => {
  BusScheduleAdherenceSnapshot.find.mockReturnValue({
    sort: jest.fn().mockReturnValue({
      limit: jest.fn().mockReturnValue({
        lean: jest.fn().mockResolvedValue([sampleSnapshot]),
      }),
    }),
  });

  const from = '2026-11-16T10:00:00.000Z';
  const to   = '2026-11-16T14:00:00.000Z';
  const res  = await request(app).get(`/api/bus/adherence/schedule/history?from=${from}&to=${to}`);

  expect(res.status).toBe(200);
  expect(Array.isArray(res.body)).toBe(true);
  expect(res.body).toHaveLength(1);
});

test('GET /history with route filter substitutes per-route summary', async () => {
  BusScheduleAdherenceSnapshot.find.mockReturnValue({
    sort: jest.fn().mockReturnValue({
      limit: jest.fn().mockReturnValue({
        lean: jest.fn().mockResolvedValue([sampleSnapshot]),
      }),
    }),
  });

  const res = await request(app).get('/api/bus/adherence/schedule/history?route=A11');

  expect(res.status).toBe(200);
  // With route filter, summary should be the per-route summary for A11
  expect(res.body[0].summary.routeId).toBe('A11');
  expect(res.body[0].summary.total).toBe(20);
});

test('GET /history with unknown route returns zeroed summary', async () => {
  BusScheduleAdherenceSnapshot.find.mockReturnValue({
    sort: jest.fn().mockReturnValue({
      limit: jest.fn().mockReturnValue({
        lean: jest.fn().mockResolvedValue([sampleSnapshot]),
      }),
    }),
  });

  const res = await request(app).get('/api/bus/adherence/schedule/history?route=Z99');

  expect(res.status).toBe(200);
  expect(res.body[0].summary.total).toBe(0);
});

// ── /snapshot ─────────────────────────────────────────────────────────────────

test('GET /snapshot returns closest snapshot', async () => {
  BusScheduleAdherenceSnapshot.findOne.mockReturnValue({
    sort: jest.fn().mockReturnValue({ lean: jest.fn().mockResolvedValue(sampleSnapshot) }),
  });

  const res = await request(app).get('/api/bus/adherence/schedule/snapshot?at=2026-11-16T14:00:00.000Z');

  expect(res.status).toBe(200);
  expect(res.body.summary.total).toBe(200);
});

test('GET /snapshot returns null when no snapshot exists', async () => {
  BusScheduleAdherenceSnapshot.findOne.mockReturnValue({
    sort: jest.fn().mockReturnValue({ lean: jest.fn().mockResolvedValue(null) }),
  });

  const res = await request(app).get('/api/bus/adherence/schedule/snapshot?at=2026-11-16T14:00:00.000Z');

  expect(res.status).toBe(200);
  expect(res.body).toBeNull();
});
