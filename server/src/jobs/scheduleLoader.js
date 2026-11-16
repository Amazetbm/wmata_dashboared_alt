'use strict';

const cron = require('node-cron');
const GtfsVersion = require('../models/GtfsVersion');
const { loadGtfsStatic, computeAndStoreMeta, cleanupPreviousVersions } = require('../lib/gtfsStatic/loader');

const ENABLED_FLAGS = {
  rail: process.env.GTFS_RAIL_SCHEDULE === 'true',
  bus:  process.env.GTFS_BUS_SCHEDULE  === 'true',
};
const POLLER_ENABLED = process.env.POLLER_ENABLED !== 'false';

/**
 * Initialise the GTFS static schedule loader for the given mode.
 * Called once after MongoDB connects.  No-op when the feature flag is off.
 *
 * @param {'rail'|'bus'} [mode='rail']
 */
async function init(mode = 'rail') {
  const enabled = ENABLED_FLAGS[mode] ?? false;
  if (!enabled) return;
  if (!POLLER_ENABLED) {
    console.log(`[scheduleLoader] POLLER_ENABLED=false — ${mode} schedule loader disabled`);
    return;
  }

  // Migrate existing docs that pre-date the mode field (rail only — bus never had undifferentiated docs)
  if (mode === 'rail') {
    const migrated = await GtfsVersion.updateMany(
      { mode: { $exists: false } },
      { $set: { mode: 'rail' } }
    );
    if (migrated.modifiedCount > 0) {
      console.log(`[scheduleLoader] Migrated ${migrated.modifiedCount} GtfsVersion doc(s) to mode=rail`);
    }
  }

  const active = await GtfsVersion.findOne({ status: 'active', mode }).sort({ loadedAt: -1 });

  // Prune expired previous versions (mode-scoped)
  await cleanupPreviousVersions(mode).catch(err =>
    console.error(`[scheduleLoader] cleanupPreviousVersions(${mode}) failed:`, err.message));

  // Backfill meta if the active version was loaded before computeAndStoreMeta was added
  if (active && !active.meta?.computedAt) {
    console.log(`[scheduleLoader] Backfilling meta for existing active ${mode} version…`);
    computeAndStoreMeta(active._id, active.meta?.feedVersion || '', mode)
      .catch(err => console.error(`[scheduleLoader] Meta backfill (${mode}) failed:`, err.message));
  }

  if (mode === 'rail') {
    // Check for deprecated env var
    if (process.env.GTFS_FORCE_RELOAD === 'true') {
      console.warn('[scheduleLoader] GTFS_FORCE_RELOAD is deprecated — use GTFS_RAIL_SCHEDULE_FORCE_RELOAD');
    }
  }

  const forceEnvKey = mode === 'rail' ? 'GTFS_RAIL_SCHEDULE_FORCE_RELOAD' : 'GTFS_BUS_SCHEDULE_FORCE_RELOAD';
  const forceReload = process.env[forceEnvKey] === 'true'
    || (mode === 'rail' && process.env.GTFS_FORCE_RELOAD === 'true');

  if (forceReload) {
    console.log(`[scheduleLoader] Force reload requested for ${mode} — triggering reload`);
    runLoad(mode, { force: true }).catch(err => console.error(`[scheduleLoader] Force reload (${mode}) failed:`, err.message));
  } else if (!active) {
    console.log(`[scheduleLoader] No active ${mode} GTFS version — triggering immediate load`);
    runLoad(mode).catch(err => console.error(`[scheduleLoader] Initial load (${mode}) failed:`, err.message));
  } else {
    const ageHours = Math.round((Date.now() - active.loadedAt.getTime()) / 3600000);
    const cronTime = mode === 'bus' ? '3:30 AM' : '3:00 AM';
    console.log(`[scheduleLoader] Active ${mode} version present (feedDate=${active.feedDate}, age=${ageHours}h) — deferring to ${cronTime} cron`);
  }

  // Daily reload — rail at 3 AM ET, bus at 3:30 AM ET (staggered to avoid concurrent loads)
  const cronExpr = mode === 'bus' ? '30 3 * * *' : '0 3 * * *';
  cron.schedule(cronExpr, () => {
    console.log(`[scheduleLoader] Running daily ${mode} GTFS static reload`);
    runLoad(mode).catch(err => console.error(`[scheduleLoader] Daily reload (${mode}) failed:`, err.message));
  }, { timezone: 'America/New_York' });
}

async function runLoad(mode, opts = {}) {
  try {
    const result = await loadGtfsStatic({ ...opts, mode });
    if (result.skipped) {
      console.log(`[scheduleLoader] ${mode} feed unchanged, no reload needed`);
    } else {
      console.log(`[scheduleLoader] ${mode} load complete, new version: ${result.newVersionId}`);
    }
  } catch (err) {
    console.error(`[scheduleLoader] ${mode} load error:`, err.message);
    throw err;
  }
}

module.exports = { init };
