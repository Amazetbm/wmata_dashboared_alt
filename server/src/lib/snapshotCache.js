'use strict';

const STALE_MS = 90_000;
const store = {};

exports.set     = (key, data) => { store[key] = { data, snapshotAt: Date.now() }; };
exports.get     = (key)       => store[key] ?? { data: null, snapshotAt: 0 };
exports.isStale = (key)       => !store[key] || Date.now() - store[key].snapshotAt > STALE_MS;
