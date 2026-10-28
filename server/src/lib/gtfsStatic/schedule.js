'use strict';

const { DateTime } = require('luxon');
const GtfsVersion = require('../../models/GtfsVersion');
const GtfsRoute = require('../../models/GtfsRoute');
const GtfsStop = require('../../models/GtfsStop');
const GtfsCalendarDate = require('../../models/GtfsCalendarDate');
const GtfsTrip = require('../../models/GtfsTrip');
const GtfsStopTime = require('../../models/GtfsStopTime');
const { gtfsToUtc } = require('./timeUtils');

/**
 * Get the ObjectId of the currently active GtfsVersion.
 * Returns null if no active version exists.
 */
async function getActiveVersionId() {
  const v = await GtfsVersion.findOne({ status: 'active' }).sort({ loadedAt: -1 }).lean();
  return v ? v._id : null;
}

/**
 * Return all active service_ids for the given local date.
 *
 * WMATA's GTFS feed uses calendar_dates-only (no calendar.txt):
 *   - exception_type=1 → service IS running on this date
 *   - exception_type=2 → service is NOT running (removal from a base schedule)
 *
 * @param {string} localDateStr  "YYYY-MM-DD"
 * @param {mongoose.Types.ObjectId} [versionId]  defaults to active version
 * @returns {Promise<string[]>}
 */
async function getActiveServiceIds(localDateStr, versionId) {
  const vid = versionId || (await getActiveVersionId());
  if (!vid) return [];

  // Convert "YYYY-MM-DD" → "YYYYMMDD" for GTFS date field
  const gtfsDate = localDateStr.replace(/-/g, '');

  const entries = await GtfsCalendarDate.find({
    version: vid,
    date: gtfsDate,
  }).lean();

  const added = new Set();
  const removed = new Set();
  for (const e of entries) {
    if (e.exceptionType === 1) added.add(e.serviceId);
    else if (e.exceptionType === 2) removed.add(e.serviceId);
  }
  for (const id of removed) added.delete(id);

  return [...added];
}

/**
 * Return all scheduled departures at a station for a given date,
 * sorted by departureSec ascending.
 *
 * @param {string} wmataCode   legacy station code, e.g. "A01"
 * @param {string} localDateStr  "YYYY-MM-DD"
 * @param {mongoose.Types.ObjectId} [versionId]
 * @returns {Promise<Array<{tripId,lineCode,routeId,headsign,direction,departureSec,departureTimeUtc}>>}
 */
async function getScheduledDepartures(wmataCode, localDateStr, versionId) {
  const vid = versionId || (await getActiveVersionId());
  if (!vid) return [];

  // Find all stops matching this wmataCode
  const stops = await GtfsStop.find({ version: vid, wmataCode }).lean();
  if (stops.length === 0) return [];

  const stopIds = stops.map(s => s.stopId);

  // Get active service IDs
  const serviceIds = await getActiveServiceIds(localDateStr, vid);
  if (serviceIds.length === 0) return [];

  // Find trips at these stops
  const stopTimes = await GtfsStopTime.find({
    version: vid,
    stopId: { $in: stopIds },
  }).lean();

  if (stopTimes.length === 0) return [];

  const tripIds = [...new Set(stopTimes.map(st => st.tripId))];

  // Filter trips to those in active service
  const trips = await GtfsTrip.find({
    version: vid,
    tripId: { $in: tripIds },
    serviceId: { $in: serviceIds },
  }).lean();

  if (trips.length === 0) return [];

  const activeTripIds = new Set(trips.map(t => t.tripId));

  // Build route lineCode lookup
  const routeIds = [...new Set(trips.map(t => t.routeId))];
  const routes = await GtfsRoute.find({ version: vid, routeId: { $in: routeIds } }).lean();
  const routeLineCode = Object.fromEntries(routes.map(r => [r.routeId, r.lineCode]));

  // Build trip lookup
  const tripMap = Object.fromEntries(trips.map(t => [t.tripId, t]));

  // Build departures
  const departures = [];
  for (const st of stopTimes) {
    if (!activeTripIds.has(st.tripId)) continue;
    const trip = tripMap[st.tripId];
    departures.push({
      tripId: st.tripId,
      lineCode: routeLineCode[trip.routeId] || trip.routeId,
      routeId: trip.routeId,
      headsign: trip.tripHeadsign,
      direction: trip.directionId,
      departureSec: st.departureSec,
      departureTimeUtc: gtfsToUtc(localDateStr, st.departureSec),
    });
  }

  departures.sort((a, b) => a.departureSec - b.departureSec);
  return departures;
}

/**
 * Return all stop_times for a trip, with absolute UTC times, sorted by sequence.
 *
 * @param {string} tripId
 * @param {string} localDateStr  "YYYY-MM-DD"
 * @param {mongoose.Types.ObjectId} [versionId]
 * @returns {Promise<Array<{stopId,stopSequence,arrivalSec,departureSec,departureTimeUtc}>>}
 */
async function getTripSchedule(tripId, localDateStr, versionId) {
  const vid = versionId || (await getActiveVersionId());
  if (!vid) return [];

  const stopTimes = await GtfsStopTime.find({ version: vid, tripId })
    .sort({ stopSequence: 1 })
    .lean();

  return stopTimes.map(st => ({
    stopId: st.stopId,
    stopSequence: st.stopSequence,
    arrivalSec: st.arrivalSec,
    departureSec: st.departureSec,
    departureTimeUtc: gtfsToUtc(localDateStr, st.departureSec),
  }));
}

/**
 * Return all active trips for a route/line on the given date.
 *
 * @param {string} lineCode  e.g. "RD"
 * @param {string} localDateStr  "YYYY-MM-DD"
 * @param {mongoose.Types.ObjectId} [versionId]
 * @returns {Promise<Array<{tripId,routeId,serviceId,directionId,tripHeadsign}>>}
 */
async function getScheduledTripsInService(lineCode, localDateStr, versionId) {
  const vid = versionId || (await getActiveVersionId());
  if (!vid) return [];

  const routes = await GtfsRoute.find({ version: vid, lineCode }).lean();
  if (routes.length === 0) return [];

  const routeIds = routes.map(r => r.routeId);
  const serviceIds = await getActiveServiceIds(localDateStr, vid);
  if (serviceIds.length === 0) return [];

  const trips = await GtfsTrip.find({
    version: vid,
    routeId: { $in: routeIds },
    serviceId: { $in: serviceIds },
  }).lean();

  return trips.map(t => ({
    tripId: t.tripId,
    routeId: t.routeId,
    serviceId: t.serviceId,
    directionId: t.directionId,
    tripHeadsign: t.tripHeadsign,
  }));
}

module.exports = {
  getActiveVersionId,
  getActiveServiceIds,
  getScheduledDepartures,
  getTripSchedule,
  getScheduledTripsInService,
};
