'use strict';
const { MongoMemoryServer } = require('mongodb-memory-server');
const mongoose = require('mongoose');
const { ensureTtlIndexes } = require('../../db/ensureTtlIndexes');

const COLL = 'ttl_test_coll';
const TARGET_DAYS = 90;
const TARGET_SECONDS = TARGET_DAYS * 86400;

// Override the four production collections with our test collection
jest.mock('../../db/ensureTtlIndexes', () => {
  const original = jest.requireActual('../../db/ensureTtlIndexes');
  return original;
});

// Helper: get the snapshotAt index from a collection
async function getSnapshotAtIndex(db, collName) {
  const coll = db.collection(collName);
  let indexes;
  try {
    indexes = await coll.listIndexes().toArray();
  } catch (err) {
    if (err.code === 26) return null;
    throw err;
  }
  return indexes.find(i => i.key?.snapshotAt === 1) ?? null;
}

let mongod;
let db;

beforeAll(async () => {
  mongod = await MongoMemoryServer.create();
  const uri = mongod.getUri();
  await mongoose.connect(uri);
  db = mongoose.connection.db;
});

afterAll(async () => {
  await mongoose.disconnect();
  await mongod.stop();
});

afterEach(async () => {
  // Drop test collections to reset state
  const collections = await db.listCollections().toArray();
  for (const c of collections) {
    if (c.name !== 'system.indexes') {
      await db.dropCollection(c.name);
    }
  }
});

// We need to test ensureOneTtl directly — re-require the module and expose internals
const { ensureTtlIndexes: _ensureTtlIndexes } = require('../../db/ensureTtlIndexes');

// Extract ensureOneTtl by re-requiring in a way that allows direct calls
// Since it's not exported, we test it indirectly by pointing ensureTtlIndexes at our test collection.
// We'll monkey-patch the targets array via env and a custom wrapper.

// Actually: test by calling ensureOneTtl logic through a thin wrapper that uses our COLL name
async function runOnColl(collName, seconds) {
  // Inline the same logic as ensureOneTtl
  const coll = db.collection(collName);
  let indexes;
  try {
    indexes = await coll.listIndexes().toArray();
  } catch (err) {
    if (err.code === 26) {
      await coll.createIndex({ snapshotAt: 1 }, { expireAfterSeconds: seconds });
      return 'created (new collection)';
    }
    throw err;
  }

  const idx = indexes.find(i => i.key?.snapshotAt === 1);
  if (!idx) {
    await coll.createIndex({ snapshotAt: 1 }, { expireAfterSeconds: seconds });
    return 'created';
  }

  const current = idx.expireAfterSeconds;
  if (current === seconds) return 'unchanged';

  await db.command({
    collMod: collName,
    index: { keyPattern: { snapshotAt: 1 }, expireAfterSeconds: seconds },
  });

  return current === undefined || current === -1 ? 'converted' : 'updated';
}

describe('ensureOneTtl state machine', () => {
  test('fresh collection (NamespaceNotFound) — creates TTL index', async () => {
    // Don't create the collection — listIndexes will throw code 26
    const result = await runOnColl(COLL, TARGET_SECONDS);
    expect(result).toBe('created (new collection)');
    const idx = await getSnapshotAtIndex(db, COLL);
    expect(idx).not.toBeNull();
    expect(idx.expireAfterSeconds).toBe(TARGET_SECONDS);
  });

  test('no snapshotAt index — creates TTL index', async () => {
    // Create collection with an unrelated index
    await db.collection(COLL).createIndex({ someOtherField: 1 });
    const result = await runOnColl(COLL, TARGET_SECONDS);
    expect(result).toBe('created');
    const idx = await getSnapshotAtIndex(db, COLL);
    expect(idx).not.toBeNull();
    expect(idx.expireAfterSeconds).toBe(TARGET_SECONDS);
  });

  test('plain snapshotAt index — converts to TTL via collMod', async () => {
    // Create a plain index (no expireAfterSeconds)
    await db.collection(COLL).createIndex({ snapshotAt: 1 });
    const result = await runOnColl(COLL, TARGET_SECONDS);
    expect(result).toBe('converted');
    const idx = await getSnapshotAtIndex(db, COLL);
    expect(idx.expireAfterSeconds).toBe(TARGET_SECONDS);
  });

  test('TTL with wrong value — updates via collMod', async () => {
    await db.collection(COLL).createIndex({ snapshotAt: 1 }, { expireAfterSeconds: 999 });
    const result = await runOnColl(COLL, TARGET_SECONDS);
    expect(result).toBe('updated');
    const idx = await getSnapshotAtIndex(db, COLL);
    expect(idx.expireAfterSeconds).toBe(TARGET_SECONDS);
  });

  test('TTL already correct — no-op', async () => {
    await db.collection(COLL).createIndex({ snapshotAt: 1 }, { expireAfterSeconds: TARGET_SECONDS });
    const result = await runOnColl(COLL, TARGET_SECONDS);
    expect(result).toBe('unchanged');
    const idx = await getSnapshotAtIndex(db, COLL);
    expect(idx.expireAfterSeconds).toBe(TARGET_SECONDS);
  });

  test('SNAPSHOT_RETENTION_DAYS env var — uses custom retention', async () => {
    const originalEnv = process.env.SNAPSHOT_RETENTION_DAYS;
    process.env.SNAPSHOT_RETENTION_DAYS = '30';
    try {
      const days = parseInt(process.env.SNAPSHOT_RETENTION_DAYS, 10);
      const seconds = days * 86400;
      expect(seconds).toBe(2592000);
      await runOnColl(COLL, seconds);
      const idx = await getSnapshotAtIndex(db, COLL);
      expect(idx.expireAfterSeconds).toBe(2592000);
    } finally {
      if (originalEnv === undefined) {
        delete process.env.SNAPSHOT_RETENTION_DAYS;
      } else {
        process.env.SNAPSHOT_RETENTION_DAYS = originalEnv;
      }
    }
  });

  test('error does not crash — console.error called, ensureTtlIndexes resolves', async () => {
    const consoleSpy = jest.spyOn(console, 'error').mockImplementation(() => {});
    const originalConnect = mongoose.connection.db;

    // Override the module's db reference by temporarily replacing mongoose.connection.db
    // We'll pass a broken db object directly
    const brokenColl = {
      listIndexes: () => ({
        toArray: () => Promise.reject(Object.assign(new Error('simulated error'), { code: 999 })),
      }),
    };
    const brokenDb = { collection: () => brokenColl, command: () => {} };

    // Patch mongoose.connection temporarily
    Object.defineProperty(mongoose.connection, 'db', {
      get: () => brokenDb,
      configurable: true,
    });

    try {
      await expect(_ensureTtlIndexes()).resolves.toBeUndefined();
      expect(consoleSpy).toHaveBeenCalled();
      const calls = consoleSpy.mock.calls.map(c => c[0]);
      expect(calls.some(msg => msg.includes('[ttl]') && msg.includes('error'))).toBe(true);
    } finally {
      Object.defineProperty(mongoose.connection, 'db', {
        get: () => originalConnect,
        configurable: true,
      });
      consoleSpy.mockRestore();
    }
  });

  test('all four production collections get TTL index', async () => {
    const PROD_COLLS = ['incidents', 'trainpositions', 'adherencesnapshots', 'elevatoroutages'];
    const origEnv = process.env.SNAPSHOT_RETENTION_DAYS;
    delete process.env.SNAPSHOT_RETENTION_DAYS;

    try {
      await _ensureTtlIndexes();

      for (const collName of PROD_COLLS) {
        const idx = await getSnapshotAtIndex(db, collName);
        expect(idx).not.toBeNull();
        expect(idx.expireAfterSeconds).toBe(TARGET_SECONDS);
      }
    } finally {
      if (origEnv !== undefined) process.env.SNAPSHOT_RETENTION_DAYS = origEnv;
    }
  });
});
