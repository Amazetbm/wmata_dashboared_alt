const mongoose = require('mongoose');

const busPositionSchema = new mongoose.Schema({
  snapshotAt: { type: Date, required: true },
  VehicleID: String,
  Lat: Number,
  Lon: Number,
  Deviation: Number,
  DateTime: String,
  TripID: String,
  RouteID: String,
  DirectionText: String,
  TripHeadsign: String,
  TripStartTime: String,
  TripEndTime: String,
  BlockNumber: String,
});

// TTL: expire after 24 hours
busPositionSchema.index({ snapshotAt: 1 }, { expireAfterSeconds: 86400 });

module.exports = mongoose.model('BusPosition', busPositionSchema);
