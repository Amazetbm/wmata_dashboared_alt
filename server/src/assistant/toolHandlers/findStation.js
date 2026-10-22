'use strict';

const { wmataClient } = require('../../middleware/wmata');

let stationCache  = null;
let stationCachedAt = 0;
const CACHE_TTL = 24 * 60 * 60 * 1000; // 24 hours

async function getStations() {
  if (stationCache && Date.now() - stationCachedAt < CACHE_TTL) return stationCache;
  const { data } = await wmataClient.get('/Rail.svc/json/jStations');
  stationCache = (data.Stations || []).map(s => ({
    code:  s.Code,
    name:  s.Name,
    lines: [s.LineCode1, s.LineCode2, s.LineCode3, s.LineCode4].filter(Boolean),
    lat:   s.Lat,
    lon:   s.Lon,
  }));
  stationCachedAt = Date.now();
  return stationCache;
}

async function findStation({ query }) {
  if (!query || typeof query !== 'string') throw new Error('query is required');
  const stations = await getStations();
  const q = query.toLowerCase().trim();

  const exact = stations.find(s => s.name.toLowerCase() === q);
  if (exact) return [exact];

  const matches = stations.filter(s => s.name.toLowerCase().includes(q));
  if (!matches.length) return [];
  return matches.slice(0, 3);
}

module.exports = { findStation, getStations };
