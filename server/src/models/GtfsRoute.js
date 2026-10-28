const mongoose = require('mongoose');

const gtfsRouteSchema = new mongoose.Schema({
  version:   { type: mongoose.Schema.Types.ObjectId, ref: 'GtfsVersion', required: true },
  routeId:   { type: String, required: true }, // e.g. "RED", "BLUE"
  lineCode:  { type: String, required: true }, // e.g. "RD", "BL"
  longName:  { type: String },
});

gtfsRouteSchema.index({ version: 1, lineCode: 1 });

module.exports = mongoose.model('GtfsRoute', gtfsRouteSchema);
