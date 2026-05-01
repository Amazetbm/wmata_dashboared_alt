const router = require('express').Router();
const { wmataClient } = require('../middleware/wmata');
const BusPosition = require('../models/BusPosition');
const BusIncident = require('../models/BusIncident');

// In-memory cache for route details — fetched lazily per route, TTL 1 hour
const routeDetailCache = new Map(); // routeId -> { shape0, shape1, cachedAt }
const ROUTE_DETAIL_TTL = 60 * 60 * 1000;

async function fetchRouteDetail(routeId) {
  const cached = routeDetailCache.get(routeId);
  if (cached && Date.now() - cached.cachedAt < ROUTE_DETAIL_TTL) return cached;

  try {
    const { data } = await wmataClient.get(`/Bus.svc/json/jRouteDetails?RouteID=${encodeURIComponent(routeId)}`);
    const entry = {
      shape0: (data.Direction0?.Shape || []).map(p => [p.Lat, p.Lon]),
      shape1: (data.Direction1?.Shape || []).map(p => [p.Lat, p.Lon]),
      cachedAt: Date.now(),
    };
    routeDetailCache.set(routeId, entry);
    return entry;
  } catch {
    return null;
  }
}

// GET /api/bus/map
// Returns live positions, route list, stops, incidents, and shapes for active routes.
router.get('/map', async (req, res) => {
  try {
    const [posRes, routesRes, stopsRes, incRes] = await Promise.allSettled([
      wmataClient.get('/Bus.svc/json/jBusPositions'),
      wmataClient.get('/Bus.svc/json/jRoutes'),
      wmataClient.get('/Bus.svc/json/jStops'),
      wmataClient.get('/Bus.svc/json/jBusIncidents'),
    ]);

    const positions = posRes.status === 'fulfilled' ? (posRes.value.data.BusPositions || []) : [];
    const routes    = routesRes.status === 'fulfilled' ? (routesRes.value.data.Routes || []) : [];
    const stops     = stopsRes.status === 'fulfilled' ? (stopsRes.value.data.Stops || []) : [];
    const incidents = incRes.status === 'fulfilled' ? (incRes.value.data.BusIncidents || []) : [];

    // Fetch shapes only for routes that currently have active buses (lazy + cached)
    const activeRouteIds = [...new Set(positions.map(p => p.RouteID).filter(Boolean))];
    const detailResults = await Promise.allSettled(activeRouteIds.map(id => fetchRouteDetail(id)));

    const routeShapes = {};
    activeRouteIds.forEach((id, i) => {
      const r = detailResults[i];
      if (r.status === 'fulfilled' && r.value) routeShapes[id] = r.value;
    });

    res.json({ positions, routes, stops, incidents, routeShapes });
  } catch (err) {
    console.error('[bus/map]', err.message);
    res.status(502).json({ error: 'Failed to load bus map data' });
  }
});

// GET /api/bus/history/positions
router.get('/history/positions', async (req, res) => {
  const { from, to } = req.query;
  if (!from || !to) return res.status(400).json({ error: 'from and to required' });
  try {
    const filter = { snapshotAt: { $gte: new Date(from), $lte: new Date(to) } };
    const data = await BusPosition.find(filter).sort({ snapshotAt: 1 }).limit(5000);
    res.json(data);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// GET /api/bus/history/incidents
router.get('/history/incidents', async (req, res) => {
  const { from, to } = req.query;
  if (!from || !to) return res.status(400).json({ error: 'from and to required' });
  try {
    const filter = { snapshotAt: { $gte: new Date(from), $lte: new Date(to) } };
    const data = await BusIncident.find(filter).sort({ snapshotAt: 1 }).limit(5000);
    res.json(data);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

module.exports = router;
