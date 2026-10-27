'use strict';

const cron = require('node-cron');
const GtfsVersion = require('../models/GtfsVersion');
const { loadGtfsStatic } = require('../lib/gtfsStatic/loader');

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

  if (needsLoad) {
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

async function runLoad() {
  try {
    const result = await loadGtfsStatic();
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
