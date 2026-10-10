'use strict';
const mongoose = require('mongoose');

async function ensureOneTtl(db, collectionName, targetSeconds) {
  const coll = db.collection(collectionName);
  let indexes;
  try {
    indexes = await coll.listIndexes().toArray();
  } catch (err) {
    if (err.code === 26) {  // NamespaceNotFound — collection doesn't exist yet
      await coll.createIndex({ snapshotAt: 1 }, { expireAfterSeconds: targetSeconds });
      console.log(`[ttl] ${collectionName}: created TTL index (new collection)`);
      return;
    }
    throw err;
  }

  const idx = indexes.find(i => i.key?.snapshotAt === 1);

  if (!idx) {
    await coll.createIndex({ snapshotAt: 1 }, { expireAfterSeconds: targetSeconds });
    console.log(`[ttl] ${collectionName}: created TTL index`);
    return;
  }

  const current = idx.expireAfterSeconds;
  if (current === targetSeconds) {
    console.log(`[ttl] ${collectionName}: TTL index unchanged (${targetSeconds}s)`);
    return;
  }

  await db.command({
    collMod: collectionName,
    index: { keyPattern: { snapshotAt: 1 }, expireAfterSeconds: targetSeconds },
  });

  if (current === undefined || current === -1) {
    console.log(`[ttl] ${collectionName}: converted plain index → TTL (${targetSeconds}s)`);
  } else {
    console.log(`[ttl] ${collectionName}: updated TTL ${current}s → ${targetSeconds}s`);
  }
}

async function ensureTtlIndexes() {
  const days = parseInt(process.env.SNAPSHOT_RETENTION_DAYS ?? '90', 10);
  const seconds = days * 86400;
  const db = mongoose.connection.db;

  const targets = [
    'incidents',
    'trainpositions',
    'adherencesnapshots',
    'elevatoroutages',
  ];

  await Promise.all(
    targets.map(name =>
      ensureOneTtl(db, name, seconds).catch(err =>
        console.error(`[ttl] ${name}: error — ${err.message}`)
      )
    )
  );
}

module.exports = { ensureTtlIndexes };
