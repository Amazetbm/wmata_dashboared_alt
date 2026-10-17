const mongoose = require('mongoose');

const vehicleOccupancySchema = new mongoose.Schema({
  vehicleId:       { type: String, default: null },
  vehicleLabel:    { type: String, default: null },
  occupancyStatus: { type: Number, default: 0 },
  lat:             { type: Number, default: null },
  lon:             { type: Number, default: null },
}, { _id: false });

const busOccupancySchema = new mongoose.Schema({
  snapshotAt:    { type: Date, required: true },
  feedTimestamp: { type: Date, required: true },
  vehicles:      [vehicleOccupancySchema],
});

// TTL: auto-expire after 24 hours (matches BusPosition retention)
busOccupancySchema.index({ snapshotAt: 1 }, { expireAfterSeconds: 86400 });

module.exports = mongoose.model('BusOccupancy', busOccupancySchema);
