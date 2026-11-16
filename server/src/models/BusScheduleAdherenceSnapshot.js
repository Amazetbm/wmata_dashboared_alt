'use strict';

const mongoose = require('mongoose');

const busRecordSchema = new mongoose.Schema({
  vehicleId:    { type: String, default: null },
  routeId:      { type: String, default: null },
  tripId:       { type: String, default: null },
  delaySeconds: { type: Number, default: null },
  delayLabel:   { type: String, default: null },
}, { _id: false });

const routeSummarySchema = new mongoose.Schema({
  routeId:      { type: String },
  total:        { type: Number, default: 0 },
  early:        { type: Number, default: 0 },
  onTime:       { type: Number, default: 0 },
  minor:        { type: Number, default: 0 },
  significant:  { type: Number, default: 0 },
  noPrediction: { type: Number, default: 0 },
  canceled:     { type: Number, default: 0 },
  unscheduled:  { type: Number, default: 0 },
  added:        { type: Number, default: 0 },
}, { _id: false });

const busScheduleAdherenceSnapshotSchema = new mongoose.Schema({
  snapshotAt:    { type: Date, required: true },
  feedTimestamp: { type: Date, required: true },
  coverageRate:    { type: Number, default: null },
  degraded:        { type: Boolean, default: false },
  matchedActive:   { type: Number, default: 0 },
  matchedPrevious: { type: Number, default: 0 },
  summary: {
    total:        { type: Number, default: 0 },
    early:        { type: Number, default: 0 },
    onTime:       { type: Number, default: 0 },
    minor:        { type: Number, default: 0 },
    significant:  { type: Number, default: 0 },
    noPrediction: { type: Number, default: 0 },
    canceled:     { type: Number, default: 0 },
    unscheduled:  { type: Number, default: 0 },
    added:        { type: Number, default: 0 },
  },
  routeSummaries: [routeSummarySchema],
  buses:          [busRecordSchema],
});

// TTL managed by ensureTtlIndexes
busScheduleAdherenceSnapshotSchema.index({ snapshotAt: 1 });

module.exports = mongoose.model('BusScheduleAdherenceSnapshot', busScheduleAdherenceSnapshotSchema);
