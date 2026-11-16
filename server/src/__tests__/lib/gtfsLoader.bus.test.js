'use strict';

const { MongoMemoryServer } = require('mongodb-memory-server');
const mongoose = require('mongoose');
const AdmZip = require('adm-zip');

const GtfsVersion = require('../../models/GtfsVersion');
const GtfsRoute = require('../../models/GtfsRoute');
const GtfsStop = require('../../models/GtfsStop');
const GtfsCalendarDate = require('../../models/GtfsCalendarDate');
const GtfsTrip = require('../../models/GtfsTrip');
const GtfsStopTime = require('../../models/GtfsStopTime');

const { loadGtfsStatic, cleanupPreviousVersions } = require('../../lib/gtfsStatic/loader');

// Use small thresholds in tests to avoid inserting hundreds of thousands of rows.
const BUS_TEST_OPTS = { minRoutes: 2, minStopTimeCount: 5 };
const load = (opts = {}) => loadGtfsStatic({ ...BUS_TEST_OPTS, ...opts });

const FEED_INFO = `feed_publisher_name,feed_publisher_url,feed_lang,feed_start_date,feed_end_date
WMATA,http://www.wmata.com,en,20261101,20261130
`;

const AGENCY = `agency_id,agency_name,agency_url,agency_timezone,agency_lang
1,WMATA,http://www.wmata.com,America/New_York,en
`;

const BUS_ROUTES = `route_id,agency_id,route_short_name,route_long_name,route_type
A11,1,A11,Bus Route A11,3
B30,1,B30,Bus Route B30,3
`;

const BUS_STOPS = `stop_id,stop_name,stop_lat,stop_lon,location_type,stop_code
1001,First Stop,38.9,-77.0,0,BUS_1001
1002,Second Stop,38.91,-77.01,0,BUS_1002
`;

const BUS_CALENDAR_DATES = `service_id,date,exception_type
WD,20261103,1
WD,20261104,1
`;

const BUS_TRIPS = `route_id,service_id,trip_id,trip_headsign,direction_id
A11,WD,trip_A11_1,Eastbound,0
B30,WD,trip_B30_1,Westbound,1
`;

function buildStopTimes(label = 'stop_times') {
  const rows = [`trip_id,arrival_time,departure_time,stop_id,stop_sequence`];
  for (let i = 1; i <= 6; i++) {
    rows.push(`trip_A11_1,08:0${i}:00,08:0${i}:00,1001,${i}`);
  }
  return rows.join('\n') + '\n';
}

function buildBusZip(opts = {}) {
  const zip = new AdmZip();
  zip.addFile('feed_info.txt', Buffer.from(FEED_INFO));
  zip.addFile('agency.txt',    Buffer.from(AGENCY));
  zip.addFile('routes.txt',    Buffer.from(BUS_ROUTES));
  zip.addFile('stops.txt',     Buffer.from(BUS_STOPS));
  zip.addFile('calendar_dates.txt', Buffer.from(BUS_CALENDAR_DATES));
  zip.addFile('trips.txt',     Buffer.from(BUS_TRIPS));
  if (!opts.omitTimepointTimes) {
    zip.addFile('timepoint_times.txt', Buffer.from(opts.timepointContent ?? buildStopTimes('timepoint_times')));
  } else {
    zip.addFile('stop_times.txt', Buffer.from(opts.stopTimesContent ?? buildStopTimes('stop_times')));
  }
  if (opts.hash) zip.addFile('_hash.txt', Buffer.from(opts.hash));
  return zip.toBuffer();
}

let mongod;

beforeAll(async () => {
  mongod = await MongoMemoryServer.create();
  await mongoose.connect(mongod.getUri());
});

afterAll(async () => {
  await mongoose.disconnect();
  await mongod.stop();
});

afterEach(async () => {
  const db = mongoose.connection.db;
  const collections = await db.listCollections().toArray();
  for (const c of collections) {
    await db.dropCollection(c.name).catch(() => {});
  }
});

describe('loadGtfsStatic (bus mode)', () => {
  it('creates GtfsVersion with mode=bus and status=active', async () => {
    await load({ mode: 'bus', zipBuffer: buildBusZip() });

    const version = await GtfsVersion.findOne({ status: 'active', mode: 'bus' });
    expect(version).not.toBeNull();
    expect(version.mode).toBe('bus');
    expect(version.feedDate).toBe('20261101');
  });

  it('sets lineCode = route_id for bus routes (no ROUTE_TO_LINE mapping)', async () => {
    await load({ mode: 'bus', zipBuffer: buildBusZip() });

    const version = await GtfsVersion.findOne({ status: 'active', mode: 'bus' });
    const route = await GtfsRoute.findOne({ version: version._id, routeId: 'A11' });
    expect(route).not.toBeNull();
    expect(route.lineCode).toBe('A11');
  });

  it('sets wmataCode from stop_code field for bus stops', async () => {
    await load({ mode: 'bus', zipBuffer: buildBusZip() });

    const version = await GtfsVersion.findOne({ status: 'active', mode: 'bus' });
    const stop = await GtfsStop.findOne({ version: version._id, stopId: '1001' });
    expect(stop).not.toBeNull();
    expect(stop.wmataCode).toBe('BUS_1001');
  });

  it('loads timepoint_times.txt (not stop_times.txt) when present', async () => {
    // Build a zip with BOTH timepoint_times.txt and stop_times.txt with different content
    const zip = new AdmZip();
    zip.addFile('feed_info.txt', Buffer.from(FEED_INFO));
    zip.addFile('agency.txt',    Buffer.from(AGENCY));
    zip.addFile('routes.txt',    Buffer.from(BUS_ROUTES));
    zip.addFile('stops.txt',     Buffer.from(BUS_STOPS));
    zip.addFile('calendar_dates.txt', Buffer.from(BUS_CALENDAR_DATES));
    zip.addFile('trips.txt',     Buffer.from(BUS_TRIPS));
    // timepoint_times has 6 rows; stop_times has 100 rows — loader should use timepoint_times
    const timepointRows = buildStopTimes(); // 6 rows
    const stopTimesRows = [...Array(100)].reduce((acc, _, i) =>
      acc + `trip_A11_1,09:0${i % 10}:00,09:0${i % 10}:00,1001,${i + 1}\n`, 'trip_id,arrival_time,departure_time,stop_id,stop_sequence\n');
    zip.addFile('timepoint_times.txt', Buffer.from(timepointRows));
    zip.addFile('stop_times.txt',      Buffer.from(stopTimesRows));
    const zipBuffer = zip.toBuffer();

    await load({ mode: 'bus', zipBuffer });

    const version = await GtfsVersion.findOne({ status: 'active', mode: 'bus' });
    const count = await GtfsStopTime.countDocuments({ version: version._id });
    // Should have used timepoint_times.txt (6 rows), not stop_times.txt (100 rows)
    expect(count).toBe(6);
  });

  it('bus and rail versions do not interfere with each other', async () => {
    await load({ mode: 'bus', zipBuffer: buildBusZip() });

    const busVersions = await GtfsVersion.find({ mode: 'bus' });
    const railVersions = await GtfsVersion.find({ mode: 'rail' });
    expect(busVersions).toHaveLength(1);
    expect(railVersions).toHaveLength(0);
  });

  it('skips reload when bus feed hash is unchanged', async () => {
    const zipBuffer = buildBusZip({ hash: 'v1' });
    await load({ mode: 'bus', zipBuffer });

    const versionsBefore = await GtfsVersion.countDocuments({ mode: 'bus' });
    const result = await load({ mode: 'bus', zipBuffer });
    expect(result.skipped).toBe(true);
    expect(await GtfsVersion.countDocuments({ mode: 'bus' })).toBe(versionsBefore);
  });

  it('force=true bypasses hash check and reloads', async () => {
    const zipBuffer = buildBusZip({ hash: 'v1' });
    await load({ mode: 'bus', zipBuffer });

    const result = await load({ mode: 'bus', zipBuffer, force: true });
    expect(result.skipped).toBeUndefined();
    expect(result.newVersionId).toBeDefined();
  });

  it('bus validation fails when routeCount < minRoutes threshold', async () => {
    // Use a threshold higher than the 2 routes in the fixture
    await expect(loadGtfsStatic({ mode: 'bus', minRoutes: 100, minStopTimeCount: 5, zipBuffer: buildBusZip() }))
      .rejects.toThrow('Bus validation failed');

    // Version left as 'loading'
    const v = await GtfsVersion.findOne({ mode: 'bus' });
    expect(v?.status).toBe('loading');
  });

  it('bus validation fails when stopTimeCount < minStopTimeCount threshold', async () => {
    // Use a threshold higher than the 6 rows in the fixture
    await expect(loadGtfsStatic({ mode: 'bus', minRoutes: 2, minStopTimeCount: 1000, zipBuffer: buildBusZip() }))
      .rejects.toThrow('Bus validation failed');
  });

  it('bus validation fails when trip count is 0', async () => {
    const emptyTrips = 'route_id,service_id,trip_id,trip_headsign,direction_id\n'; // header only
    const zip = new AdmZip();
    zip.addFile('feed_info.txt', Buffer.from(FEED_INFO));
    zip.addFile('agency.txt',    Buffer.from(AGENCY));
    zip.addFile('routes.txt',    Buffer.from(BUS_ROUTES));
    zip.addFile('stops.txt',     Buffer.from(BUS_STOPS));
    zip.addFile('calendar_dates.txt', Buffer.from(BUS_CALENDAR_DATES));
    zip.addFile('trips.txt',     Buffer.from(emptyTrips));
    zip.addFile('timepoint_times.txt', Buffer.from(buildStopTimes('timepoint_times')));
    zip.addFile('_marker.txt',   Buffer.from('zero-trips'));

    await expect(loadGtfsStatic({ mode: 'bus', minRoutes: 2, minStopTimeCount: 5, zipBuffer: zip.toBuffer() }))
      .rejects.toThrow(/Bus validation failed.*no trips/);

    const v = await GtfsVersion.findOne({ mode: 'bus' });
    expect(v?.status).toBe('loading');
  });

  it('bus validation fails when today is outside the feed date range', async () => {
    // Use a feed that expired in the past (before 2026-11-16)
    const pastFeedInfo = `feed_publisher_name,feed_publisher_url,feed_lang,feed_start_date,feed_end_date
WMATA,http://www.wmata.com,en,20260101,20260630
`;
    const zip = new AdmZip();
    zip.addFile('feed_info.txt', Buffer.from(pastFeedInfo));
    zip.addFile('agency.txt',    Buffer.from(AGENCY));
    zip.addFile('routes.txt',    Buffer.from(BUS_ROUTES));
    zip.addFile('stops.txt',     Buffer.from(BUS_STOPS));
    zip.addFile('calendar_dates.txt', Buffer.from(BUS_CALENDAR_DATES));
    zip.addFile('trips.txt',     Buffer.from(BUS_TRIPS));
    zip.addFile('timepoint_times.txt', Buffer.from(buildStopTimes('timepoint_times')));

    await expect(loadGtfsStatic({ mode: 'bus', minRoutes: 2, minStopTimeCount: 5, zipBuffer: zip.toBuffer() }))
      .rejects.toThrow(/Bus validation failed.*feed has expired/);
  });

  it('cleanupPreviousVersions scopes to bus mode only', async () => {
    // Create a stale bus previous version
    const v = await GtfsVersion.create({
      feedHash: 'old-bus-hash',
      feedDate: '20261001',
      mode: 'bus',
      status: 'previous',
      previousSince: new Date(Date.now() - 40 * 3600 * 1000), // 40h > 36h threshold
      lastMatchAt: new Date(),
    });
    // Also create a rail previous version that should NOT be cleaned up
    const railV = await GtfsVersion.create({
      feedHash: 'rail-prev-hash',
      feedDate: '20261001',
      mode: 'rail',
      status: 'previous',
      previousSince: new Date(Date.now() - 40 * 3600 * 1000),
      lastMatchAt: new Date(),
    });

    await cleanupPreviousVersions('bus');

    expect(await GtfsVersion.findById(v._id)).toBeNull();      // bus cleaned up
    expect(await GtfsVersion.findById(railV._id)).not.toBeNull(); // rail untouched
  });
});
