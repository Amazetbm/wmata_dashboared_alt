const mongoose = require('mongoose');

const trainPositionSchema = new mongoose.Schema({
  snapshotAt: { type: Date, required: true },
  TrainId: String,
  TrainNumber: String,
  CarCount: Number,
  DirectionNum: Number,
  CircuitId: Number,
  DestinationStationCode: String,
  LineCode: String,
  SecondsAtLocation: Number,
  ServiceType: String,
});

module.exports = mongoose.model('TrainPosition', trainPositionSchema);
