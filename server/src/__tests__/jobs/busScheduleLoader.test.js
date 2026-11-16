'use strict';

// Set env vars BEFORE any requires so module-level constants pick them up.
// We test bus-specific behaviour here; rail init is covered in scheduleLoader.test.js.
process.env.GTFS_BUS_SCHEDULE = 'true';

const { MongoMemoryServer } = require('mongodb-memory-server');
const mongoose = require('mongoose');

const GtfsVersion = require('../../models/GtfsVersion');

// Mock the loader so loadGtfsStatic never makes real HTTP calls
jest.mock('../../lib/gtfsStatic/loader', () => ({
  loadGtfsStatic: jest.fn().mockResolvedValue({ skipped: false, newVersionId: 'mock-bus-id' }),
  computeAndStoreMeta: jest.fn().mockResolvedValue(undefined),
  cleanupPreviousVersions: jest.fn().mockResolvedValue(undefined),
}));

// Mock node-cron so scheduling doesn't actually fire
const mockSchedule = jest.fn();
jest.mock('node-cron', () => ({ schedule: mockSchedule }));

const { loadGtfsStatic, cleanupPreviousVersions } = require('../../lib/gtfsStatic/loader');
const { init } = require('../../jobs/scheduleLoader');

let mongod;

beforeAll(async () => {
  mongod = await MongoMemoryServer.create();
  await mongoose.connect(mongod.getUri());
});

afterAll(async () => {
  delete process.env.GTFS_BUS_SCHEDULE;
  delete process.env.GTFS_BUS_SCHEDULE_FORCE_RELOAD;
  await mongoose.disconnect();
  await mongod.stop();
});

beforeEach(async () => {
  const db = mongoose.connection.db;
  const collections = await db.listCollections().toArray();
  for (const c of collections) await db.dropCollection(c.name).catch(() => {});
  jest.clearAllMocks();
});

describe('scheduleLoader init(bus)', () => {
  it('loads immediately when no active bus version exists', async () => {
    await init('bus');
    await new Promise(r => setImmediate(r));

    expect(loadGtfsStatic).toHaveBeenCalledTimes(1);
    expect(loadGtfsStatic).toHaveBeenCalledWith(expect.objectContaining({ mode: 'bus' }));
  });

  it('defers to 3:30 AM cron when an active bus version already exists', async () => {
    await GtfsVersion.create({
      feedHash: 'active-bus-hash',
      feedDate: '20261101',
      mode: 'bus',
      status: 'active',
      loadedAt: new Date(),
    });

    await init('bus');
    await new Promise(r => setImmediate(r));

    expect(loadGtfsStatic).not.toHaveBeenCalled();
    expect(mockSchedule).toHaveBeenCalledWith(
      '30 3 * * *',
      expect.any(Function),
      expect.objectContaining({ timezone: 'America/New_York' }),
    );
  });

  it('calls cleanupPreviousVersions with mode=bus on init', async () => {
    await init('bus');
    expect(cleanupPreviousVersions).toHaveBeenCalledWith('bus');
  });

  it('force-reload triggers load with force=true when GTFS_BUS_SCHEDULE_FORCE_RELOAD=true', async () => {
    process.env.GTFS_BUS_SCHEDULE_FORCE_RELOAD = 'true';

    // Active version exists — normally would defer, but force skips that
    await GtfsVersion.create({
      feedHash: 'existing-bus-hash',
      feedDate: '20261101',
      mode: 'bus',
      status: 'active',
      loadedAt: new Date(),
    });

    await init('bus');
    await new Promise(r => setImmediate(r));

    expect(loadGtfsStatic).toHaveBeenCalledWith(expect.objectContaining({ mode: 'bus', force: true }));

    delete process.env.GTFS_BUS_SCHEDULE_FORCE_RELOAD;
  });

  it('bus cron uses 30 3 * * * (3:30 AM ET), not rail cron 0 3 * * *', async () => {
    await init('bus');
    await new Promise(r => setImmediate(r));

    // All cron.schedule calls — bus must use '30 3 * * *'
    const busCall = mockSchedule.mock.calls.find(c => c[0] === '30 3 * * *');
    const railCall = mockSchedule.mock.calls.find(c => c[0] === '0 3 * * *');
    expect(busCall).toBeDefined();
    expect(railCall).toBeUndefined();
  });
});
