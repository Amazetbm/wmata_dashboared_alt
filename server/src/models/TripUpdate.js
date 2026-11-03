'use strict';

const mongoose = require('mongoose');

const stuSchema = new mongoose.Schema({
  stopId:          { type: String, default: null },
  stopSequence:    { type: Number, default: null },
  arrivalTime:     { type: Date,   default: null },
  departureTime:   { type: Date,   default: null },
  arrivalDelay:    { type: Number, default: null },
  departureDelay:  { type: Number, default: null },
}, { _id: false });

const tripSchema = new mongoose.Schema({
  tripId:               { type: String, default: null },
  routeId:              { type: String, default: null },
  lineCode:             { type: String, default: null },
  vehicleId:            { type: String, default: null },
  currentDelaySeconds:  { type: Number, default: null },
  stus:                 [stuSchema],
}, { _id: false });

const tripUpdateSchema = new mongoose.Schema({
  snapshotAt:    { type: Date, required: true },
  feedTimestamp: { type: Date, required: true },
  trips:         [tripSchema],
});

// TTL: auto-expire after 24 hours
tripUpdateSchema.index({ snapshotAt: 1 }, { expireAfterSeconds: 86400 });

module.exports = mongoose.model('TripUpdate', tripUpdateSchema);
