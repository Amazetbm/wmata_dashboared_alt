'use strict';

const { MongoMemoryServer } = require('mongodb-memory-server');
const mongoose = require('mongoose');
const request = require('supertest');
const express = require('express');
const AdmZip = require('adm-zip');

const GtfsVersion = require('../../models/GtfsVersion');
const GtfsStop = require('../../models/GtfsStop');
const { loadGtfsStatic } = require('../../lib/gtfsStatic/loader');

// ---- Fixture data (same as schedule.test.js) ----
const FEED_INFO = `feed_publisher_name,feed_publisher_url,feed_lang,feed_start_date,feed_end_date
WMATA,http://www.wmata.com,en,20261027,20261106
`;
const AGENCY = `agency_id,agency_name,agency_url,agency_timezone,agency_lang
1,WMATA,http://www.wmata.com,America/New_York,en
`;
const ROUTES = `route_id,agency_id,route_short_name,route_long_name,route_type
RED,1,R,Red,1
BLUE,1,B,Blue,1
`;
const STOPS = `stop_id,stop_name,stop_desc,stop_lat,stop_lon,zone_id,location_type,parent_station,wheelchair_boarding,level_id
STN_A01,Metro Center,,38.898303,-77.028099,1,1,,1,
PF_A01_C,Metro Center Platform C,,38.898303,-77.028099,1,0,STN_A01,1,
STN_A02,Farragut North,,38.903192,-77.039766,1,1,,1,
PF_A02_C,Farragut North Platform C,,38.903192,-77.039766,1,0,STN_A02,1,
`;
const CALENDAR_DATES = `service_id,date,exception_type
WD,20261028,1
WK,20261031,1
`;
const TRIPS = `route_id,service_id,trip_id,trip_headsign,direction_id,block_id,shape_id
RED,WD,trip_red_wd_0,Glenmont,0,,RRED_1
BLUE,WD,trip_blue_wd_0,Largo Town Center,0,,RBLU_1
`;
const STOP_TIMES = `trip_id,arrival_time,departure_time,stop_id,stop_sequence,pickup_type,drop_off_type,shape_dist_traveled
trip_red_wd_0,06:00:00,06:00:00,PF_A01_C,1,0,0,0
trip_red_wd_0,06:10:00,06:10:00,PF_A02_C,2,0,0,0
trip_blue_wd_0,09:00:00,09:00:00,PF_A01_C,1,0,0,0
trip_blue_wd_0,09:10:00,09:10:00,PF_A02_C,2,0,0,0
`;

function buildZip() {
  const zip = new AdmZip();
  zip.addFile('feed_info.txt', Buffer.from(FEED_INFO));
  zip.addFile('agency.txt',    Buffer.from(AGENCY));
  zip.addFile('routes.txt',    Buffer.from(ROUTES));
  zip.addFile('stops.txt',     Buffer.from(STOPS));
  zip.addFile('calendar_dates.txt', Buffer.from(CALENDAR_DATES));
  zip.addFile('trips.txt',     Buffer.from(TRIPS));
  zip.addFile('stop_times.txt', Buffer.from(STOP_TIMES));
  return zip.toBuffer();
}

// ---- Helpers ----

// Load the route once (it reads the env var dynamically per request)
const scheduleRoutes = require('../../routes/schedule');
const app = express();
app.use(express.json());
app.use('/api/schedule', scheduleRoutes);

let mongod;

beforeAll(async () => {
  mongod = await MongoMemoryServer.create();
  await mongoose.connect(mongod.getUri());
  await loadGtfsStatic({ zipBuffer: buildZip() });
});

afterAll(async () => {
  await mongoose.disconnect();
  await mongod.stop();
  delete process.env.GTFS_RAIL_SCHEDULE;
});

// ---- Tests: flag OFF ----

describe('feature flag disabled', () => {
  beforeAll(() => { process.env.GTFS_RAIL_SCHEDULE = 'false'; });
  afterAll(() => { delete process.env.GTFS_RAIL_SCHEDULE; });

  it('GET /api/schedule/status → 503', async () => {
    const res = await request(app).get('/api/schedule/status');
    expect(res.status).toBe(503);
    expect(res.body.error).toBeDefined();
  });

  it('GET /api/schedule/station/A01 → 503', async () => {
    const res = await request(app).get('/api/schedule/station/A01');
    expect(res.status).toBe(503);
  });
});

// ---- Tests: flag ON ----

describe('feature flag enabled', () => {
  beforeAll(() => { process.env.GTFS_RAIL_SCHEDULE = 'true'; });
  afterAll(() => { delete process.env.GTFS_RAIL_SCHEDULE; });

  it('GET /api/schedule/status → 200 with loaded fields', async () => {
    const res = await request(app).get('/api/schedule/status');
    expect(res.status).toBe(200);
    expect(res.body.enabled).toBe(true);
    expect(res.body.loaded).toBe(true);
    expect(res.body.feedDate).toBe('20261027');
    expect(typeof res.body.stopCount).toBe('number');
    expect(typeof res.body.tripCount).toBe('number');
  });

  it('GET /api/schedule/station/A01?date=2026-10-28 → 200 with departures', async () => {
    const res = await request(app).get('/api/schedule/station/A01?date=2026-10-28');
    expect(res.status).toBe(200);
    expect(res.body.station.code).toBe('A01');
    expect(res.body.station.name).toBe('Metro Center');
    expect(Array.isArray(res.body.departures)).toBe(true);
    expect(res.body.departures.length).toBeGreaterThan(0);
    // Each departure has required fields
    for (const d of res.body.departures) {
      expect(d).toHaveProperty('tripId');
      expect(d).toHaveProperty('lineCode');
      expect(d).toHaveProperty('headsign');
      expect(typeof d.departureSec).toBe('number');
      expect(d.departureTime).toMatch(/^\d{4}-\d{2}-\d{2}T/);
    }
  });

  it('GET /api/schedule/station/A01 (no date) → 200', async () => {
    // Just verifies it doesn't 500 when using today's date
    const res = await request(app).get('/api/schedule/station/A01');
    expect([200, 200]).toContain(res.status); // 200 with departures or empty
    expect(res.body.station).toBeDefined();
  });

  it('GET /api/schedule/station/ZZ99 → 404', async () => {
    const res = await request(app).get('/api/schedule/station/ZZ99?date=2026-10-28');
    expect(res.status).toBe(404);
    expect(res.body.error).toMatch(/ZZ99/);
  });

  it('GET /api/schedule/station/A01?date=invalid → 400', async () => {
    const res = await request(app).get('/api/schedule/station/A01?date=not-a-date');
    expect(res.status).toBe(400);
  });

  it('departures are sorted by departureSec ascending', async () => {
    const res = await request(app).get('/api/schedule/station/A01?date=2026-10-28');
    const deps = res.body.departures;
    for (let i = 1; i < deps.length; i++) {
      expect(deps[i].departureSec).toBeGreaterThanOrEqual(deps[i - 1].departureSec);
    }
  });
});
