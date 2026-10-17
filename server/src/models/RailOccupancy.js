const mongoose = require('mongoose');

const vehicleOccupancySchema = new mongoose.Schema({
  vehicleId:       { type: String, default: null },
  vehicleLabel:    { type: String, default: null },
  occupancyStatus: { type: Number, default: 0 },
  lat:             { type: Number, default: null },
  lon:             { type: Number, default: null },
}, { _id: false });

const railOccupancySchema = new mongoose.Schema({
  snapshotAt:    { type: Date, required: true },
  feedTimestamp: { type: Date, required: true },
  vehicles:      [vehicleOccupancySchema],
});

module.exports = mongoose.model('RailOccupancy', railOccupancySchema);
