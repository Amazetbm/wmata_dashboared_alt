'use strict';

const { wmataClient } = require('../middleware/wmata');

// ── StandardRoutes cache (10-minute TTL) ─────────────────────────────────────
let cachedRoutes   = null;
let routesCachedAt = 0;
const ROUTES_TTL_MS = 10 * 60 * 1000;

async function getStandardRoutes(force = false) {
  if (!force && cachedRoutes && (Date.now() - routesCachedAt) < ROUTES_TTL_MS) {
    return cachedRoutes;
  }
  const { data } = await wmataClient.get('/TrainPositions/StandardRoutes?contentType=json');
  cachedRoutes   = data.StandardRoutes ?? [];
  routesCachedAt = Date.now();
  console.log(`[railGeometry] StandardRoutes (re)cached — ${cachedRoutes.length} routes`);
  return cachedRoutes;
}

function getCachedRoutes() {
  return cachedRoutes ?? [];
}

// ── Stations cache (60-minute TTL) ───────────────────────────────────────────
let cachedStations   = null;
let stationsCachedAt = 0;
const STATIONS_TTL_MS = 60 * 60 * 1000;

/**
 * Returns a Map<stationCode, {Name, Lat, Lon}>.
 * jStations uses the field name "Code" as the key.
 */
async function getStations() {
  if (cachedStations && (Date.now() - stationsCachedAt) < STATIONS_TTL_MS) {
    return cachedStations;
  }
  const { data } = await wmataClient.get('/Rail.svc/json/jStations');
  const stations = data.Stations ?? [];
  cachedStations = new Map(
    stations
      .filter(s => s.Code)
      .map(s => [s.Code, { Name: s.Name, Lat: s.Lat, Lon: s.Lon }])
  );
  stationsCachedAt = Date.now();
  return cachedStations;
}

// ── buildRouteMaps ────────────────────────────────────────────────────────────
/**
 * Build circuit-id → seqNum lookup per line+track.
 * Returns { circuitMap, routeLen }.
 */
function buildRouteMaps(standardRoutes) {
  const circuitMap = {};  // lineCode -> trackNum -> Map<circuitId, seqNum>
  const routeLen = {};    // lineCode -> trackNum -> total circuits

  for (const route of standardRoutes) {
    const { LineCode, TrackNum, TrackCircuits } = route;
    if (!LineCode || !TrackNum || !Array.isArray(TrackCircuits)) continue;

    if (!circuitMap[LineCode]) { circuitMap[LineCode] = {}; routeLen[LineCode] = {}; }

    const m = new Map();
    for (const tc of TrackCircuits) m.set(tc.CircuitId, tc.SeqNum);
    circuitMap[LineCode][TrackNum] = m;
    routeLen[LineCode][TrackNum] = TrackCircuits.length;
  }
  return { circuitMap, routeLen };
}

// ── buildCircuitPositionMap ───────────────────────────────────────────────────
/**
 * Builds a CircuitId → {lat, lon} lookup by linearly interpolating between
 * consecutive station-anchored circuits in each StandardRoute track segment.
 *
 * stationMap: plain object keyed by StationCode (jStations "Code" field),
 * values must have {Lat, Lon}.
 *
 * Circuits before the first station terminus or after the last are omitted
 * (they are in yards).
 */
function buildCircuitPositionMap(standardRoutes, stationMap) {
  const circuitPos = new Map();

  for (const route of standardRoutes) {
    const circuits = [...route.TrackCircuits].sort((a, b) => a.SeqNum - b.SeqNum);

    let prevIdx     = -1;
    let prevStation = null;

    for (let i = 0; i < circuits.length; i++) {
      const tc = circuits[i];
      if (!tc.StationCode) continue;

      const station = stationMap[tc.StationCode];
      if (!station) continue;

      if (prevStation !== null) {
        const segLen = i - prevIdx;
        for (let j = prevIdx; j <= i; j++) {
          const frac = segLen === 0 ? 0 : (j - prevIdx) / segLen;
          circuitPos.set(circuits[j].CircuitId, {
            lat: prevStation.Lat + frac * (station.Lat - prevStation.Lat),
            lon: prevStation.Lon + frac * (station.Lon - prevStation.Lon),
          });
        }
      } else {
        // First station in the route — anchor just its own circuit.
        circuitPos.set(tc.CircuitId, { lat: station.Lat, lon: station.Lon });
      }

      prevIdx     = i;
      prevStation = station;
    }
  }

  return circuitPos;
}

// ── buildCircuitStationBracketMap ─────────────────────────────────────────────
/**
 * Builds a circuitId → location descriptor lookup.
 *
 * stationsMap: Map<Code, {Name, Lat, Lon}> — from getStations().
 *
 * Each entry is one of:
 *   { atStation: { code, name } }
 *   { prevStation: { code, name }, nextStation: { code, name } }
 *   { yard: true }
 *
 * Returns a plain Object keyed by CircuitId (numbers as keys are fine in JS objects).
 */
function buildCircuitStationBracketMap(standardRoutes, stationsMap) {
  const result = {};

  for (const route of standardRoutes) {
    if (!Array.isArray(route.TrackCircuits)) continue;
    const circuits = [...route.TrackCircuits].sort((a, b) => a.SeqNum - b.SeqNum);

    // Build sorted list of indices that have a known station code
    const stationIdxs = [];
    for (let i = 0; i < circuits.length; i++) {
      if (circuits[i].StationCode && stationsMap.has(circuits[i].StationCode)) {
        stationIdxs.push(i);
      }
    }

    for (let i = 0; i < circuits.length; i++) {
      const tc = circuits[i];
      const id = tc.CircuitId;

      if (tc.StationCode && stationsMap.has(tc.StationCode)) {
        const s = stationsMap.get(tc.StationCode);
        result[id] = { atStation: { code: tc.StationCode, name: s.Name } };
      } else {
        // Find the nearest bounding station indices on each side
        let prevSI = -1;
        let nextSI = -1;
        for (const si of stationIdxs) {
          if (si < i) prevSI = si;
          else if (si > i) { nextSI = si; break; }
        }

        if (prevSI === -1 || nextSI === -1) {
          result[id] = { yard: true };
        } else {
          const prevTc = circuits[prevSI];
          const nextTc = circuits[nextSI];
          const prevSt = stationsMap.get(prevTc.StationCode);
          const nextSt = stationsMap.get(nextTc.StationCode);
          result[id] = {
            prevStation: { code: prevTc.StationCode, name: prevSt.Name },
            nextStation: { code: nextTc.StationCode, name: nextSt.Name },
          };
        }
      }
    }
  }

  return result;
}

// ── describeLocation ──────────────────────────────────────────────────────────
/**
 * Converts a bracketMap entry into a human-readable location string.
 */
function describeLocation(entry) {
  if (!entry) return 'unknown';
  if (entry.atStation)   return `at ${entry.atStation.name} (${entry.atStation.code})`;
  if (entry.prevStation) return `between ${entry.prevStation.name} (${entry.prevStation.code}) and ${entry.nextStation.name} (${entry.nextStation.code})`;
  if (entry.yard)        return 'in yard';
  return 'unknown';
}

module.exports = {
  getStandardRoutes,
  getCachedRoutes,
  getStations,
  buildRouteMaps,
  buildCircuitPositionMap,
  buildCircuitStationBracketMap,
  describeLocation,
};
