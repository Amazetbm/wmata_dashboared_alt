const mongoose = require('mongoose');

const elevatorOutageSchema = new mongoose.Schema({
  snapshotAt: { type: Date, required: true },
  UnitName: String,
  UnitType: String,
  UnitStatus: String,
  StationCode: String,
  StationName: String,
  LocationDescription: String,
  SymptomDescription: String,
  DateOutOfServ: String,
  TimeOutOfService: String,
  EstimatedReturnToService: String,
  DateUpdated: String,
});

// TTL: documents expire 90 days after snapshotAt.
// On an existing collection, drop the old snapshotAt_1 index first:
//   db.elevatoroutages.dropIndex("snapshotAt_1")
elevatorOutageSchema.index({ snapshotAt: 1 }, { expireAfterSeconds: 7776000 });

module.exports = mongoose.model('ElevatorOutage', elevatorOutageSchema);
