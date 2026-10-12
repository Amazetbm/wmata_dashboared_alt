'use strict';

jest.mock('../../assistant/toolHandlers/getTrainPositions');

const request = require('supertest');
const express = require('express');
const trainRoutes = require('../../routes/trains');
const { getTrainPositions } = require('../../assistant/toolHandlers/getTrainPositions');

const app = express();
app.use('/api/trains', trainRoutes);

beforeEach(() => jest.clearAllMocks());

const sampleResult = {
  snapshotAt: '2026-10-12T14:00:00.000Z',
  summary: { lineCode: 'RD', total: 20, onTime: 16, minor: 3, significant: 1 },
  lineSummaries: [{ lineCode: 'RD', total: 20, onTime: 16, minor: 3, significant: 1 }],
  trains: [
    { trainId: 'T1', lineCode: 'RD', carCount: 8, status: 'on-time',
      location: 'at Metro Center (A01)', destination: 'Shady Grove' },
  ],
};

// ── Success cases ─────────────────────────────────────────────────────────────

test('GET /api/trains/located returns 200 with handler data (no line filter)', async () => {
  getTrainPositions.mockResolvedValue(sampleResult);

  const res = await request(app).get('/api/trains/located');

  expect(res.status).toBe(200);
  expect(res.body).toEqual(sampleResult);
  expect(getTrainPositions).toHaveBeenCalledWith(undefined);
});

test('GET /api/trains/located?line=RD passes line to handler', async () => {
  getTrainPositions.mockResolvedValue(sampleResult);

  const res = await request(app).get('/api/trains/located?line=RD');

  expect(res.status).toBe(200);
  expect(getTrainPositions).toHaveBeenCalledWith({ line: 'RD' });
});

test('line param is case-insensitive (rd accepted)', async () => {
  getTrainPositions.mockResolvedValue(sampleResult);

  const res = await request(app).get('/api/trains/located?line=rd');

  expect(res.status).toBe(200);
  expect(getTrainPositions).toHaveBeenCalledWith({ line: 'rd' });
});

// ── Validation failures ───────────────────────────────────────────────────────

test('GET /api/trains/located?line=XX returns 400', async () => {
  const res = await request(app).get('/api/trains/located?line=XX');

  expect(res.status).toBe(400);
  expect(res.body.error).toMatch(/RD.*BL|BL.*RD/i);
  expect(getTrainPositions).not.toHaveBeenCalled();
});

test('GET /api/trains/located?line=TOOLONG returns 400', async () => {
  const res = await request(app).get('/api/trains/located?line=TOOLONG');

  expect(res.status).toBe(400);
});

// ── Handler error → 500 ───────────────────────────────────────────────────────

test('GET /api/trains/located returns 500 when handler throws', async () => {
  getTrainPositions.mockRejectedValue(new Error('DB connection lost'));

  const res = await request(app).get('/api/trains/located');

  expect(res.status).toBe(500);
  expect(res.body.error).toBe('Internal server error');
});
