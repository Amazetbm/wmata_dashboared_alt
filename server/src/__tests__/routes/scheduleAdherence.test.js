'use strict';

jest.mock('../../models/ScheduleAdherenceSnapshot');

const request = require('supertest');
const express = require('express');
const scheduleAdherenceRoutes = require('../../routes/scheduleAdherence');
const ScheduleAdherenceSnapshot = require('../../models/ScheduleAdherenceSnapshot');

const app = express();
app.use('/api/adherence/schedule', scheduleAdherenceRoutes);

const sampleSnapshot = {
  snapshotAt:    new Date('2026-11-02T14:00:00.000Z'),
  feedTimestamp: new Date('2026-11-02T14:00:00.000Z'),
  coverageRate:  0.95,
  degraded:      false,
  summary:       { total: 10, early: 1, onTime: 5, slightDelay: 2, delay: 1, significantDelay: 1, noPrediction: 0 },
  lineSummaries: [{ lineCode: 'RD', total: 5, early: 0, onTime: 3, slightDelay: 1, delay: 1, significantDelay: 0, noPrediction: 0 }],
  trains: [
    { trainId: 'T1', lineCode: 'RD', delaySeconds: 45, delayLabel: 'On Time', tripId: 'trip-1', destinationCode: 'A11' },
  ],
};

beforeEach(() => {
  jest.clearAllMocks();
});

// ── /live ─────────────────────────────────────────────────────────────────────

test('GET /live returns 200 with latest snapshot', async () => {
  ScheduleAdherenceSnapshot.findOne.mockReturnValue({
    sort: jest.fn().mockReturnValue({ lean: jest.fn().mockResolvedValue(sampleSnapshot) }),
  });

  const res = await request(app).get('/api/adherence/schedule/live');

  expect(res.status).toBe(200);
  expect(res.body.summary.total).toBe(10);
  expect(res.body.coverageRate).toBeCloseTo(0.95);
  expect(res.body.degraded).toBe(false);
});

test('GET /live returns empty state when no snapshot', async () => {
  ScheduleAdherenceSnapshot.findOne.mockReturnValue({
    sort: jest.fn().mockReturnValue({ lean: jest.fn().mockResolvedValue(null) }),
  });

  const res = await request(app).get('/api/adherence/schedule/live');

  expect(res.status).toBe(200);
  expect(res.body.trains).toEqual([]);
  expect(res.body.coverageRate).toBeNull();
});

test('GET /live returns 500 on DB error', async () => {
  ScheduleAdherenceSnapshot.findOne.mockReturnValue({
    sort: jest.fn().mockReturnValue({ lean: jest.fn().mockRejectedValue(new Error('db fail')) }),
  });

  const res = await request(app).get('/api/adherence/schedule/live');
  expect(res.status).toBe(500);
});

// ── /history ──────────────────────────────────────────────────────────────────

test('GET /history returns projection fields including coverageRate and degraded', async () => {
  const snap = {
    snapshotAt:   sampleSnapshot.snapshotAt,
    summary:      sampleSnapshot.summary,
    lineSummaries: sampleSnapshot.lineSummaries,
    coverageRate: 0.92,
    degraded:     false,
  };

  ScheduleAdherenceSnapshot.find.mockReturnValue({
    sort: jest.fn().mockReturnThis(),
    limit: jest.fn().mockReturnThis(),
    lean: jest.fn().mockResolvedValue([snap]),
  });

  const res = await request(app).get('/api/adherence/schedule/history?from=2026-11-01&to=2026-11-02');

  expect(res.status).toBe(200);
  expect(Array.isArray(res.body)).toBe(true);
  expect(res.body[0].summary.total).toBe(10);
  expect(res.body[0].coverageRate).toBeCloseTo(0.92);
});

test('GET /history with ?line=RD substitutes line summary', async () => {
  const snap = {
    snapshotAt:    sampleSnapshot.snapshotAt,
    summary:       sampleSnapshot.summary,
    lineSummaries: sampleSnapshot.lineSummaries,
    coverageRate:  0.95,
    degraded:      false,
  };

  ScheduleAdherenceSnapshot.find.mockReturnValue({
    sort: jest.fn().mockReturnThis(),
    limit: jest.fn().mockReturnThis(),
    lean: jest.fn().mockResolvedValue([snap]),
  });

  const res = await request(app).get('/api/adherence/schedule/history?line=RD');

  expect(res.status).toBe(200);
  expect(res.body[0].summary.lineCode).toBe('RD');
});

// ── /snapshot ─────────────────────────────────────────────────────────────────

test('GET /snapshot returns closest snapshot to ?at=', async () => {
  const mockFind = jest.fn().mockReturnValue({
    sort: jest.fn().mockReturnThis(),
    lean: jest.fn().mockResolvedValue(sampleSnapshot),
  });
  ScheduleAdherenceSnapshot.findOne = mockFind;

  const res = await request(app).get('/api/adherence/schedule/snapshot?at=2026-11-02T14:00:00Z');

  expect(res.status).toBe(200);
  expect(res.body.summary.total).toBe(10);
});

test('GET /snapshot returns null when no snapshots exist', async () => {
  ScheduleAdherenceSnapshot.findOne = jest.fn().mockReturnValue({
    sort: jest.fn().mockReturnThis(),
    lean: jest.fn().mockResolvedValue(null),
  });

  const res = await request(app).get('/api/adherence/schedule/snapshot?at=2026-11-02T14:00:00Z');

  expect(res.status).toBe(200);
  expect(res.body).toBeNull();
});
