'use strict';

const mongoose = require('mongoose');

const trainScheduleSchema = new mongoose.Schema({
  trainId:         { type: String, default: null },
  trainNumber:     { type: String, default: null },
  lineCode:        { type: String, default: null },
  directionNum:    { type: Number, default: null },
  circuitId:       { type: Number, default: null },
  tripId:          { type: String, default: null },
  delaySeconds:    { type: Number, default: null },
  delayLabel:      { type: String, default: null },
  destinationCode: { type: String, default: null },
}, { _id: false });

const lineSummarySchema = new mongoose.Schema({
  lineCode:     { type: String },
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

const scheduleAdherenceSnapshotSchema = new mongoose.Schema({
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
  lineSummaries: [lineSummarySchema],
  trains:        [trainScheduleSchema],
});

// TTL managed by ensureTtlIndexes (same retention as adherencesnapshots)
scheduleAdherenceSnapshotSchema.index({ snapshotAt: 1 });

module.exports = mongoose.model('ScheduleAdherenceSnapshot', scheduleAdherenceSnapshotSchema);
