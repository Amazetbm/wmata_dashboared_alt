const mongoose = require('mongoose');

// NOTE: WMATA's GTFS static feed does not include calendar.txt.
// Service is entirely defined via calendar_dates.txt. This model is kept
// for structural completeness; the loader will not populate it.
const gtfsCalendarSchema = new mongoose.Schema({
  version:   { type: mongoose.Schema.Types.ObjectId, ref: 'GtfsVersion', required: true },
  serviceId: { type: String, required: true },
  mon: { type: Number, default: 0 },
  tue: { type: Number, default: 0 },
  wed: { type: Number, default: 0 },
  thu: { type: Number, default: 0 },
  fri: { type: Number, default: 0 },
  sat: { type: Number, default: 0 },
  sun: { type: Number, default: 0 },
  startDate: { type: String }, // "YYYYMMDD"
  endDate:   { type: String }, // "YYYYMMDD"
});

gtfsCalendarSchema.index({ version: 1, serviceId: 1 });

module.exports = mongoose.model('GtfsCalendar', gtfsCalendarSchema);
