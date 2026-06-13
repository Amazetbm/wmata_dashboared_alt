const mongoose = require('mongoose');

const busIncidentSchema = new mongoose.Schema({
  snapshotAt: { type: Date, required: true },
  IncidentID: String,
  IncidentType: String,
  RoutesAffected: [String],
  Description: String,
  DateUpdated: String,
});

busIncidentSchema.index({ snapshotAt: 1 });

module.exports = mongoose.model('BusIncident', busIncidentSchema);
