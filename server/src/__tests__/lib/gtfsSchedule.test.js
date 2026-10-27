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
const { loadGtfsStatic } = require('../../lib/gtfsStatic/loader');
const {
  getActiveServiceIds,
  getScheduledDepartures,
  getTripSchedule,
  getScheduledTripsInService,
} = require('../../lib/gtfsStatic/schedule');

// --- Fixture (mirrors gtfsLoader test fixture) ---
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
// 2026-10-28 = Wednesday; WD service runs; WK service does not
const CALENDAR_DATES = `service_id,date,exception_type
WD,20261028,1
WD,20261029,1
WK,20261031,1
WD,20261030,2
`;
// Trips: RED WD direction 0 and 1; RED WK direction 0; BLUE WD direction 0
const TRIPS = `route_id,service_id,trip_id,trip_headsign,direction_id,block_id,shape_id
RED,WD,trip_red_wd_0,Glenmont,0,,RRED_1
RED,WD,trip_red_wd_1,Shady Grove,1,,RRED_2
RED,WK,trip_red_wk_0,Glenmont,0,,RRED_1
BLUE,WD,trip_blue_wd_0,Largo Town Center,0,,RBLU_1
`;
// Stop times: each trip stops at A01 and A02
const STOP_TIMES = `trip_id,arrival_time,departure_time,stop_id,stop_sequence,pickup_type,drop_off_type,shape_dist_traveled
trip_red_wd_0,06:00:00,06:00:00,PF_A01_C,1,0,0,0
trip_red_wd_0,06:10:00,06:10:00,PF_A02_C,2,0,0,0
trip_red_wd_1,07:00:00,07:00:00,PF_A01_C,1,0,0,0
trip_red_wd_1,07:10:00,07:10:00,PF_A02_C,2,0,0,0
trip_red_wk_0,08:00:00,08:00:00,PF_A01_C,1,0,0,0
trip_red_wk_0,08:10:00,08:10:00,PF_A02_C,2,0,0,0
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

let mongod;
let versionId;

beforeAll(async () => {
  mongod = await MongoMemoryServer.create();
  await mongoose.connect(mongod.getUri());
  const result = await loadGtfsStatic({ zipBuffer: buildZip() });
  const v = await GtfsVersion.findOne({ status: 'active' });
  versionId = v._id;
});

afterAll(async () => {
  await mongoose.disconnect();
  await mongod.stop();
});

// --- getActiveServiceIds ---

describe('getActiveServiceIds', () => {
  it('returns WD for a Wednesday (2026-10-28)', async () => {
    const ids = await getActiveServiceIds('2026-10-28', versionId);
    expect(ids).toContain('WD');
    expect(ids).not.toContain('WK');
  });

  it('returns WK for a Saturday (2026-10-31)', async () => {
    const ids = await getActiveServiceIds('2026-10-31', versionId);
    expect(ids).toContain('WK');
    expect(ids).not.toContain('WD');
  });

  it('respects exception_type=2 removal: WD removed on 2026-10-30', async () => {
    const ids = await getActiveServiceIds('2026-10-30', versionId);
    expect(ids).not.toContain('WD');
  });

  it('returns empty array for a date with no service', async () => {
    const ids = await getActiveServiceIds('2026-11-15', versionId);
    expect(ids).toEqual([]);
  });
});

// --- getScheduledDepartures ---

describe('getScheduledDepartures', () => {
  it('returns departures at A01 on 2026-10-28 (WD service)', async () => {
    const deps = await getScheduledDepartures('A01', '2026-10-28', versionId);
    expect(deps.length).toBeGreaterThan(0);
    // Should have RED WD trips and BLUE WD trips but NOT RED WK
    const tripIds = deps.map(d => d.tripId);
    expect(tripIds).toContain('trip_red_wd_0');
    expect(tripIds).toContain('trip_red_wd_1');
    expect(tripIds).toContain('trip_blue_wd_0');
    expect(tripIds).not.toContain('trip_red_wk_0');
  });

  it('returns departures sorted by departureSec ascending', async () => {
    const deps = await getScheduledDepartures('A01', '2026-10-28', versionId);
    for (let i = 1; i < deps.length; i++) {
      expect(deps[i].departureSec).toBeGreaterThanOrEqual(deps[i - 1].departureSec);
    }
  });

  it('returns correct lineCode', async () => {
    const deps = await getScheduledDepartures('A01', '2026-10-28', versionId);
    const redDep = deps.find(d => d.tripId === 'trip_red_wd_0');
    expect(redDep.lineCode).toBe('RD');
    const blueDep = deps.find(d => d.tripId === 'trip_blue_wd_0');
    expect(blueDep.lineCode).toBe('BL');
  });

  it('returns empty array for unknown station code', async () => {
    const deps = await getScheduledDepartures('ZZ99', '2026-10-28', versionId);
    expect(deps).toEqual([]);
  });

  it('returns empty array when no service on that date', async () => {
    const deps = await getScheduledDepartures('A01', '2026-11-15', versionId);
    expect(deps).toEqual([]);
  });

  it('includes departureTimeUtc as a Date', async () => {
    const deps = await getScheduledDepartures('A01', '2026-10-28', versionId);
    for (const d of deps) {
      expect(d.departureTimeUtc).toBeInstanceOf(Date);
      expect(isNaN(d.departureTimeUtc.getTime())).toBe(false);
    }
  });
});

// --- getTripSchedule ---

describe('getTripSchedule', () => {
  it('returns stop times for a trip in sequence order', async () => {
    const stops = await getTripSchedule('trip_red_wd_0', '2026-10-28', versionId);
    expect(stops.length).toBe(2);
    expect(stops[0].stopSequence).toBe(1);
    expect(stops[1].stopSequence).toBe(2);
    expect(stops[0].stopId).toBe('PF_A01_C');
    expect(stops[1].stopId).toBe('PF_A02_C');
  });

  it('includes departureTimeUtc', async () => {
    const stops = await getTripSchedule('trip_red_wd_0', '2026-10-28', versionId);
    for (const s of stops) {
      expect(s.departureTimeUtc).toBeInstanceOf(Date);
    }
  });

  it('returns empty array for unknown tripId', async () => {
    const stops = await getTripSchedule('nonexistent_trip', '2026-10-28', versionId);
    expect(stops).toEqual([]);
  });
});

// --- getScheduledTripsInService ---

describe('getScheduledTripsInService', () => {
  it('returns RED trips on a weekday', async () => {
    const trips = await getScheduledTripsInService('RD', '2026-10-28', versionId);
    expect(trips.length).toBe(2); // trip_red_wd_0 + trip_red_wd_1
    expect(trips.map(t => t.tripId).sort()).toEqual(
      ['trip_red_wd_0', 'trip_red_wd_1'].sort()
    );
  });

  it('returns RED trips on a weekend', async () => {
    const trips = await getScheduledTripsInService('RD', '2026-10-31', versionId);
    expect(trips.length).toBe(1);
    expect(trips[0].tripId).toBe('trip_red_wk_0');
  });

  it('returns empty array for unknown line code', async () => {
    const trips = await getScheduledTripsInService('XX', '2026-10-28', versionId);
    expect(trips).toEqual([]);
  });
});
