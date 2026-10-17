'use strict';

const { transit_realtime: { FeedMessage } } = require('gtfs-realtime-bindings');

/**
 * Decode a GTFS-RT vehicle positions protobuf buffer.
 *
 * @param {Buffer|ArrayBuffer} buffer
 * @returns {{ feedTimestamp: Date, vehicles: Array }}
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
      occupancyStatus: e.vehicle.occupancyStatus      ?? 0,
      lat:             e.vehicle.position?.latitude   ?? null,
      lon:             e.vehicle.position?.longitude  ?? null,
    }));

  return { feedTimestamp, vehicles };
}

module.exports = { decodeVehiclePositions };
