'use strict';

const { wmataClient } = require('../../middleware/wmata');

async function getNextTrains({ station_code } = {}) {
  if (!station_code) throw new Error('station_code is required');
  const { data } = await wmataClient.get(
    `/StationPrediction.svc/json/GetPrediction/${encodeURIComponent(station_code)}`
  );
  const trains = (data.Trains || []).map(t => ({
    Line:        t.Line,
    Car:         t.Car,
    Destination: t.DestinationName || t.Destination,
    Min:         t.Min,
  }));
  return { station_code, trains };
}

module.exports = { getNextTrains };
