const router = require('express').Router();
const { wmataClient } = require('../middleware/wmata');

// ── StandardRoutes cache (15-minute TTL) ──────────────────────────────────
// StandardRoutes rarely change; caching avoids a WMATA API call on every
// 30-second Angular poll. The cache is auto-busted when 0 trains resolve
// despite active candidates, which indicates stale circuit ID data.
let cachedRoutes   = null;
let routesCachedAt = 0;
const ROUTES_TTL_MS = 15 * 60 * 1000;

async function getStandardRoutes(force = false) {
  if (!force && cachedRoutes && (Date.now() - routesCachedAt) < ROUTES_TTL_MS) {
    return cachedRoutes;
  }
  const { data } = await wmataClient.get('/TrainPositions/StandardRoutes?contentType=json');
  cachedRoutes   = data.StandardRoutes ?? [];
  routesCachedAt = Date.now();
  console.log(`[/api/map] StandardRoutes (re)cached — ${cachedRoutes.length} routes at ${new Date(routesCachedAt).toISOString()}`);
  return cachedRoutes;
}

/**
 * Builds a CircuitId → {lat, lon} lookup by linearly interpolating between
 * consecutive station-anchored circuits in each StandardRoute track segment.
 *
 * For each pair of adjacent station circuits (seqA … seqB), every circuit
 * between them receives a proportional lat/lon. Trains on circuits before the
 * first station terminus or after the last are omitted (they're in yards).
 *
 * NOTE: jStations uses the field name "Code" (not "StationCode"), so callers
 * must build stationMap with s.Code as the key — see usage below.
 */
function buildCircuitPositionMap(standardRoutes, stationMap) {
  const circuitPos = new Map();

  for (const route of standardRoutes) {
    // Sort ascending by SeqNum; the API usually delivers them in order but sort defensively.
    const circuits = [...route.TrackCircuits].sort((a, b) => a.SeqNum - b.SeqNum);

    let prevIdx = -1;
    let prevStation = null;

    for (let i = 0; i < circuits.length; i++) {
      const tc = circuits[i];
      if (!tc.StationCode) continue;

      const station = stationMap[tc.StationCode];
      if (!station) continue; // unknown code — skip

      if (prevStation !== null) {
        // Interpolate every circuit in the segment [prevIdx .. i] inclusive.
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

      prevIdx = i;
      prevStation = station;
    }
  }

  return circuitPos;
}

router.get('/', async (req, res) => {
  console.log('[/api/map] --- fetch cycle start ---');

  try {
    const [trainsRes, stationsRes, incidentsRes] = await Promise.allSettled([
      wmataClient.get('/TrainPositions/TrainPositions?contentType=json'),
      wmataClient.get('/Rail.svc/json/jStations'),
      wmataClient.get('/Incidents.svc/json/Incidents'),
    ]);

    // ── Log individual live API call outcomes ─────────────────────────────
    for (const [name, result] of [
      ['TrainPositions', trainsRes],
      ['jStations', stationsRes],
      ['Incidents', incidentsRes],
    ]) {
      if (result.status === 'rejected') {
        console.error(`[/api/map] ${name} FAILED: ${result.reason?.message ?? result.reason}`);
      } else {
        console.log(`[/api/map] ${name} OK (${result.status})`);
      }
    }

    const rawTrains   = trainsRes.status    === 'fulfilled' ? (trainsRes.value.data.TrainPositions ?? []) : [];
    const rawStations = stationsRes.status  === 'fulfilled' ? (stationsRes.value.data.Stations     ?? []) : [];
    const incidents   = incidentsRes.status === 'fulfilled' ? (incidentsRes.value.data.Incidents   ?? []) : [];

    // StandardRoutes from 15-minute cache; falls back to stale value on fetch error
    let standardRoutes;
    try {
      standardRoutes = await getStandardRoutes();
    } catch (err) {
      console.error('[/api/map] StandardRoutes fetch failed:', err.message);
      standardRoutes = cachedRoutes ?? [];
    }

    const cacheAgeS = routesCachedAt ? Math.round((Date.now() - routesCachedAt) / 1000) : 'n/a';
    console.log(`[/api/map] Raw counts — trains: ${rawTrains.length}, stations: ${rawStations.length}, incidents: ${incidents.length}, standardRoutes: ${standardRoutes.length} (cache_age=${cacheAgeS}s)`);

    // Force-invalidate any stale cached reference so this fresh data is used below
    // (map.js always fetches live, but make it explicit for clarity)
    // Diagnostic: confirm StandardRoutes and TrainPositions draw from the same circuit ID space
    if (standardRoutes.length > 0 && rawTrains.length > 0) {
      const sampleRouteCircuits = standardRoutes
        .flatMap(r => r.TrackCircuits ?? [])
        .slice(0, 5)
        .map(tc => tc.CircuitId);
      const sampleTrainCircuits = rawTrains.slice(0, 5).map(t => t.CircuitId);
      console.log(`[/api/map] DIAG StandardRoutes circuit IDs (first 5 across all routes): ${sampleRouteCircuits.join(', ')}`);
      console.log(`[/api/map] DIAG TrainPositions circuit IDs (first 5 live trains):        ${sampleTrainCircuits.join(', ')}`);
      // Check how many live train CircuitIds actually appear in the StandardRoutes circuit space
      const routeCircuitSet = new Set(
        standardRoutes.flatMap(r => (r.TrackCircuits ?? []).map(tc => tc.CircuitId))
      );
      const covered = rawTrains.filter(t => routeCircuitSet.has(t.CircuitId));
      console.log(`[/api/map] DIAG Circuit ID space overlap: ${covered.length}/${rawTrains.length} train CircuitIds found in StandardRoutes`);
      if (covered.length === 0) {
        console.warn('[/api/map] WARNING: 0 overlap — circuit ID spaces do not match; lookup table will produce no results');
      }
    }

    // Log station field shape once to confirm the "Code" key is present
    if (rawStations.length > 0) {
      console.log(`[/api/map] jStations[0] keys: ${Object.keys(rawStations[0]).join(', ')}`);
      const s0 = rawStations[0];
      console.log(`[/api/map] jStations[0] sample: Code=${s0.Code} Name="${s0.Name}" Lat=${s0.Lat} Lon=${s0.Lon}`);
    }

    // Log first route + circuits to confirm StationCode field
    if (standardRoutes.length > 0) {
      const r0 = standardRoutes[0];
      const stationCircuits = (r0.TrackCircuits ?? []).filter(tc => tc.StationCode);
      console.log(`[/api/map] StandardRoutes[0]: LineCode=${r0.LineCode} TrackNum=${r0.TrackNum} totalCircuits=${r0.TrackCircuits?.length} stationCircuits=${stationCircuits.length}`);
      if (stationCircuits.length > 0) {
        const sc = stationCircuits[0];
        console.log(`[/api/map] First station circuit: SeqNum=${sc.SeqNum} CircuitId=${sc.CircuitId} StationCode=${sc.StationCode}`);
      }
    }

    // ── Station map — keyed by Code (jStations field), NOT StationCode ────
    const stationMap = Object.fromEntries(
      rawStations.filter(s => s.Code).map(s => [s.Code, s])
    );
    console.log(`[/api/map] stationMap size: ${Object.keys(stationMap).length} (first 5 keys: ${Object.keys(stationMap).slice(0, 5).join(', ')})`);

    // ── Circuit position interpolation ─────────────────────────────────────
    const circuitPos = buildCircuitPositionMap(standardRoutes, stationMap);
    console.log(`[/api/map] circuitPos map size: ${circuitPos.size} circuits with interpolated lat/lon`);

    // ── Annotate trains with computed lat/lon ──────────────────────────────
    const candidateTrains = rawTrains.filter(
      t => t.CircuitId && t.LineCode && t.LineCode !== 'No' && t.ServiceType === 'Normal'
    );
    let trains = candidateTrains
      .map(t => {
        const pos = circuitPos.get(t.CircuitId);
        return pos ? { ...t, lat: pos.lat, lon: pos.lon } : null;
      })
      .filter(Boolean);

    console.log(`[/api/map] Trains — candidates (Normal+LineCode): ${candidateTrains.length}, positioned: ${trains.length}, dropped (no circuit match): ${candidateTrains.length - trains.length}`);

    // ── Cache-bust ────────────────────────────────────────────────────────
    // If active trains exist but none resolved coordinates, the cached
    // StandardRoutes circuit ID space is stale. Force-clear and re-fetch
    // immediately so this request still returns valid positions.
    if (trains.length === 0 && candidateTrains.length > 0) {
      console.warn(`[/api/map] CACHE-BUST: 0/${candidateTrains.length} candidates resolved — force-clearing StandardRoutes cache and re-fetching`);
      cachedRoutes   = null;
      routesCachedAt = 0;
      try {
        standardRoutes = await getStandardRoutes(true);
        const freshCircuitPos = buildCircuitPositionMap(standardRoutes, stationMap);
        console.log(`[/api/map] CACHE-BUST circuitPos after re-fetch: ${freshCircuitPos.size} circuits`);
        trains = candidateTrains
          .map(t => {
            const pos = freshCircuitPos.get(t.CircuitId);
            return pos ? { ...t, lat: pos.lat, lon: pos.lon } : null;
          })
          .filter(Boolean);
        console.log(`[/api/map] CACHE-BUST result: ${trains.length}/${candidateTrains.length} trains positioned`);
      } catch (err) {
        console.error('[/api/map] CACHE-BUST re-fetch failed:', err.message);
      }
    }

    if (trains.length > 0) {
      const s = trains[0];
      console.log(`[/api/map] Sample train: id=${s.TrainId} line=${s.LineCode} circuit=${s.CircuitId} → lat=${s.lat.toFixed(5)} lon=${s.lon.toFixed(5)}`);
    }

    // ── Build ordered polylines per line ───────────────────────────────────
    const linePolylines = {};
    const seenLines = new Set();

    for (const preferredTrack of [1, 2]) {
      for (const route of standardRoutes) {
        if (route.TrackNum !== preferredTrack || seenLines.has(route.LineCode)) continue;

        const coords = route.TrackCircuits
          .filter(tc => tc.StationCode && stationMap[tc.StationCode])
          .map(tc => [stationMap[tc.StationCode].Lat, stationMap[tc.StationCode].Lon]);

        if (coords.length > 1) {
          linePolylines[route.LineCode] = coords;
          seenLines.add(route.LineCode);
        }
      }
    }

    // Log polyline summary — coordinate count + first/last point per line
    console.log(`[/api/map] Polylines built: ${Object.keys(linePolylines).length} lines`);
    for (const [line, coords] of Object.entries(linePolylines)) {
      const first = coords[0];
      const last  = coords[coords.length - 1];
      console.log(`[/api/map]   ${line}: ${coords.length} station pts — first=[${first[0].toFixed(5)},${first[1].toFixed(5)}] last=[${last[0].toFixed(5)},${last[1].toFixed(5)}]`);
    }

    if (Object.keys(linePolylines).length === 0) {
      console.warn('[/api/map] WARNING: no polylines produced — check stationMap size and StandardRoutes data');
    }

    // ── Clean station payload ──────────────────────────────────────────────
    const stations = rawStations.map(s => ({
      code: s.Code,        // jStations field is "Code", not "StationCode"
      name: s.Name,
      lat:  s.Lat,
      lon:  s.Lon,
      lines: [s.LineCode1, s.LineCode2, s.LineCode3, s.LineCode4].filter(Boolean),
    }));

    console.log(`[/api/map] Response: ${trains.length} trains, ${stations.length} stations, ${incidents.length} incidents, ${Object.keys(linePolylines).length} polylines`);
    console.log('[/api/map] --- fetch cycle end ---');

    res.json({ trains, stations, incidents, routes: linePolylines });
  } catch (err) {
    console.error('[/api/map] Unexpected error:', err.message);
    console.error(err.stack);
    res.status(500).json({ error: 'Failed to fetch map data' });
  }
});

module.exports = router;
