const mongoose = require('mongoose');

const trainAdherenceSchema = new mongoose.Schema({
  trainId: String,
  trainNumber: String,
  lineCode: String,
  directionNum: Number,
  circuitId: Number,
  currentSeq: Number,
  expectedSeq: Number,
  deviation: Number,
  status: { type: String, enum: ['on-time', 'minor', 'significant'] },
  carCount: Number,
}, { _id: false });

const lineSummarySchema = new mongoose.Schema({
  lineCode: String,
  total: Number,
  onTime: Number,
  minor: Number,
  significant: Number,
}, { _id: false });

const adherenceSnapshotSchema = new mongoose.Schema({
  snapshotAt: { type: Date, required: true, index: true },
  summary: {
    total: { type: Number, default: 0 },
    onTime: { type: Number, default: 0 },
    minor: { type: Number, default: 0 },
    significant: { type: Number, default: 0 },
  },
  lineSummaries: [lineSummarySchema],
  trains: [trainAdherenceSchema],
});

module.exports = mongoose.model('AdherenceSnapshot', adherenceSnapshotSchema);
