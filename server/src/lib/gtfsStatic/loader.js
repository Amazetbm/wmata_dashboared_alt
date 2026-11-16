'use strict';

const crypto = require('crypto');
const axios = require('axios');
const unzipper = require('unzipper');
const { parse: csvParse } = require('csv-parse');
const { DateTime } = require('luxon');
const { parseGtfsTime } = require('./timeUtils');

const GtfsVersion = require('../../models/GtfsVersion');
const GtfsRoute = require('../../models/GtfsRoute');
const GtfsStop = require('../../models/GtfsStop');
const GtfsCalendarDate = require('../../models/GtfsCalendarDate');
const GtfsTrip = require('../../models/GtfsTrip');
const GtfsStopTime = require('../../models/GtfsStopTime');

const FEED_URLS = {
  rail: 'https://api.wmata.com/gtfs/rail-gtfs-static.zip',
  bus:  'https://api.wmata.com/gtfs/bus-gtfs-static.zip',
};
const BATCH_SIZE = 500;

// Maps GTFS full route names → 2-letter WMATA line codes (rail only)
const ROUTE_TO_LINE = {
  RED:    'RD',
  BLUE:   'BL',
  GREEN:  'GR',
  YELLOW: 'YL',
  ORANGE: 'OR',
  SILVER: 'SV',
};

/**
 * Derive the legacy WMATA station code from a GTFS stop_id.
 *   STN_A15        → "A15"
 *   STN_A01_C01    → "A01"  (merged transfer-station IDs — take the primary code only)
 *   PF_A15_C       → "A15"
 *   anything else  → ""
 */
function deriveWmataCode(stopId) {
  if (stopId.startsWith('STN_')) {
    const suffix = stopId.slice(4);    // e.g. "A15" or "A01_C01"
    return suffix.split('_')[0];       // always the primary code
  }
  if (stopId.startsWith('PF_')) {
    const inner = stopId.slice(3);     // "A15_C"
    return inner.split('_')[0];        // "A15"
  }
  return '';
}

/**
 * Validate that the newly-loaded feed has enough data before activating it.
 * Throws if any check fails — the version stays in 'loading' status.
 *
 * @param {mongoose.Types.ObjectId} versionId
 * @param {object} [opts]
 * @param {string} [opts.mode]            'rail' or 'bus'
 * @param {number} [opts.minStations=95]  minimum number of distinct station codes required (rail only)
 * @param {number} [opts.minRoutes=100]   minimum bus routes (bus only); default 100
 * @param {number} [opts.minStopTimeCount=600000]  minimum bus stop_times (bus only); default 600000
 */
async function validateBeforeActivation(versionId, opts = {}) {
  const mode = opts.mode || 'rail';

  if (mode === 'bus') {
    const minRoutes        = opts.minRoutes        ?? 100;
    const minStopTimeCount = opts.minStopTimeCount ?? 600_000;
    const [routeCount, stopTimeCount, serviceIds, tripCount] = await Promise.all([
      GtfsRoute.countDocuments({ version: versionId }),
      GtfsStopTime.countDocuments({ version: versionId }),
      GtfsCalendarDate.distinct('serviceId', { version: versionId, exceptionType: 1 }),
      GtfsTrip.countDocuments({ version: versionId }),
    ]);
    const errors = [];
    if (routeCount < minRoutes)             errors.push(`only ${routeCount} routes (threshold: ${minRoutes})`);
    if (stopTimeCount < minStopTimeCount)   errors.push(`only ${stopTimeCount} stop_times (threshold: ${minStopTimeCount})`);
    if (serviceIds.length === 0)            errors.push('no active service IDs');
    if (tripCount === 0)                    errors.push('no trips');
    if (opts.feedDate && opts.feedEndDate) {
      const today = DateTime.now().setZone('America/New_York').toFormat('yyyyMMdd');
      if (today < opts.feedDate)     errors.push(`feed starts in the future (feedDate=${opts.feedDate})`);
      if (today > opts.feedEndDate)  errors.push(`feed has expired (feedEndDate=${opts.feedEndDate})`);
    }
    if (errors.length) throw new Error(`[gtfs-static] Bus validation failed: ${errors.join(', ')}`);
    return;
  }

  // Rail validation
  const minStations = opts.minStations ?? 95;
  const [routeCount, stopTimeCount, serviceIds, stationCodes] = await Promise.all([
    GtfsRoute.countDocuments({ version: versionId }),
    GtfsStopTime.countDocuments({ version: versionId }),
    GtfsCalendarDate.distinct('serviceId', { version: versionId, exceptionType: 1 }),
    GtfsStop.distinct('wmataCode', { version: versionId, locationType: 1, wmataCode: { $ne: '' } }),
  ]);
  const errors = [];
  if (routeCount === 0)                    errors.push('no routes');
  if (stopTimeCount === 0)                 errors.push('no stop_times');
  if (serviceIds.length === 0)             errors.push('no active service IDs');
  if (stationCodes.length < minStations)   errors.push(`only ${stationCodes.length} stations mapped (threshold: ${minStations})`);
  if (errors.length) throw new Error(`[gtfs-static] Validation failed: ${errors.join(', ')}`);
}

/** Insert docs in batches of BATCH_SIZE. */
async function batchInsert(Model, docs) {
  for (let i = 0; i < docs.length; i += BATCH_SIZE) {
    await Model.insertMany(docs.slice(i, i + BATCH_SIZE), { ordered: false });
  }
}

/**
 * Parse all rows from a file entry in an unzipper directory.
 *
 * @param {object} fileEntry  from unzipper.Open.buffer() dir.files
 * @returns {Promise<object[]>}
 */
function parseFile(fileEntry) {
  return new Promise((resolve, reject) => {
    const rows = [];
    fileEntry.stream()
      .pipe(csvParse({ columns: true, skip_empty_lines: true, trim: true }))
      .on('data', r => rows.push(r))
      .on('end', () => resolve(rows))
      .on('error', reject);
  });
}

/**
 * Delete previous-status versions that are no longer needed (scoped by mode):
 *   - Any version older than 36 hours
 *   - Any version older than 1 hour that has never matched a live trip (lastMatchAt === null)
 *   - Surplus versions beyond the newest one (keeps at most 1 previous)
 *
 * @param {string} [mode='rail']
 */
async function cleanupPreviousVersions(mode = 'rail') {
  const prevVersions = await GtfsVersion.find({ status: 'previous', mode }).sort({ previousSince: -1 });
  if (!prevVersions.length) return;

  const now = Date.now();
  const h36 = 36 * 60 * 60 * 1000;
  const h1  =  1 * 60 * 60 * 1000;

  // Keep at most 1 previous version (newest by previousSince); delete extras first
  for (let i = 1; i < prevVersions.length; i++) {
    const v = prevVersions[i];
    console.log(`[gtfs-static] Cleaning up surplus previous ${mode} version ${v._id}`);
    await deleteVersionData(v._id);
    await GtfsVersion.deleteOne({ _id: v._id });
  }

  // Check the remaining single previous version for time-based cleanup
  const v = prevVersions[0];
  const sinceMs = now - (v.previousSince?.getTime() ?? now);
  const neverMatched = v.lastMatchAt === null;

  if (sinceMs > h36) {
    console.log(`[gtfs-static] Cleaning up previous ${mode} version ${v._id} (age=${Math.round(sinceMs / 3600000)}h > 36h)`);
    await deleteVersionData(v._id);
    await GtfsVersion.deleteOne({ _id: v._id });
  } else if (sinceMs > h1 && neverMatched) {
    console.log(`[gtfs-static] Cleaning up previous ${mode} version ${v._id} (age=${Math.round(sinceMs / 3600000)}h, never matched)`);
    await deleteVersionData(v._id);
    await GtfsVersion.deleteOne({ _id: v._id });
  }
}

/**
 * Main entry point: download WMATA GTFS static, load into MongoDB.
 * Performs a versioned swap so readers always see consistent data.
 * Safe to call on startup and daily — skips if feed hash is unchanged.
 *
 * @param {object} [opts]
 * @param {string} [opts.mode]        'rail' (default) or 'bus'
 * @param {string} [opts.apiKey]      WMATA API key (defaults to process.env.WMATA_API_KEY)
 * @param {Buffer} [opts.zipBuffer]   pre-loaded zip bytes (for testing)
 * @param {boolean} [opts.force]      bypass hash-based skip; always reload
 * @param {number}  [opts.minStations] minimum station codes for validation (rail default 95)
 * @returns {Promise<{skipped?: boolean, newVersionId?: string}>}
 */
async function loadGtfsStatic(opts = {}) {
  const mode   = opts.mode || 'rail';
  const apiKey = opts.apiKey || process.env.WMATA_API_KEY;
  const feedUrl = FEED_URLS[mode];

  // --- Step 1: Get zip bytes ---
  let buf;
  if (opts.zipBuffer) {
    buf = opts.zipBuffer;
  } else {
    console.log(`[gtfs-static] Downloading ${mode}-gtfs-static.zip…`);
    const resp = await axios.get(feedUrl, {
      headers: { api_key: apiKey },
      responseType: 'arraybuffer',
      timeout: 60000,
    });
    buf = Buffer.from(resp.data);
    console.log(`[gtfs-static] Downloaded ${(buf.length / 1024 / 1024).toFixed(1)} MB`);
  }

  // --- Step 2: Hash check (skip if unchanged, unless force=true) ---
  const feedHash = crypto.createHash('sha256').update(buf).digest('hex');
  if (!opts.force) {
    const existing = await GtfsVersion.findOne({ feedHash, status: 'active', mode });
    if (existing) {
      console.log(`[gtfs-static] ${mode} feed unchanged — skipping reload`);
      return { skipped: true };
    }
  }

  // Clean up expired previous versions before starting a new load
  await cleanupPreviousVersions(mode);

  // Clean up any orphaned 'loading' versions from previous crashed runs
  const orphans = await GtfsVersion.find({ status: 'loading', mode });
  for (const orphan of orphans) {
    console.log(`[gtfs-static] Cleaning up orphaned loading ${mode} version ${orphan._id}`);
    await deleteVersionData(orphan._id);
    await GtfsVersion.deleteOne({ _id: orphan._id });
  }

  // --- Step 3: Insert new version doc ---
  const loadStartMs = Date.now();
  const dir = await unzipper.Open.buffer(buf);
  const feedInfoFile = dir.files.find(f => f.path === 'feed_info.txt');
  let feedDate = '';
  let feedEndDate = '';
  let feedVersionStr = '';
  let agencyTz = 'America/New_York';
  if (feedInfoFile) {
    const [info] = await parseFile(feedInfoFile);
    feedDate = info?.feed_start_date || '';
    feedEndDate = info?.feed_end_date || '';
    feedVersionStr = info?.feed_version || '';
  }
  const agencyFile = dir.files.find(f => f.path === 'agency.txt');
  if (agencyFile) {
    const [agency] = await parseFile(agencyFile);
    agencyTz = agency?.agency_timezone || 'America/New_York';
  }

  const versionDoc = await GtfsVersion.create({
    feedHash, feedDate, agencyTz, mode, status: 'loading', loadedAt: new Date(),
  });
  const versionId = versionDoc._id;
  console.log(`[gtfs-static] New ${mode} version ${versionId} (feedDate=${feedDate})`);

  try {
    // --- Step 4: Parse and insert each file ---
    await loadRoutes(dir, versionId, mode);
    await loadStops(dir, versionId, mode);
    await loadCalendarDates(dir, versionId);
    await loadTrips(dir, versionId);
    if (mode === 'bus') {
      await loadBusStopTimes(dir, versionId);
    } else {
      await loadStopTimes(dir, versionId);
    }

    // --- Step 5: Validate and compute meta (before activation) ---
    await validateBeforeActivation(versionId, {
      mode,
      minStations:      opts.minStations,
      minRoutes:        opts.minRoutes,
      minStopTimeCount: opts.minStopTimeCount,
      feedDate,
      feedEndDate,
    });
    await computeAndStoreMeta(versionId, feedVersionStr, mode);

    // --- Step 6: Activate new version ---
    await GtfsVersion.updateOne({ _id: versionId }, { $set: { status: 'active' } });
    const durationSec = Math.round((Date.now() - loadStartMs) / 1000);
    const peakRssMB = Math.round(process.memoryUsage().rss / 1024 / 1024);
    console.log(`[gtfs-static] ${mode} load complete in ${durationSec}s, peak RSS ${peakRssMB} MB`);
    console.log(`[gtfs-static] ${mode} version ${versionId} is now active`);

    // --- Step 6b: Demote old active version to 'previous' (keep data for in-flight RT trips) ---
    const oldActive = await GtfsVersion.findOne({ status: 'active', mode, _id: { $ne: versionId } });
    if (oldActive) {
      await GtfsVersion.updateOne({ _id: oldActive._id }, {
        $set: { status: 'previous', previousSince: new Date(), lastMatchAt: null },
      });
      console.log(`[gtfs-static] ${mode} version ${oldActive._id} demoted to previous`);
    }

    return { newVersionId: versionId.toString() };
  } catch (err) {
    // Leave as 'loading' so next startup cleans it up
    console.error(`[gtfs-static] ${mode} load failed:`, err.message);
    throw err;
  }
}

async function loadRoutes(dir, versionId, mode = 'rail') {
  const file = dir.files.find(f => f.path === 'routes.txt');
  if (!file) return;
  const rows = await parseFile(file);
  const docs = rows.map(r => ({
    version: versionId,
    routeId: r.route_id,
    // For bus: lineCode = route_id (= route_short_name, e.g. "A11"); for rail: mapped via ROUTE_TO_LINE
    lineCode: mode === 'bus' ? r.route_id : (ROUTE_TO_LINE[r.route_id] || r.route_id),
    longName: r.route_long_name || '',
  }));
  await batchInsert(GtfsRoute, docs);
  console.log(`[gtfs-static] Inserted ${docs.length} ${mode} routes`);
}

async function loadStops(dir, versionId, mode = 'rail') {
  const file = dir.files.find(f => f.path === 'stops.txt');
  if (!file) return;
  const rows = await parseFile(file);
  const docs = rows.map(r => ({
    version: versionId,
    stopId: r.stop_id,
    stopName: r.stop_name || '',
    lat: parseFloat(r.stop_lat) || 0,
    lon: parseFloat(r.stop_lon) || 0,
    locationType: parseInt(r.location_type, 10) || 0,
    parentStation: r.parent_station || '',
    // For bus: wmataCode from stop_code field; for rail: derived from stop_id pattern
    wmataCode: mode === 'bus' ? (r.stop_code || '') : deriveWmataCode(r.stop_id),
  }));
  await batchInsert(GtfsStop, docs);
  console.log(`[gtfs-static] Inserted ${docs.length} ${mode} stops`);
}

async function loadCalendarDates(dir, versionId) {
  const file = dir.files.find(f => f.path === 'calendar_dates.txt');
  if (!file) return;
  const rows = await parseFile(file);
  const docs = rows.map(r => ({
    version: versionId,
    serviceId: r.service_id,
    date: r.date,
    exceptionType: parseInt(r.exception_type, 10),
  }));
  await batchInsert(GtfsCalendarDate, docs);
  console.log(`[gtfs-static] Inserted ${docs.length} calendar_dates`);
}

async function loadTrips(dir, versionId) {
  const file = dir.files.find(f => f.path === 'trips.txt');
  if (!file) return;
  const rows = await parseFile(file);
  const docs = rows.map(r => ({
    version: versionId,
    tripId: r.trip_id,
    routeId: r.route_id,
    serviceId: r.service_id,
    directionId: parseInt(r.direction_id, 10) || 0,
    tripHeadsign: r.trip_headsign || '',
    shapeId: r.shape_id || '',
  }));
  await batchInsert(GtfsTrip, docs);
  console.log(`[gtfs-static] Inserted ${docs.length} trips`);
}

async function loadStopTimes(dir, versionId) {
  const file = dir.files.find(f => f.path === 'stop_times.txt');
  if (!file) return;
  await streamInsertStopTimes(file, versionId, 'stop_times.txt');
}

/** Load bus stop times from timepoint_times.txt (pre-filtered to timepoints, ~8× smaller). */
async function loadBusStopTimes(dir, versionId) {
  const file = dir.files.find(f => f.path === 'timepoint_times.txt');
  if (!file) {
    console.warn('[gtfs-static] timepoint_times.txt not found — falling back to stop_times.txt');
    return loadStopTimes(dir, versionId);
  }
  await streamInsertStopTimes(file, versionId, 'timepoint_times.txt');
}

/**
 * Stream-parse a stop_times-like CSV and batch-insert into GtfsStopTime.
 * Both stop_times.txt and timepoint_times.txt share the same column names.
 */
async function streamInsertStopTimes(file, versionId, label) {
  await new Promise((resolve, reject) => {
    const batch = [];

    const flush = async () => {
      if (batch.length === 0) return;
      const toInsert = batch.splice(0);
      await GtfsStopTime.insertMany(toInsert, { ordered: false });
    };

    let pendingFlush = Promise.resolve();
    let count = 0;

    const parser = csvParse({ columns: true, skip_empty_lines: true, trim: true });
    parser.on('data', row => {
      batch.push({
        version: versionId,
        tripId: row.trip_id,
        stopId: row.stop_id,
        stopSequence: parseInt(row.stop_sequence, 10),
        arrivalSec: parseGtfsTime(row.arrival_time),
        departureSec: parseGtfsTime(row.departure_time),
      });
      count++;
      if (batch.length >= BATCH_SIZE) {
        parser.pause();
        const toInsert = batch.splice(0);
        pendingFlush = pendingFlush
          .then(() => GtfsStopTime.insertMany(toInsert, { ordered: false }))
          .then(() => parser.resume())
          .catch(reject);
      }
    });

    parser.on('end', () => {
      pendingFlush
        .then(() => {
          if (batch.length > 0) {
            return GtfsStopTime.insertMany(batch, { ordered: false });
          }
        })
        .then(() => {
          console.log(`[gtfs-static] Inserted ${count} stop_times (from ${label})`);
          resolve();
        })
        .catch(reject);
    });

    parser.on('error', reject);
    file.stream().pipe(parser);
  });
}

/** Compute feed summary stats and persist them to the GtfsVersion meta subdoc. */
async function computeAndStoreMeta(versionId, feedVersionStr, mode = 'rail') {
  const queries = [
    GtfsRoute.countDocuments({ version: versionId }),
    GtfsStopTime.countDocuments({ version: versionId }),
    GtfsCalendarDate.distinct('serviceId', { version: versionId, exceptionType: 1 }),
    GtfsCalendarDate.aggregate([
      { $match: { version: versionId, exceptionType: 1 } },
      { $group: { _id: null, start: { $min: '$date' }, end: { $max: '$date' } } },
    ]),
  ];

  // Rail-only: count distinct mapped station codes
  if (mode === 'rail') {
    queries.push(GtfsStop.distinct('wmataCode', { version: versionId, locationType: 1, wmataCode: { $ne: '' } }));
  }

  const results = await Promise.all(queries);
  const [routeCount, stopTimeCount, serviceIds, dateAgg] = results;
  const stationCodes = mode === 'rail' ? results[4] : [];

  const dateRange = dateAgg[0] || { start: '', end: '' };

  await GtfsVersion.updateOne({ _id: versionId }, {
    $set: {
      'meta.computedAt':             new Date(),
      'meta.feedVersion':            feedVersionStr || '',
      'meta.routeCount':             routeCount,
      'meta.stopTimeCount':          stopTimeCount,
      'meta.frequencyCount':         0,
      'meta.serviceIdCount':         serviceIds.length,
      'meta.stationsMappedCount':    stationCodes.length,
      'meta.serviceDateRange.start': dateRange.start,
      'meta.serviceDateRange.end':   dateRange.end,
    },
  });
  console.log(`[gtfs-static] Meta computed: ${routeCount} routes, ${stopTimeCount} stop_times, ${serviceIds.length} serviceIds`);
}

/** Delete all GTFS data for a version (largest collection first). */
async function deleteVersionData(versionId) {
  await GtfsStopTime.deleteMany({ version: versionId });
  await GtfsTrip.deleteMany({ version: versionId });
  await GtfsStop.deleteMany({ version: versionId });
  await GtfsCalendarDate.deleteMany({ version: versionId });
  await GtfsRoute.deleteMany({ version: versionId });
}

module.exports = { loadGtfsStatic, deriveWmataCode, ROUTE_TO_LINE, computeAndStoreMeta, cleanupPreviousVersions };
