const router = require('express').Router();
const { wmataClient } = require('../middleware/wmata');

/**
 * Builds a CircuitId → {lat, lon} map by linearly interpolating between
 * consecutive station circuits in each StandardRoute track.
 * Trains without lat/lon (circuits outside any two known station anchors) are dropped.
 */
function buildCircuitPositionMap(standardRoutes, stationMap) {
  const circuitPos = new Map();

  for (const route of standardRoutes) {
    const circuits = [...route.TrackCircuits].sort((a, b) => a.SeqNum - b.SeqNum);
    let prevIdx = -1;
    let prevStation = null;

    for (let i = 0; i < circuits.length; i++) {
      const tc = circuits[i];
      const station = tc.StationCode ? stationMap[tc.StationCode] : null;
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
        circuitPos.set(tc.CircuitId, { lat: station.Lat, lon: station.Lon });
      }

      prevIdx = i;
      prevStation = station;
    }
  }

  return circuitPos;
}

router.get('/', async (req, res) => {
  try {
    const [trainsRes, stationsRes, incidentsRes, routesRes] = await Promise.allSettled([
      wmataClient.get('/TrainPositions/TrainPositions?contentType=json'),
      wmataClient.get('/Rail.svc/json/jStations'),
      wmataClient.get('/Incidents.svc/json/Incidents'),
      wmataClient.get('/TrainPositions/StandardRoutes?contentType=json'),
    ]);

    const rawTrains      = trainsRes.status    === 'fulfilled' ? (trainsRes.value.data.TrainPositions  ?? []) : [];
    const rawStations    = stationsRes.status  === 'fulfilled' ? (stationsRes.value.data.Stations      ?? []) : [];
    const incidents      = incidentsRes.status === 'fulfilled' ? (incidentsRes.value.data.Incidents    ?? []) : [];
    const standardRoutes = routesRes.status    === 'fulfilled' ? (routesRes.value.data.StandardRoutes  ?? []) : [];

    // Station lookup by code
    const stationMap = Object.fromEntries(rawStations.map(s => [s.StationCode, s]));

    // Circuit → interpolated geographic position
    const circuitPos = buildCircuitPositionMap(standardRoutes, stationMap);

    // Annotate trains with computed lat/lon; drop those with no position
    const trains = rawTrains
      .filter(t => t.CircuitId && t.LineCode && t.LineCode !== 'No' && t.ServiceType === 'Normal')
      .map(t => {
        const pos = circuitPos.get(t.CircuitId);
        return pos ? { ...t, lat: pos.lat, lon: pos.lon } : null;
      })
      .filter(Boolean);

    // Ordered polyline coordinates per line (track 1 preferred; fall back to track 2)
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

    // Clean station payload
    const stations = rawStations.map(s => ({
      code: s.StationCode,
      name: s.Name,
      lat: s.Lat,
      lon: s.Lon,
      lines: [s.LineCode1, s.LineCode2, s.LineCode3, s.LineCode4].filter(Boolean),
    }));

    res.json({ trains, stations, incidents, routes: linePolylines });
  } catch (err) {
    console.error('[/api/map]', err.message);
    res.status(500).json({ error: 'Failed to fetch map data' });
  }
});

module.exports = router;