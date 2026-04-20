const mongoose = require('mongoose');

const incidentSchema = new mongoose.Schema({
  snapshotAt: { type: Date, required: true, index: true },
  IncidentID: String,
  Description: String,
  StartLocationFullName: String,
  EndLocationFullName: String,
  PassengerDelay: Number,
  DelaySeverity: String,
  IncidentType: String,
  EmergencyText: String,
  LinesAffected: String,
  DateUpdated: String,
});

module.exports = mongoose.model('Incident', incidentSchema);
