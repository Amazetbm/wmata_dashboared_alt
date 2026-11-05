'use strict';

jest.mock('../../lib/wmataUsage', () => ({
  getUsage: jest.fn(() => ({
    date:       '2026-11-04',
    totalCalls: 1234,
    dailyLimit: 50000,
    pct:        2.5,
    calls:      { '/Rail.svc/json/jStations': 10 },
    errors429:  {},
  })),
}));

const request    = require('supertest');
const express    = require('express');
const statusRoutes = require('../../routes/status');

const app = express();
app.use('/api/status', statusRoutes);

test('GET /api/status/wmata-usage returns totalCalls, dailyLimit, pct', async () => {
  const res = await request(app).get('/api/status/wmata-usage');
  expect(res.status).toBe(200);
  expect(res.body).toMatchObject({
    totalCalls: 1234,
    dailyLimit: 50000,
    pct:        2.5,
  });
});

test('GET /api/status/wmata-usage returns calls and errors429 objects', async () => {
  const res = await request(app).get('/api/status/wmata-usage');
  expect(res.body).toHaveProperty('calls');
  expect(res.body).toHaveProperty('errors429');
  expect(res.body).toHaveProperty('date');
});
