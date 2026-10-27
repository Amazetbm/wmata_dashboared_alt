const mongoose = require('mongoose');

const gtfsVersionSchema = new mongoose.Schema({
  feedHash:  { type: String, required: true },
  feedDate:  { type: String, required: true }, // "YYYYMMDD" from feed_info.txt feed_start_date
  agencyTz:  { type: String, default: 'America/New_York' },
  status:    { type: String, enum: ['loading', 'active', 'stale'], default: 'loading' },
  loadedAt:  { type: Date, default: Date.now },
  meta: {
    feedVersion:         { type: String, default: '' },
    routeCount:          { type: Number, default: 0 },
    stopTimeCount:       { type: Number, default: 0 },
    frequencyCount:      { type: Number, default: 0 },  // always 0 for WMATA
    serviceIdCount:      { type: Number, default: 0 },
    stationsMappedCount: { type: Number, default: 0 },
    serviceDateRange: {
      start: { type: String, default: '' },  // "YYYYMMDD"
      end:   { type: String, default: '' },
    },
  },
});

gtfsVersionSchema.index({ status: 1 });
gtfsVersionSchema.index({ feedHash: 1 });

module.exports = mongoose.model('GtfsVersion', gtfsVersionSchema);
