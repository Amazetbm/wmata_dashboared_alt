'use strict';

const mongoose = require('mongoose');

const tripSchema = new mongoose.Schema({
  tripId:          { type: String, default: null },
  routeId:         { type: String, default: null },
  lineCode:        { type: String, default: null },
  vehicleId:       { type: String, default: null },
  trainId:         { type: String, default: null }, // from VP join; null when not yet started
  startDate:       { type: String, default: null }, // YYYYMMDD, from trip.startDate
  refStopId:       { type: String, default: null },
  refStopSequence: { type: Number, default: null },
  refActualTime:   { type: Date,   default: null }, // Unix ts converted to Date
  delaySeconds:    { type: Number, default: null }, // actual − scheduled; null = noPrediction
  delayLabel:      { type: String, default: null }, // Early/On Time/Slight Delay/Delay/Significant Delay
}, { _id: false });

const tripUpdateSchema = new mongoose.Schema({
  snapshotAt:    { type: Date, required: true },
  feedTimestamp: { type: Date, required: true },
  trips:         [tripSchema],
});

// TTL: auto-expire after 24 hours
tripUpdateSchema.index({ snapshotAt: 1 }, { expireAfterSeconds: 86400 });

module.exports = mongoose.model('TripUpdate', tripUpdateSchema);
