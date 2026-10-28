'use strict';

jest.mock('../../lib/railGeometry', () => ({
  getStandardRoutes: jest.fn().mockResolvedValue([]),
  getCachedRoutes: jest.fn().mockResolvedValue([]),
}));

// Prevent real HTTP downloads (e.g. from POST /reload's fire-and-forget background call)
jest.mock('axios', () => ({
  get: jest.fn().mockRejectedValue(new Error('axios mocked in tests')),
}));

const { MongoMemoryServer } = require('mongodb-memory-server');
const mongoose = require('mongoose');
const request = require('supertest');
const express = require('express');
const AdmZip = require('adm-zip');

const GtfsVersion = require('../../models/GtfsVersion');
const GtfsStop = require('../../models/GtfsStop');
const { loadGtfsStatic, computeAndStoreMeta } = require('../../lib/gtfsStatic/loader');

// ---- Fixture data (same as schedule.test.js) ----
const FEED_INFO = `feed_publisher_name,feed_publisher_url,feed_lang,feed_start_date,feed_end_date,feed_version
WMATA,http://www.wmata.com,en,20261027,20261106,1.0
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
const { DateTime } = require('luxon');
const TODAY_GTFS = DateTime.now().setZone('America/New_York').toFormat('yyyyMMdd');
const CALENDAR_DATES = `service_id,date,exception_type\nWD,${TODAY_GTFS},1\nWD,20261028,1\nWK,20261031,1\n`;
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

// Build a zip with no stop_times (for validation gate test)
function buildZipNoStopTimes() {
  const zip = new AdmZip();
  zip.addFile('feed_info.txt', Buffer.from(FEED_INFO));
  zip.addFile('agency.txt',    Buffer.from(AGENCY));
  zip.addFile('routes.txt',    Buffer.from(ROUTES));
  zip.addFile('stops.txt',     Buffer.from(STOPS));
  zip.addFile('calendar_dates.txt', Buffer.from(CALENDAR_DATES));
  zip.addFile('trips.txt',     Buffer.from(TRIPS));
  // stop_times.txt intentionally omitted
  return zip.toBuffer();
}

beforeAll(async () => {
  mongod = await MongoMemoryServer.create();
  await mongoose.connect(mongod.getUri());
  // minStations:1 because the fixture only has 2 stations (threshold is 95 in production)
  await loadGtfsStatic({ zipBuffer: buildZip(), minStations: 1 });
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
    // New meta fields
    expect(res.body.feedVersion).toEqual({ id: expect.any(String), gtfs: '1.0' });
    expect(res.body.routeCount).toBe(2);
    expect(typeof res.body.stopTimeCount).toBe('number');
    expect(res.body.frequencyCount).toBe(0);
    expect(typeof res.body.serviceIdCount).toBe('number');
    expect(res.body.serviceDateRange.start).toMatch(/^\d{4}-\d{2}-\d{2}$/);
    expect(res.body.serviceDateRange.end).toMatch(/^\d{4}-\d{2}-\d{2}$/);
    expect(typeof res.body.coversToday).toBe('boolean');
    expect(res.body.coversToday).toBe(true);  // TODAY_GTFS in fixture
    expect(res.body.stationsMapped).toEqual({ mapped: 2, total: 2 });
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

  it('GET /api/schedule/station/A01?minutes=30 is accepted and returns valid structure', async () => {
    const res = await request(app).get('/api/schedule/station/A01?minutes=30');
    expect(res.status).toBe(200);
    expect(res.body.station.code).toBe('A01');
    expect(Array.isArray(res.body.departures)).toBe(true);
  });

  it('?minutes=0 returns no departures (nothing departs in 0 minutes)', async () => {
    const res = await request(app).get('/api/schedule/station/A01?minutes=0');
    expect(res.status).toBe(200);
    expect(res.body.departures).toHaveLength(0);
  });

  it('status returns null meta fields when computedAt is absent', async () => {
    // Temporarily clear computedAt from the active version
    const version = await GtfsVersion.findOne({ status: 'active' });
    await GtfsVersion.updateOne({ _id: version._id }, { $unset: { 'meta.computedAt': 1 } });
    try {
      const res = await request(app).get('/api/schedule/status');
      expect(res.status).toBe(200);
      expect(res.body.routeCount).toBeNull();
      expect(res.body.stopTimeCount).toBeNull();
      expect(res.body.serviceIdCount).toBeNull();
      expect(res.body.serviceDateRange).toBeNull();
      expect(res.body.stationsMapped).toBeNull();
      expect(res.body.feedVersion).toBeNull();
    } finally {
      // Restore meta
      await computeAndStoreMeta(version._id, '1.0');
    }
  });

  it('POST /api/schedule/reload triggers a reload and returns 200', async () => {
    const res = await request(app).post('/api/schedule/reload');
    expect(res.status).toBe(200);
    expect(res.body.message).toMatch(/triggered/i);
  });
});

// ---- Tests: validation gate ----

describe('validation gate', () => {
  beforeAll(() => { process.env.GTFS_RAIL_SCHEDULE = 'true'; });
  afterAll(() => { delete process.env.GTFS_RAIL_SCHEDULE; });

  it('feed with no stop_times never becomes active', async () => {
    const activeIdBefore = (await GtfsVersion.findOne({ status: 'active' }))._id.toString();

    // minStations:0 so only the stop_times check fires
    await expect(
      loadGtfsStatic({ zipBuffer: buildZipNoStopTimes(), minStations: 0 })
    ).rejects.toThrow(/Validation failed.*no stop_times/);

    // The failed version must still be 'loading', never promoted to 'active'
    const loading = await GtfsVersion.find({ status: 'loading' });
    expect(loading.length).toBe(1);
    expect(loading[0].status).toBe('loading');

    // The original active version is unchanged
    const active = await GtfsVersion.findOne({ status: 'active' });
    expect(active).not.toBeNull();
    expect(active._id.toString()).toBe(activeIdBefore);

    await GtfsVersion.deleteMany({ status: 'loading' });
  });

  it('feed with too few stations never becomes active', async () => {
    const activeIdBefore = (await GtfsVersion.findOne({ status: 'active' }))._id.toString();

    // The fixture has 2 stations; require 99 to trigger the station-count check.
    // Use a different hash from the main fixture so the hash-skip doesn't fire.
    const zip = new AdmZip();
    zip.addFile('feed_info.txt', Buffer.from(FEED_INFO));
    zip.addFile('agency.txt',    Buffer.from(AGENCY));
    zip.addFile('routes.txt',    Buffer.from(ROUTES));
    zip.addFile('stops.txt',     Buffer.from(STOPS));
    zip.addFile('calendar_dates.txt', Buffer.from(CALENDAR_DATES));
    zip.addFile('trips.txt',     Buffer.from(TRIPS));
    zip.addFile('stop_times.txt', Buffer.from(STOP_TIMES));
    zip.addFile('_marker.txt',   Buffer.from('few-stations'));
    const fewStationsZip = zip.toBuffer();

    await expect(
      loadGtfsStatic({ zipBuffer: fewStationsZip, minStations: 99 })
    ).rejects.toThrow(/Validation failed.*stations mapped/);

    // The failed version must still be 'loading', never promoted to 'active'
    const loading = await GtfsVersion.find({ status: 'loading' });
    expect(loading.length).toBe(1);
    expect(loading[0].status).toBe('loading');

    // The original active version is unchanged
    const active = await GtfsVersion.findOne({ status: 'active' });
    expect(active).not.toBeNull();
    expect(active._id.toString()).toBe(activeIdBefore);

    await GtfsVersion.deleteMany({ status: 'loading' });
  });

  it('POST /api/schedule/reload → 503 when feature disabled', async () => {
    process.env.GTFS_RAIL_SCHEDULE = 'false';
    const res = await request(app).post('/api/schedule/reload');
    expect(res.status).toBe(503);
    process.env.GTFS_RAIL_SCHEDULE = 'true';
  });
});
