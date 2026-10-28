const mongoose = require('mongoose');

const gtfsTripSchema = new mongoose.Schema({
  version:      { type: mongoose.Schema.Types.ObjectId, ref: 'GtfsVersion', required: true },
  tripId:       { type: String, required: true },
  routeId:      { type: String, required: true }, // e.g. "RED"
  serviceId:    { type: String, required: true },
  directionId:  { type: Number, default: 0 }, // 0 or 1
  tripHeadsign: { type: String, default: '' },
  shapeId:      { type: String, default: '' },
});

gtfsTripSchema.index({ version: 1, routeId: 1, serviceId: 1 });
gtfsTripSchema.index({ version: 1, tripId: 1 });

module.exports = mongoose.model('GtfsTrip', gtfsTripSchema);
