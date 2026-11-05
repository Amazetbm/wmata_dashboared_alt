'use strict';

const cron = require('node-cron');
const GtfsVersion = require('../models/GtfsVersion');
const { loadGtfsStatic, computeAndStoreMeta, cleanupPreviousVersions } = require('../lib/gtfsStatic/loader');

const ENABLED         = process.env.GTFS_RAIL_SCHEDULE === 'true';
const POLLER_ENABLED  = process.env.POLLER_ENABLED !== 'false';

/**
 * Initialise the GTFS static schedule loader.
 * Called once after MongoDB connects.  No-op when the feature flag is off.
 */
async function init() {
  if (!ENABLED) return;
  if (!POLLER_ENABLED) {
    console.log('[scheduleLoader] POLLER_ENABLED=false — schedule loader disabled');
    return;
  }

  const active = await GtfsVersion.findOne({ status: 'active' }).sort({ loadedAt: -1 });

  // Prune expired previous versions
  await cleanupPreviousVersions().catch(err =>
    console.error('[scheduleLoader] cleanupPreviousVersions failed:', err.message));

  // Backfill meta if the active version was loaded before computeAndStoreMeta was added
  if (active && !active.meta?.computedAt) {
    console.log('[scheduleLoader] Backfilling meta for existing active version…');
    computeAndStoreMeta(active._id, active.meta?.feedVersion || '')
      .catch(err => console.error('[scheduleLoader] Meta backfill failed:', err.message));
  }

  // Check for deprecated env var
  if (process.env.GTFS_FORCE_RELOAD === 'true') {
    console.warn('[scheduleLoader] GTFS_FORCE_RELOAD is deprecated — use GTFS_RAIL_SCHEDULE_FORCE_RELOAD');
  }
  const forceReload = process.env.GTFS_RAIL_SCHEDULE_FORCE_RELOAD === 'true'
    || process.env.GTFS_FORCE_RELOAD === 'true';

  if (forceReload) {
    console.log('[scheduleLoader] Force reload requested — triggering reload');
    runLoad({ force: true }).catch(err => console.error('[scheduleLoader] Force reload failed:', err.message));
  } else if (!active) {
    console.log('[scheduleLoader] No active GTFS version — triggering immediate load');
    runLoad().catch(err => console.error('[scheduleLoader] Initial load failed:', err.message));
  } else {
    const ageHours = Math.round((Date.now() - active.loadedAt.getTime()) / 3600000);
    console.log(`[scheduleLoader] Active version present (feedDate=${active.feedDate}, age=${ageHours}h) — deferring to 3 AM cron`);
  }

  // Daily reload at 3 AM Eastern
  cron.schedule('0 3 * * *', () => {
    console.log('[scheduleLoader] Running daily GTFS static reload');
    runLoad().catch(err => console.error('[scheduleLoader] Daily reload failed:', err.message));
  }, { timezone: 'America/New_York' });
}

async function runLoad(opts = {}) {
  try {
    const result = await loadGtfsStatic(opts);
    if (result.skipped) {
      console.log('[scheduleLoader] Feed unchanged, no reload needed');
    } else {
      console.log(`[scheduleLoader] Load complete, new version: ${result.newVersionId}`);
    }
  } catch (err) {
    console.error('[scheduleLoader] Load error:', err.message);
    throw err;
  }
}

module.exports = { init };
