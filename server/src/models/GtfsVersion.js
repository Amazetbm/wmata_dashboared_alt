const mongoose = require('mongoose');

const gtfsVersionSchema = new mongoose.Schema({
  feedHash:  { type: String, required: true },
  feedDate:  { type: String, required: true }, // "YYYYMMDD" from feed_info.txt feed_start_date
  agencyTz:  { type: String, default: 'America/New_York' },
  status:    { type: String, enum: ['loading', 'active', 'stale'], default: 'loading' },
  loadedAt:  { type: Date, default: Date.now },
});

gtfsVersionSchema.index({ status: 1 });
gtfsVersionSchema.index({ feedHash: 1 });

module.exports = mongoose.model('GtfsVersion', gtfsVersionSchema);
