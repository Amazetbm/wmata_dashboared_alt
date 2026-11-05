'use strict';

const staticCache = require('../../lib/staticCache');

async function getStations() {
  const raw = await staticCache.getStations();
  return raw.map(s => ({
    code:  s.Code,
    name:  s.Name,
    lines: [s.LineCode1, s.LineCode2, s.LineCode3, s.LineCode4].filter(Boolean),
    lat:   s.Lat,
    lon:   s.Lon,
  }));
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
