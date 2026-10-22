'use strict';

jest.mock('../../assistant/toolHandlers/getBusPositions');

const request = require('supertest');
const express = require('express');
const busRoutes = require('../../routes/bus');
const { getBusPositions } = require('../../assistant/toolHandlers/getBusPositions');

const app = express();
app.use('/api/bus', busRoutes);

beforeEach(() => jest.clearAllMocks());

const summarySample = {
  snapshotAt: '2026-10-12T14:00:00.000Z',
  totalBuses: 1200,
  routesShown: 15,
  routes: [{ route: '16Y', count: 12, headsigns: ['Farragut Square'] }],
};

const filteredSample = {
  snapshotAt: '2026-10-12T14:00:00.000Z',
  route: '16Y',
  count: 2,
  buses: [
    { vehicleId: 'V1', route: '16Y', direction: 'NORTH',
      headsign: 'Farragut Square', lat: 38.9, lon: -77.0, deviation: 2 },
  ],
};

// ── Success cases ─────────────────────────────────────────────────────────────

test('GET /api/bus/positions returns 200 summary when no route_id', async () => {
  getBusPositions.mockResolvedValue(summarySample);

  const res = await request(app).get('/api/bus/positions');

  expect(res.status).toBe(200);
  expect(res.body).toEqual(summarySample);
  expect(getBusPositions).toHaveBeenCalledWith(undefined);
});

test('GET /api/bus/positions?route_id=16Y passes route_id to handler', async () => {
  getBusPositions.mockResolvedValue(filteredSample);

  const res = await request(app).get('/api/bus/positions?route_id=16Y');

  expect(res.status).toBe(200);
  expect(res.body).toEqual(filteredSample);
  expect(getBusPositions).toHaveBeenCalledWith({ route_id: '16Y' });
});

test('route_id is case-insensitive (16y accepted, handler upcases)', async () => {
  getBusPositions.mockResolvedValue(filteredSample);

  const res = await request(app).get('/api/bus/positions?route_id=16y');

  expect(res.status).toBe(200);
  expect(getBusPositions).toHaveBeenCalledWith({ route_id: '16y' });
});

// ── Validation failures ───────────────────────────────────────────────────────

test('GET /api/bus/positions?route_id=!!! returns 400', async () => {
  const res = await request(app).get('/api/bus/positions?route_id=!!!');

  expect(res.status).toBe(400);
  expect(res.body.error).toMatch(/alphanumeric/i);
  expect(getBusPositions).not.toHaveBeenCalled();
});

test('GET /api/bus/positions?route_id=TOOLONGVALUE returns 400', async () => {
  const res = await request(app).get('/api/bus/positions?route_id=TOOLONGVALUE');

  expect(res.status).toBe(400);
  expect(getBusPositions).not.toHaveBeenCalled();
});

test('GET /api/bus/positions?route_id= (empty string) returns 400', async () => {
  const res = await request(app).get('/api/bus/positions?route_id=');

  expect(res.status).toBe(400);
});

// ── Handler error → 500 ───────────────────────────────────────────────────────

test('GET /api/bus/positions returns 500 when handler throws', async () => {
  getBusPositions.mockRejectedValue(new Error('DB connection lost'));

  const res = await request(app).get('/api/bus/positions');

  expect(res.status).toBe(500);
  expect(res.body.error).toBe('Internal server error');
});
