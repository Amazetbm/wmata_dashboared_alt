const mongoose = require('mongoose');

const gtfsStopSchema = new mongoose.Schema({
  version:       { type: mongoose.Schema.Types.ObjectId, ref: 'GtfsVersion', required: true },
  stopId:        { type: String, required: true }, // e.g. "STN_A15", "PF_A15_C"
  stopName:      { type: String },
  lat:           { type: Number },
  lon:           { type: Number },
  locationType:  { type: Number, default: 0 }, // 0=platform, 1=station, 2=entrance
  parentStation: { type: String, default: '' }, // stopId of parent station
  wmataCode:     { type: String, default: '' }, // legacy A01-style code, e.g. "A15"
});

gtfsStopSchema.index({ version: 1, wmataCode: 1 });
gtfsStopSchema.index({ version: 1, stopId: 1 });
gtfsStopSchema.index({ version: 1, parentStation: 1 });

module.exports = mongoose.model('GtfsStop', gtfsStopSchema);
