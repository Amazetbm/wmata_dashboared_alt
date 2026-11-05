'use strict';

const { wmataClient } = require('../middleware/wmata');

const STATIONS_TTL_MS = 6  * 60 * 60 * 1000;   // 6 hours
const ROUTES_TTL_MS   = 15 * 60 * 1000;         // 15 minutes
const JROUTES_TTL_MS  = 24 * 60 * 60 * 1000;    // 24 hours
const JSTOPS_TTL_MS   = 24 * 60 * 60 * 1000;    // 24 hours

let stationsCache = null, stationsCachedAt = 0;
let routesCache   = null, routesCachedAt   = 0;
let jRoutesCache  = null, jRoutesCachedAt  = 0;
let jStopsCache   = null, jStopsCachedAt   = 0;

async function getStations() {
  if (stationsCache && (Date.now() - stationsCachedAt) < STATIONS_TTL_MS) return stationsCache;
  const { data } = await wmataClient.get('/Rail.svc/json/jStations');
  stationsCache   = data.Stations ?? [];
  stationsCachedAt = Date.now();
  console.log(`[staticCache] jStations (re)cached — ${stationsCache.length} stations`);
  return stationsCache;
}

async function getStandardRoutes(force = false) {
  if (!force && routesCache && (Date.now() - routesCachedAt) < ROUTES_TTL_MS) return routesCache;
  const { data } = await wmataClient.get('/TrainPositions/StandardRoutes?contentType=json');
  routesCache   = data.StandardRoutes ?? [];
  routesCachedAt = Date.now();
  console.log(`[staticCache] StandardRoutes (re)cached — ${routesCache.length} routes`);
  return routesCache;
}

/** Synchronous getter — returns last cached value or [] if never fetched. */
function getCachedRoutes() {
  return routesCache ?? [];
}

async function getRoutes() {
  if (jRoutesCache && (Date.now() - jRoutesCachedAt) < JROUTES_TTL_MS) return jRoutesCache;
  const { data } = await wmataClient.get('/Bus.svc/json/jRoutes');
  jRoutesCache  = data.Routes ?? [];
  jRoutesCachedAt = Date.now();
  return jRoutesCache;
}

async function getStops() {
  if (jStopsCache && (Date.now() - jStopsCachedAt) < JSTOPS_TTL_MS) return jStopsCache;
  const { data } = await wmataClient.get('/Bus.svc/json/jStops');
  jStopsCache  = data.Stops ?? [];
  jStopsCachedAt = Date.now();
  return jStopsCache;
}

module.exports = { getStations, getStandardRoutes, getCachedRoutes, getRoutes, getStops };
