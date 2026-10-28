'use strict';

const cron = require('node-cron');
const GtfsVersion = require('../models/GtfsVersion');
const { loadGtfsStatic, computeAndStoreMeta } = require('../lib/gtfsStatic/loader');

const ENABLED = process.env.GTFS_RAIL_SCHEDULE === 'true';
const STALE_HOURS = 36; // reload if active version is older than this

/**
 * Initialise the GTFS static schedule loader.
 * Called once after MongoDB connects.  No-op when the feature flag is off.
 */
async function init() {
  if (!ENABLED) return;

  // Check if we need an immediate load
  const active = await GtfsVersion.findOne({ status: 'active' }).sort({ loadedAt: -1 });
  const staleMs = STALE_HOURS * 60 * 60 * 1000;
  const needsLoad = !active || (Date.now() - active.loadedAt.getTime() > staleMs);

  // Backfill meta if the active version was loaded before computeAndStoreMeta was added
  if (active && !active.meta?.computedAt) {
    console.log('[scheduleLoader] Backfilling meta for existing active version…');
    computeAndStoreMeta(active._id, active.meta?.feedVersion || '')
      .catch(err => console.error('[scheduleLoader] Meta backfill failed:', err.message));
  }

  if (process.env.GTFS_FORCE_RELOAD === 'true') {
    console.log('[scheduleLoader] GTFS_FORCE_RELOAD=true — triggering forced reload');
    runLoad({ force: true }).catch(err => console.error('[scheduleLoader] Force reload failed:', err.message));
  } else if (needsLoad) {
    console.log('[scheduleLoader] Triggering immediate GTFS static load');
    runLoad().catch(err => console.error('[scheduleLoader] Initial load failed:', err.message));
  } else {
    console.log(`[scheduleLoader] Active GTFS version found (feedDate=${active.feedDate}), skipping immediate load`);
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
