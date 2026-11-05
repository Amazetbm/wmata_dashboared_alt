'use strict';

const { wmataClient } = require('../../middleware/wmata');

const predCache   = new Map(); // station_code → { data, cachedAt }
const PRED_TTL_MS = 25_000;

async function getNextTrains({ station_code } = {}) {
  if (!station_code) throw new Error('station_code is required');

  const cached = predCache.get(station_code);
  if (cached && Date.now() - cached.cachedAt < PRED_TTL_MS) {
    return cached.data;
  }

  const { data } = await wmataClient.get(
    `/StationPrediction.svc/json/GetPrediction/${encodeURIComponent(station_code)}`
  );
  const trains = (data.Trains || []).map(t => ({
    Line:        t.Line,
    Car:         t.Car,
    Destination: t.DestinationName || t.Destination,
    Min:         t.Min,
  }));
  const result = { station_code, trains };
  predCache.set(station_code, { data: result, cachedAt: Date.now() });
  return result;
}

module.exports = { getNextTrains };
