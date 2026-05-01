const mongoose = require('mongoose');

const busIncidentSchema = new mongoose.Schema({
  snapshotAt: { type: Date, required: true },
  IncidentID: String,
  IncidentType: String,
  RoutesAffected: [String],
  Description: String,
  DateUpdated: String,
});

// TTL: expire after 24 hours
busIncidentSchema.index({ snapshotAt: 1 }, { expireAfterSeconds: 86400 });

module.exports = mongoose.model('BusIncident', busIncidentSchema);
