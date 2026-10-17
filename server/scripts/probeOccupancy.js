'use strict';

/**
 * probeOccupancy.js — one-shot GTFS-RT occupancy feed probe
 *
 * Usage:
 *   node server/scripts/probeOccupancy.js [rail|bus|<api-path>]
 *
 * Shortcuts:
 *   rail  → /gtfs/rail-gtfsrt-vehiclepositions.pb
 *   bus   → /gtfs/bus-gtfsrt-vehiclepositions.pb
 *   <any> → used as the literal API path
 *
 * Loads server/.env via dotenv. Requires WMATA_API_KEY.
 */

const path = require('path');
require('dotenv').config({ path: path.join(__dirname, '..', '.env') });

const { decodeVehiclePositions } = require('../src/lib/gtfsRt');

const OCCUPANCY_NAMES = {
  0: 'EMPTY',
  1: 'MANY_SEATS',
  2: 'FEW_SEATS',
  3: 'STANDING_ROOM_ONLY',
  4: 'CRUSHED_STANDING',
  5: 'FULL',
  6: 'NOT_ACCEPTING',
  7: 'NO_DATA',
  8: 'NOT_BOARDABLE',
};

const SHORTCUTS = {
  rail: '/gtfs/rail-gtfsrt-vehiclepositions.pb',
  bus:  '/gtfs/bus-gtfsrt-vehiclepositions.pb',
};

async function main() {
  const arg = process.argv[2] || 'bus';
  const apiPath = SHORTCUTS[arg] ?? arg;

  const apiKey = process.env.WMATA_API_KEY;
  if (!apiKey) {
    console.error('ERROR: WMATA_API_KEY not set in server/.env');
    process.exit(1);
  }

  const baseUrl = process.env.WMATA_BASE_URL || 'https://api.wmata.com';
  const url = `${baseUrl}${apiPath}`;

  console.log(`Probing: ${url}`);

  let buf;
  try {
    // Use native fetch (Node 18+) to avoid pulling in axios at script level
    const res = await fetch(url, {
      headers: { 'api_key': apiKey },
    });
    if (!res.ok) {
      console.error(`HTTP ${res.status} ${res.statusText}`);
      process.exit(1);
    }
    buf = Buffer.from(await res.arrayBuffer());
  } catch (err) {
    console.error('Fetch failed:', err.message);
    process.exit(1);
  }

  const { feedTimestamp, vehicles } = decodeVehiclePositions(buf);

  console.log(`\nFeed timestamp : ${feedTimestamp.toISOString()}`);
  console.log(`Total vehicles : ${vehicles.length}`);

  // Build histogram
  const hist = {};
  for (const v of vehicles) {
    const key = v.occupancyStatus ?? 'null';
    hist[key] = (hist[key] || 0) + 1;
  }

  console.log('\nOccupancy status histogram:');
  for (const [key, count] of Object.entries(hist).sort((a, b) => Number(a[0]) - Number(b[0]))) {
    const name = OCCUPANCY_NAMES[key] ?? `STATUS_${key}`;
    const pct = ((count / vehicles.length) * 100).toFixed(1);
    console.log(`  ${String(key).padStart(4)}  ${name.padEnd(22)}  ${String(count).padStart(5)}  (${pct}%)`);
  }

  // Useful = status 1–6 (excludes EMPTY=0, NO_DATA=7, NOT_BOARDABLE=8, null)
  const usefulCount = vehicles.filter(v =>
    v.occupancyStatus != null && v.occupancyStatus >= 1 && v.occupancyStatus <= 6
  ).length;
  const usefulPct = vehicles.length > 0
    ? ((usefulCount / vehicles.length) * 100).toFixed(1)
    : '0.0';

  console.log(`\nUseful occupancy (status 1–6): ${usefulCount} / ${vehicles.length} (${usefulPct}%)`);

  if (usefulCount > 0) {
    console.log('\nVerdict: DATA AVAILABLE — occupancy enrichment will work.');
  } else {
    console.log('\nVerdict: DATA UNAVAILABLE — all vehicles report no occupancy data.');
    console.log('         Bus crowding will show as null until WMATA populates the field.');
  }
}

main().catch(err => {
  console.error(err);
  process.exit(1);
});
