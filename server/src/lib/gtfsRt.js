'use strict';

const { transit_realtime: { FeedMessage } } = require('gtfs-realtime-bindings');

/**
 * Decode a GTFS-RT vehicle positions protobuf buffer.
 *
 * @param {Buffer|ArrayBuffer} buffer
 * @returns {{ feedTimestamp: Date, vehicles: Array, tripMap: Map<string,string> }}
 *   tripMap: vehicleId → tripId, for joining TripUpdates to positioned trains.
 */
function decodeVehiclePositions(buffer) {
  const feed = FeedMessage.decode(new Uint8Array(buffer));

  const rawTs = feed.header?.timestamp;
  const feedTimestamp = (rawTs != null && Number(rawTs) !== 0)
    ? new Date(Number(rawTs) * 1000)
    : new Date();

  const vehicles = (feed.entity ?? [])
    .filter(e => e.vehicle)
    .map(e => ({
      vehicleId:       e.vehicle.vehicle?.id         ?? null,
      vehicleLabel:    e.vehicle.vehicle?.label       ?? null,
      occupancyStatus: Object.prototype.hasOwnProperty.call(e.vehicle, 'occupancyStatus')
        ? e.vehicle.occupancyStatus
        : null,
      lat:             e.vehicle.position?.latitude   ?? null,
      lon:             e.vehicle.position?.longitude  ?? null,
    }));

  // Build vehicleId → tripId map so the TU block can join trips to TrainIds
  const tripMap = new Map();
  for (const e of (feed.entity ?? [])) {
    if (!e.vehicle) continue;
    const vid = e.vehicle.vehicle?.id ?? null;
    const tid = e.vehicle.trip?.tripId ?? null;
    if (vid && tid) tripMap.set(String(vid), String(tid));
  }

  return { feedTimestamp, vehicles, tripMap };
}

module.exports = { decodeVehiclePositions };
