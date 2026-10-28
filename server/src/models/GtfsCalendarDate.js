const mongoose = require('mongoose');

const gtfsCalendarDateSchema = new mongoose.Schema({
  version:       { type: mongoose.Schema.Types.ObjectId, ref: 'GtfsVersion', required: true },
  serviceId:     { type: String, required: true },
  date:          { type: String, required: true },  // "YYYYMMDD"
  exceptionType: { type: Number, required: true },  // 1=added, 2=removed
});

gtfsCalendarDateSchema.index({ version: 1, date: 1 });
gtfsCalendarDateSchema.index({ version: 1, serviceId: 1, date: 1 });

module.exports = mongoose.model('GtfsCalendarDate', gtfsCalendarDateSchema);
