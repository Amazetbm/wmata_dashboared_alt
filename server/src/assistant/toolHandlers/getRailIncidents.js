'use strict';

const { wmataClient } = require('../../middleware/wmata');
const Incident = require('../../models/Incident');

async function getRailIncidents({ mode = 'live', from, to, line } = {}) {
  if (mode === 'live') {
    const { data } = await wmataClient.get('/Incidents.svc/json/Incidents');
    let incidents = data.Incidents || [];
    if (line) {
      const code = line.toUpperCase();
      incidents = incidents.filter(i => (i.LinesAffected || '').includes(code));
    }
    return {
      total: incidents.length,
      top5: incidents.slice(0, 5).map(i => ({
        description: i.Description,
        lines:       i.LinesAffected,
        type:        i.IncidentType,
        delay:       i.PassengerDelay,
        updated:     i.DateUpdated,
      })),
    };
  }

  // History mode — aggregate; never return raw arrays
  const filter = {};
  if (from || to) {
    filter.snapshotAt = {};
    if (from) filter.snapshotAt.$gte = new Date(from);
    if (to)   filter.snapshotAt.$lte = new Date(to);
  }
  if (line) filter.LinesAffected = new RegExp(line.toUpperCase());

  const docs = await Incident
    .find(filter, { Description: 1, IncidentType: 1, LinesAffected: 1, PassengerDelay: 1, snapshotAt: 1, _id: 0 })
    .sort({ snapshotAt: -1 })
    .limit(500)
    .lean();

  const byType = {};
  const byLine = {};
  for (const d of docs) {
    byType[d.IncidentType] = (byType[d.IncidentType] || 0) + 1;
    const lines = (d.LinesAffected || '').split(';').map(l => l.trim()).filter(Boolean);
    for (const l of lines) byLine[l] = (byLine[l] || 0) + 1;
  }

  return {
    total: docs.length,
    byType,
    byLine,
    top5: docs.slice(0, 5).map(d => ({
      description: d.Description,
      lines:       d.LinesAffected,
      type:        d.IncidentType,
      delay:       d.PassengerDelay,
      snapshotAt:  d.snapshotAt,
    })),
  };
}

module.exports = { getRailIncidents };
