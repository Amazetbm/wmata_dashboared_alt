'use strict';

const { MongoMemoryServer } = require('mongodb-memory-server');
const mongoose = require('mongoose');
const AdmZip = require('adm-zip');

// Models
const GtfsVersion = require('../../models/GtfsVersion');
const GtfsRoute = require('../../models/GtfsRoute');
const GtfsStop = require('../../models/GtfsStop');
const GtfsCalendarDate = require('../../models/GtfsCalendarDate');
const GtfsTrip = require('../../models/GtfsTrip');
const GtfsStopTime = require('../../models/GtfsStopTime');

const { loadGtfsStatic, deriveWmataCode, ROUTE_TO_LINE } = require('../../lib/gtfsStatic/loader');

// --- Fixture helpers ---

const FEED_INFO = `feed_publisher_name,feed_publisher_url,feed_lang,feed_start_date,feed_end_date
WMATA,http://www.wmata.com,en,20261027,20261106
`;

const AGENCY = `agency_id,agency_name,agency_url,agency_timezone,agency_lang,agency_phone,agency_fare_url
1,WMATA,http://www.wmata.com,America/New_York,en,202-637-7000,https://www.wmata.com/fares/
`;

const ROUTES = `route_id,agency_id,route_short_name,route_long_name,route_type,route_url,route_color,as_route,network_id,route_text_color
RED,1,R,Red,1,,C80F2D,1,Metrorail,FFFFFF
BLUE,1,B,Blue,1,,009CDE,1,Metrorail,FFFFFF
GREEN,1,G,Green,1,,00B140,1,Metrorail,FFFFFF
YELLOW,1,Y,Yellow,1,,FFD100,1,Metrorail,000000
ORANGE,1,O,Orange,1,,ED8B00,1,Metrorail,000000
SILVER,1,S,Silver,1,,91278F,1,Metrorail,FFFFFF
`;

const STOPS = `stop_id,stop_name,stop_desc,stop_lat,stop_lon,zone_id,location_type,parent_station,wheelchair_boarding,level_id
STN_A01,Metro Center,, 38.898303,-77.028099,1,1,,1,
PF_A01_C,Metro Center Platform C,,38.898303,-77.028099,1,0,STN_A01,1,
PF_A01_D,Metro Center Platform D,,38.898303,-77.028099,1,0,STN_A01,1,
STN_A02,Farragut North,,38.903192,-77.039766,1,1,,1,
PF_A02_C,Farragut North Platform C,,38.903192,-77.039766,1,0,STN_A02,1,
`;

const CALENDAR_DATES = `service_id,date,exception_type
WD,20261028,1
WD,20261029,1
WK,20261031,1
WD,20261030,2
`;

const TRIPS = `route_id,service_id,trip_id,trip_headsign,direction_id,block_id,shape_id,scheduled_trip_id,train_id
RED,WD,trip_001,Glenmont,0,,RRED_1,11968412,109
RED,WD,trip_002,Shady Grove,1,,RRED_2,11968413,110
RED,WK,trip_003,Glenmont,0,,RRED_1,11968414,111
BLUE,WD,trip_004,Largo Town Center,0,,RBLU_1,11968415,112
`;

// 5 stops per trip, 4 trips = 20 rows
function buildStopTimes() {
  const stopIds = ['PF_A01_C', 'PF_A02_C', 'PF_A01_C', 'PF_A02_C'];
  const trips = ['trip_001', 'trip_002', 'trip_003', 'trip_004'];
  const lines = ['trip_id,arrival_time,departure_time,stop_id,stop_sequence,pickup_type,drop_off_type,shape_dist_traveled'];
  for (let t = 0; t < trips.length; t++) {
    for (let s = 0; s < 5; s++) {
      const hh = String(6 + t).padStart(2, '0');
      const mm = String(s * 10).padStart(2, '0');
      lines.push(`${trips[t]},${hh}:${mm}:00,${hh}:${mm}:00,${stopIds[t % stopIds.length]},${s + 1},0,0,0`);
    }
  }
  return lines.join('\n') + '\n';
}

function buildZip(hash = '') {
  const zip = new AdmZip();
  zip.addFile('feed_info.txt', Buffer.from(FEED_INFO));
  zip.addFile('agency.txt',    Buffer.from(AGENCY));
  zip.addFile('routes.txt',    Buffer.from(ROUTES));
  zip.addFile('stops.txt',     Buffer.from(STOPS));
  zip.addFile('calendar_dates.txt', Buffer.from(CALENDAR_DATES));
  zip.addFile('trips.txt',     Buffer.from(TRIPS));
  zip.addFile('stop_times.txt', Buffer.from(buildStopTimes()));
  // Add a tiny comment to distinguish hash when requested
  if (hash) zip.addFile('_hash.txt', Buffer.from(hash));
  return zip.toBuffer();
}

// --- Test setup ---

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
  // Drop all GTFS collections between tests
  const db = mongoose.connection.db;
  const collections = await db.listCollections().toArray();
  for (const c of collections) {
    await db.dropCollection(c.name).catch(() => {});
  }
});

// --- Tests ---

describe('loadGtfsStatic', () => {
  it('populates all collections from fixture zip', async () => {
    const zipBuffer = buildZip();
    await loadGtfsStatic({ zipBuffer });

    const version = await GtfsVersion.findOne({ status: 'active' });
    expect(version).not.toBeNull();
    expect(version.feedDate).toBe('20261027');
    expect(version.agencyTz).toBe('America/New_York');

    expect(await GtfsRoute.countDocuments({ version: version._id })).toBe(6);
    expect(await GtfsStop.countDocuments({ version: version._id })).toBe(5);
    expect(await GtfsCalendarDate.countDocuments({ version: version._id })).toBe(4);
    expect(await GtfsTrip.countDocuments({ version: version._id })).toBe(4);
    expect(await GtfsStopTime.countDocuments({ version: version._id })).toBe(20);
  });

  it('maps route_id to lineCode correctly', async () => {
    await loadGtfsStatic({ zipBuffer: buildZip() });
    const version = await GtfsVersion.findOne({ status: 'active' });
    const redRoute = await GtfsRoute.findOne({ version: version._id, routeId: 'RED' });
    expect(redRoute.lineCode).toBe('RD');
    const blueRoute = await GtfsRoute.findOne({ version: version._id, routeId: 'BLUE' });
    expect(blueRoute.lineCode).toBe('BL');
  });

  it('derives wmataCode for STN_ and PF_ stop IDs', async () => {
    await loadGtfsStatic({ zipBuffer: buildZip() });
    const version = await GtfsVersion.findOne({ status: 'active' });
    const stn = await GtfsStop.findOne({ version: version._id, stopId: 'STN_A01' });
    expect(stn.wmataCode).toBe('A01');
    const pf = await GtfsStop.findOne({ version: version._id, stopId: 'PF_A01_C' });
    expect(pf.wmataCode).toBe('A01');
  });

  it('skips reload when feed hash is unchanged', async () => {
    const zipBuffer = buildZip('v1');
    await loadGtfsStatic({ zipBuffer });

    const versionsBefore = await GtfsVersion.countDocuments();
    const result = await loadGtfsStatic({ zipBuffer }); // same bytes → same hash
    expect(result.skipped).toBe(true);
    expect(await GtfsVersion.countDocuments()).toBe(versionsBefore);
  });

  it('replaces old active version when feed hash changes', async () => {
    await loadGtfsStatic({ zipBuffer: buildZip('v1') });
    const v1 = await GtfsVersion.findOne({ status: 'active' });
    const v1Id = v1._id;

    await loadGtfsStatic({ zipBuffer: buildZip('v2') });

    const v2 = await GtfsVersion.findOne({ status: 'active' });
    expect(v2._id.toString()).not.toBe(v1Id.toString());

    // Old version deleted from GtfsVersion
    const old = await GtfsVersion.findById(v1Id);
    expect(old).toBeNull();

    // Old version's data deleted
    expect(await GtfsRoute.countDocuments({ version: v1Id })).toBe(0);
    expect(await GtfsStopTime.countDocuments({ version: v1Id })).toBe(0);
  });

  it('cleans up orphaned loading version on next load', async () => {
    // Simulate a crashed partial load
    const orphan = await GtfsVersion.create({
      feedHash: 'orphaned-hash', feedDate: '20260101',
      status: 'loading', loadedAt: new Date(),
    });
    await GtfsRoute.create({ version: orphan._id, routeId: 'RED', lineCode: 'RD', longName: 'Red' });

    await loadGtfsStatic({ zipBuffer: buildZip('clean') });

    // Orphan should be gone
    expect(await GtfsVersion.findById(orphan._id)).toBeNull();
    expect(await GtfsRoute.countDocuments({ version: orphan._id })).toBe(0);

    // New version is active
    expect(await GtfsVersion.findOne({ status: 'active' })).not.toBeNull();
  });
});

describe('deriveWmataCode', () => {
  it('extracts code from STN_ prefix', () => {
    expect(deriveWmataCode('STN_A01')).toBe('A01');
    expect(deriveWmataCode('STN_N06')).toBe('N06');
  });

  it('extracts code from PF_ prefix (ignores platform suffix)', () => {
    expect(deriveWmataCode('PF_A15_C')).toBe('A15');
    expect(deriveWmataCode('PF_B01_D')).toBe('B01');
  });

  it('returns empty string for unknown formats', () => {
    expect(deriveWmataCode('unknown_stop')).toBe('');
  });
});

describe('ROUTE_TO_LINE', () => {
  it('maps all six WMATA rail lines', () => {
    expect(ROUTE_TO_LINE).toMatchObject({
      RED: 'RD', BLUE: 'BL', GREEN: 'GR',
      YELLOW: 'YL', ORANGE: 'OR', SILVER: 'SV',
    });
  });
});
