'use strict';

const crypto = require('crypto');
const axios = require('axios');
const unzipper = require('unzipper');
const { parse: csvParse } = require('csv-parse');
const { parseGtfsTime } = require('./timeUtils');

const GtfsVersion = require('../../models/GtfsVersion');
const GtfsRoute = require('../../models/GtfsRoute');
const GtfsStop = require('../../models/GtfsStop');
const GtfsCalendarDate = require('../../models/GtfsCalendarDate');
const GtfsTrip = require('../../models/GtfsTrip');
const GtfsStopTime = require('../../models/GtfsStopTime');

const WMATA_GTFS_URL = 'https://api.wmata.com/gtfs/rail-gtfs-static.zip';
const BATCH_SIZE = 500;

// Maps GTFS full route names → 2-letter WMATA line codes
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
 * @param {number} [opts.minStations=95]  minimum number of distinct station codes required
 */
async function validateBeforeActivation(versionId, opts = {}) {
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
 * Main entry point: download WMATA rail GTFS static, load into MongoDB.
 * Performs a versioned swap so readers always see consistent data.
 * Safe to call on startup and daily — skips if feed hash is unchanged.
 *
 * @param {object} [opts]
 * @param {string} [opts.apiKey]      WMATA API key (defaults to process.env.WMATA_API_KEY)
 * @param {Buffer} [opts.zipBuffer]   pre-loaded zip bytes (for testing)
 * @param {boolean} [opts.force]      bypass hash-based skip; always reload
 * @param {number}  [opts.minStations] minimum station codes for validation (default 95)
 * @returns {Promise<{skipped?: boolean, newVersionId?: string}>}
 */
async function loadGtfsStatic(opts = {}) {
  const apiKey = opts.apiKey || process.env.WMATA_API_KEY;

  // --- Step 1: Get zip bytes ---
  let buf;
  if (opts.zipBuffer) {
    buf = opts.zipBuffer;
  } else {
    console.log('[gtfs-static] Downloading rail-gtfs-static.zip…');
    const resp = await axios.get(WMATA_GTFS_URL, {
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
    const existing = await GtfsVersion.findOne({ feedHash, status: 'active' });
    if (existing) {
      console.log('[gtfs-static] Feed unchanged — skipping reload');
      return { skipped: true };
    }
  }

  // Clean up any orphaned 'loading' versions from previous crashed runs
  const orphans = await GtfsVersion.find({ status: 'loading' });
  for (const orphan of orphans) {
    console.log(`[gtfs-static] Cleaning up orphaned loading version ${orphan._id}`);
    await deleteVersionData(orphan._id);
    await GtfsVersion.deleteOne({ _id: orphan._id });
  }

  // --- Step 3: Insert new version doc ---
  const dir = await unzipper.Open.buffer(buf);
  const feedInfoFile = dir.files.find(f => f.path === 'feed_info.txt');
  let feedDate = '';
  let feedVersionStr = '';
  let agencyTz = 'America/New_York';
  if (feedInfoFile) {
    const [info] = await parseFile(feedInfoFile);
    feedDate = info?.feed_start_date || '';
    feedVersionStr = info?.feed_version || '';
  }
  const agencyFile = dir.files.find(f => f.path === 'agency.txt');
  if (agencyFile) {
    const [agency] = await parseFile(agencyFile);
    agencyTz = agency?.agency_timezone || 'America/New_York';
  }

  const versionDoc = await GtfsVersion.create({
    feedHash, feedDate, agencyTz, status: 'loading', loadedAt: new Date(),
  });
  const versionId = versionDoc._id;
  console.log(`[gtfs-static] New version ${versionId} (feedDate=${feedDate})`);

  try {
    // --- Step 4: Parse and insert each file ---
    await loadRoutes(dir, versionId);
    await loadStops(dir, versionId);
    await loadCalendarDates(dir, versionId);
    await loadTrips(dir, versionId);
    await loadStopTimes(dir, versionId);

    // --- Step 5: Validate and compute meta (before activation) ---
    await validateBeforeActivation(versionId, { minStations: opts.minStations });
    await computeAndStoreMeta(versionId, feedVersionStr);

    // --- Step 6: Activate new version ---
    await GtfsVersion.updateOne({ _id: versionId }, { $set: { status: 'active' } });
    console.log(`[gtfs-static] Version ${versionId} is now active`);

    // --- Step 6: Mark old active version stale and delete its data ---
    const oldVersion = await GtfsVersion.findOne({
      status: 'active', _id: { $ne: versionId },
    });
    if (oldVersion) {
      await GtfsVersion.updateOne({ _id: oldVersion._id }, { $set: { status: 'stale' } });
      await deleteVersionData(oldVersion._id);
      await GtfsVersion.deleteOne({ _id: oldVersion._id });
      console.log(`[gtfs-static] Deleted stale version ${oldVersion._id}`);
    }

    return { newVersionId: versionId.toString() };
  } catch (err) {
    // Leave as 'loading' so next startup cleans it up
    console.error('[gtfs-static] Load failed:', err.message);
    throw err;
  }
}

async function loadRoutes(dir, versionId) {
  const file = dir.files.find(f => f.path === 'routes.txt');
  if (!file) return;
  const rows = await parseFile(file);
  const docs = rows.map(r => ({
    version: versionId,
    routeId: r.route_id,
    lineCode: ROUTE_TO_LINE[r.route_id] || r.route_id,
    longName: r.route_long_name || '',
  }));
  await batchInsert(GtfsRoute, docs);
  console.log(`[gtfs-static] Inserted ${docs.length} routes`);
}

async function loadStops(dir, versionId) {
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
    wmataCode: deriveWmataCode(r.stop_id),
  }));
  await batchInsert(GtfsStop, docs);
  console.log(`[gtfs-static] Inserted ${docs.length} stops`);
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

  // Stream-parse to avoid holding all 244K rows in memory at once
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
          console.log(`[gtfs-static] Inserted ${count} stop_times`);
          resolve();
        })
        .catch(reject);
    });

    parser.on('error', reject);
    file.stream().pipe(parser);
  });
}

/** Compute feed summary stats and persist them to the GtfsVersion meta subdoc. */
async function computeAndStoreMeta(versionId, feedVersionStr) {
  const [routeCount, stopTimeCount, serviceIds, stationCodes, dateAgg] = await Promise.all([
    GtfsRoute.countDocuments({ version: versionId }),
    GtfsStopTime.countDocuments({ version: versionId }),
    GtfsCalendarDate.distinct('serviceId', { version: versionId, exceptionType: 1 }),
    GtfsStop.distinct('wmataCode', { version: versionId, locationType: 1, wmataCode: { $ne: '' } }),
    GtfsCalendarDate.aggregate([
      { $match: { version: versionId, exceptionType: 1 } },
      { $group: { _id: null, start: { $min: '$date' }, end: { $max: '$date' } } },
    ]),
  ]);

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

module.exports = { loadGtfsStatic, deriveWmataCode, ROUTE_TO_LINE, computeAndStoreMeta };
