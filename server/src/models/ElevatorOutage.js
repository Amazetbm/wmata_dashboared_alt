const mongoose = require('mongoose');

const elevatorOutageSchema = new mongoose.Schema({
  snapshotAt: { type: Date, required: true, index: true },
  UnitName: String,
  UnitType: String,
  UnitStatus: String,
  StationCode: String,
  StationName: String,
  LocationDescription: String,
  SymptomDescription: String,
  TimeOutOfService: String,
  EstimatedReturnToService: String,
});

module.exports = mongoose.model('ElevatorOutage', elevatorOutageSchema);
