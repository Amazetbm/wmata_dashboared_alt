'use strict';

// Set env vars before any requires so module-level constants pick them up
process.env.GTFS_RAIL_SCHEDULE = 'true';

const { MongoMemoryServer } = require('mongodb-memory-server');
const mongoose = require('mongoose');

const GtfsVersion = require('../../models/GtfsVersion');

// Mock the loader so loadGtfsStatic never makes real HTTP calls
jest.mock('../../lib/gtfsStatic/loader', () => ({
  loadGtfsStatic: jest.fn().mockResolvedValue({ skipped: false, newVersionId: 'mock-id' }),
  computeAndStoreMeta: jest.fn().mockResolvedValue(undefined),
  cleanupPreviousVersions: jest.fn().mockResolvedValue(undefined),
}));

// Mock node-cron so scheduling doesn't actually fire
jest.mock('node-cron', () => ({
  schedule: jest.fn(),
}));

// Require module + mock references once — same instance across all tests
const { loadGtfsStatic, cleanupPreviousVersions } = require('../../lib/gtfsStatic/loader');
const { init } = require('../../jobs/scheduleLoader');

let mongod;

beforeAll(async () => {
  mongod = await MongoMemoryServer.create();
  await mongoose.connect(mongod.getUri());
});

afterAll(async () => {
  delete process.env.GTFS_RAIL_SCHEDULE;
  await mongoose.disconnect();
  await mongod.stop();
});

beforeEach(async () => {
  // Clear collection and reset mock call counts between tests
  const db = mongoose.connection.db;
  const collections = await db.listCollections().toArray();
  for (const c of collections) await db.dropCollection(c.name).catch(() => {});
  jest.clearAllMocks();
});

describe('scheduleLoader init()', () => {
  it('loads immediately when no active version exists', async () => {
    await init();
    // runLoad() is fire-and-forget; flush microtask queue
    await new Promise(r => setImmediate(r));

    expect(loadGtfsStatic).toHaveBeenCalledTimes(1);
  });

  it('defers to 3 AM cron when an active version already exists', async () => {
    await GtfsVersion.create({
      feedHash: 'existing-hash',
      feedDate: '20261027',
      status: 'active',
      loadedAt: new Date(),
    });

    await init();
    await new Promise(r => setImmediate(r));

    expect(loadGtfsStatic).not.toHaveBeenCalled();
  });

  it('calls cleanupPreviousVersions on init', async () => {
    await init();
    expect(cleanupPreviousVersions).toHaveBeenCalled();
  });
});
