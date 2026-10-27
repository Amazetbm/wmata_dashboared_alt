const mongoose = require('mongoose');

const gtfsStopTimeSchema = new mongoose.Schema({
  version:      { type: mongoose.Schema.Types.ObjectId, ref: 'GtfsVersion', required: true },
  tripId:       { type: String, required: true },
  stopId:       { type: String, required: true },
  stopSequence: { type: Number, required: true },
  arrivalSec:   { type: Number, required: true },  // seconds since service-day midnight (may exceed 86400)
  departureSec: { type: Number, required: true },
});

gtfsStopTimeSchema.index({ version: 1, tripId: 1, stopSequence: 1 });
gtfsStopTimeSchema.index({ version: 1, stopId: 1, departureSec: 1 });

module.exports = mongoose.model('GtfsStopTime', gtfsStopTimeSchema);
