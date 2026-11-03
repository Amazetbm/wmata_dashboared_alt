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

function toDateOrNull(ts) {
  if (ts == null || Number(ts) === 0) return null;
  return new Date(Number(ts) * 1000);
}

function toNumberOrNull(val) {
  if (val == null) return null;
  const n = Number(val);
  return isFinite(n) ? n : null;
}

/**
 * Decode a GTFS-RT TripUpdates protobuf buffer.
 *
 * @param {Buffer|ArrayBuffer} buffer
 * @returns {{ feedTimestamp: Date, trips: Array }}
 */
function decodeTripUpdates(buffer) {
  const feed = FeedMessage.decode(new Uint8Array(buffer));

  const rawTs = feed.header?.timestamp;
  const feedTimestamp = (rawTs != null && Number(rawTs) !== 0)
    ? new Date(Number(rawTs) * 1000)
    : new Date();

  const trips = (feed.entity ?? [])
    .filter(e => {
      if (!e.tripUpdate) return false;
      // scheduleRelationship 0 = SCHEDULED, null/undefined treated as SCHEDULED
      const sr = e.tripUpdate.trip?.scheduleRelationship;
      return sr === 0 || sr == null;
    })
    .map(e => {
      const tu = e.tripUpdate;
      const trip = tu.trip ?? {};
      const routeId = trip.routeId ?? null;
      const lineCode = (routeId && ROUTE_TO_LINE[routeId]) ?? null;

      const stus = (tu.stopTimeUpdate ?? []).map(stu => ({
        stopId:         stu.stopId         ?? null,
        stopSequence:   stu.stopSequence   != null ? Number(stu.stopSequence) : null,
        arrivalTime:    toDateOrNull(stu.arrival?.time),
        departureTime:  toDateOrNull(stu.departure?.time),
        arrivalDelay:   toNumberOrNull(stu.arrival?.delay),
        departureDelay: toNumberOrNull(stu.departure?.delay),
      }));

      // currentDelaySeconds: first STU's arrivalDelay ?? departureDelay ?? null
      let currentDelaySeconds = null;
      if (stus.length > 0) {
        const first = stus[0];
        if (first.arrivalDelay != null) {
          currentDelaySeconds = first.arrivalDelay;
        } else if (first.departureDelay != null) {
          currentDelaySeconds = first.departureDelay;
        }
      }

      return {
        tripId:              trip.tripId     ?? null,
        routeId,
        lineCode,
        vehicleId:           tu.vehicle?.id  ?? null,
        currentDelaySeconds,
        stus,
      };
    });

  return { feedTimestamp, trips };
}

module.exports = { decodeTripUpdates };
