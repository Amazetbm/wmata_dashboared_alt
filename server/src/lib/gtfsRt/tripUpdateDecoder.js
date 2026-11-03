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
    .filter(e => {
      if (!e.tripUpdate) return false;
      // scheduleRelationship 0 = SCHEDULED, null/undefined treated as SCHEDULED
      // SR=2 (UNSCHEDULED/NR) excluded
      const sr = e.tripUpdate.trip?.scheduleRelationship;
      return sr === 0 || sr == null;
    })
    .map(e => {
      const tu = e.tripUpdate;
      const trip = tu.trip ?? {};
      const routeId = trip.routeId ?? null;
      const lineCode = (routeId && ROUTE_TO_LINE[routeId]) ?? null;

      // Find the first STU whose timestamp is >= the feed header timestamp.
      // STUs before that are already stale (median >12 min in the past for WMATA).
      let refStopId = null;
      let refStopSequence = null;
      let refActualTimeSec = null;

      for (const stu of (tu.stopTimeUpdate ?? [])) {
        const t = getPresentTime(stu.arrival) ?? getPresentTime(stu.departure);
        if (t != null && t >= feedTimestampSec) {
          refStopId = stu.stopId ?? null;
          refStopSequence = stu.stopSequence != null ? Number(stu.stopSequence) : null;
          refActualTimeSec = t;
          break;
        }
      }

      return {
        tripId:          trip.tripId    ?? null,
        routeId,
        lineCode,
        vehicleId:       tu.vehicle?.id ?? null,
        startDate:       trip.startDate ?? null,
        refStopId,
        refStopSequence,
        refActualTimeSec,
      };
    });

  return { feedTimestamp, feedTimestampSec, trips };
}

module.exports = { decodeTripUpdates };
