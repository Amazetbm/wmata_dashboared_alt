'use strict';

const { transit_realtime: { FeedMessage } } = require('gtfs-realtime-bindings');

// Inline to avoid importing loader.js which has DB side-effects at module load
const ROUTE_TO_LINE = {
  RED:    'RD',
  BLUE:   'BL',
  GREEN:  'GR',
  YELLOW: 'YL',
  ORANGE: 'OR',
  SILVER: 'SV',
};

/**
 * Check whether `event` has an own `time` property and return its value as a
 * number, or null if absent / zero.  Protobuf default 0 must not be treated as
 * a real timestamp.
 *
 * @param {object|null|undefined} event  e.g. stu.arrival or stu.departure
 * @returns {number|null}
 */
function getPresentTime(event) {
  if (!event) return null;
  if (!Object.prototype.hasOwnProperty.call(event, 'time')) return null;
  const t = Number(event.time);
  return t !== 0 ? t : null;
}

/**
 * Decode a GTFS-RT TripUpdates protobuf buffer.
 *
 * Returns a slim per-trip object — no full STU array.  The "reference stop"
 * is the first stop-time-update whose absolute timestamp is ≥ the feed
 * header timestamp.  If all STUs are in the past, refStopSequence and
 * refActualTimeSec are null (noPrediction).
 *
 * @param {Buffer|ArrayBuffer} buffer
 * @returns {{ feedTimestamp: Date, feedTimestampSec: number, trips: Array }}
 */
function decodeTripUpdates(buffer) {
  const feed = FeedMessage.decode(new Uint8Array(buffer));

  const rawTs = feed.header?.timestamp;
  const feedTimestampSec = (rawTs != null && Number(rawTs) !== 0)
    ? Number(rawTs)
    : Math.floor(Date.now() / 1000);
  const feedTimestamp = new Date(feedTimestampSec * 1000);

  const trips = (feed.entity ?? [])
    .filter(e => e.tripUpdate)
    .map(e => {
      const tu = e.tripUpdate;
      const trip = tu.trip ?? {};
      const routeId = trip.routeId ?? null;
      const lineCode = (routeId && ROUTE_TO_LINE[routeId]) ?? null;

      // scheduleRelationship: 0=SCHEDULED, 1=ADDED, 2=UNSCHEDULED, 3=CANCELED
      // null/undefined treated as 0 (SCHEDULED)
      const sr = trip.scheduleRelationship;
      const scheduleRelationship = (sr != null) ? Number(sr) : null;
      const isScheduled = sr === 0 || sr == null;

      // Only SCHEDULED trips get a reference stop lookup; non-SCHEDULED trips
      // have refStopSequence=null so delay computation skips them.
      let refStopId = null;
      let refStopSequence = null;
      let refActualTimeSec = null;

      if (isScheduled) {
        // Find the first STU whose timestamp is >= the feed header timestamp.
        // STUs before that are already stale (median >12 min in the past for WMATA).
        for (const stu of (tu.stopTimeUpdate ?? [])) {
          const t = getPresentTime(stu.arrival) ?? getPresentTime(stu.departure);
          if (t != null && t >= feedTimestampSec) {
            refStopId = stu.stopId ?? null;
            refStopSequence = stu.stopSequence != null ? Number(stu.stopSequence) : null;
            refActualTimeSec = t;
            break;
          }
        }
      }

      return {
        tripId:               trip.tripId    ?? null,
        routeId,
        lineCode,
        vehicleId:            tu.vehicle?.id ?? null,
        startDate:            trip.startDate ?? null,
        scheduleRelationship,
        refStopId,
        refStopSequence,
        refActualTimeSec,
      };
    });

  return { feedTimestamp, feedTimestampSec, trips };
}

/**
 * Decode a GTFS-RT TripUpdates protobuf buffer for Metrobus.
 *
 * Returns a slim per-trip object with refCandidates: ALL future stop-time
 * updates (arrival.time ≥ feedTimestampSec, sorted by ascending stop_sequence).
 * The poller iterates refCandidates in order and picks the first one that
 * matches a GtfsStopTime row in the static schedule.
 *
 * Also returns:
 *   - tripDelay: trip-level delay in seconds (null if not present in feed)
 *   - startTime: trip start time string "HH:MM:SS" (null if absent)
 *
 * Key differences from decodeTripUpdates (rail):
 *   - No ROUTE_TO_LINE lookup; lineCode is always null
 *   - routeId is passed through as-is (already the bus route ID, e.g. "A11")
 *   - refCandidates replaces refStopSequence/refActualTimeSec
 *
 * @param {Buffer|ArrayBuffer} buffer
 * @returns {{ feedTimestamp: Date, feedTimestampSec: number, trips: Array }}
 */
function decodeBusTripUpdates(buffer) {
  const feed = FeedMessage.decode(new Uint8Array(buffer));

  const rawTs = feed.header?.timestamp;
  const feedTimestampSec = (rawTs != null && Number(rawTs) !== 0)
    ? Number(rawTs)
    : Math.floor(Date.now() / 1000);
  const feedTimestamp = new Date(feedTimestampSec * 1000);

  const trips = (feed.entity ?? [])
    .filter(e => e.tripUpdate)
    .map(e => {
      const tu = e.tripUpdate;
      const trip = tu.trip ?? {};
      const routeId = trip.routeId ?? null;

      const sr = trip.scheduleRelationship;
      const scheduleRelationship = (sr != null) ? Number(sr) : null;
      const isScheduled = sr === 0 || sr == null;

      // Trip-level delay (presence-checked; protobuf default 0 is a valid delay value)
      const tripDelay = Object.prototype.hasOwnProperty.call(tu, 'delay')
        ? Number(tu.delay) : null;

      // For SCHEDULED trips: collect ALL future stop-time-updates (no cap)
      // sorted by ascending stop_sequence (they already arrive in order from the feed).
      let refCandidates = [];
      if (isScheduled) {
        const stus = (tu.stopTimeUpdate ?? []);
        for (const stu of stus) {
          const t = getPresentTime(stu.arrival) ?? getPresentTime(stu.departure);
          if (t != null && t >= feedTimestampSec) {
            const seq = stu.stopSequence != null ? Number(stu.stopSequence) : null;
            if (seq != null) {
              refCandidates.push({ stopSequence: seq, actualTimeSec: t });
            }
          }
        }
        // Sort by ascending stop_sequence in case the feed is not ordered
        refCandidates.sort((a, b) => a.stopSequence - b.stopSequence);
      }

      return {
        tripId:               trip.tripId    ?? null,
        routeId,
        lineCode:             null, // bus has no WMATA line code
        vehicleId:            tu.vehicle?.id ?? null,
        startDate:            trip.startDate ?? null,
        startTime:            trip.startTime || null, // "HH:MM:SS" for current-trip selection; empty string → null
        scheduleRelationship,
        tripDelay,
        refCandidates,
      };
    });

  return { feedTimestamp, feedTimestampSec, trips };
}

module.exports = { decodeTripUpdates, decodeBusTripUpdates };
