'use strict';

const AdherenceSnapshot = require('../../models/AdherenceSnapshot');

async function getScheduleAdherence({ mode = 'live', from, to, at, line } = {}) {
  if (mode === 'live') {
    const snapshot = await AdherenceSnapshot.findOne().sort({ snapshotAt: -1 }).lean();
    if (!snapshot) return null;
    const { snapshotAt, summary, lineSummaries, trains } = snapshot;
    return {
      snapshotAt,
      summary,
      lineSummaries: line
        ? (lineSummaries || []).filter(l => l.lineCode === line.toUpperCase())
        : lineSummaries,
      trains: line
        ? (trains || []).filter(t => t.lineCode === line.toUpperCase())
        : trains,
    };
  }

  if (mode === 'snapshot') {
    if (!at) throw new Error('at is required for mode=snapshot');
    const target = new Date(at);
    const [before, after] = await Promise.all([
      AdherenceSnapshot.findOne({ snapshotAt: { $lte: target } }).sort({ snapshotAt: -1 }).lean(),
      AdherenceSnapshot.findOne({ snapshotAt: { $gte: target } }).sort({ snapshotAt:  1 }).lean(),
    ]);
    let closest = before;
    if (after && (!before || Math.abs(after.snapshotAt - target) < Math.abs(before.snapshotAt - target))) {
      closest = after;
    }
    return closest;
  }

  // History mode — summarise trend; return averages not raw array
  if (!from || !to) throw new Error('from and to are required for mode=history');

  const snapshots = await AdherenceSnapshot
    .find(
      { snapshotAt: { $gte: new Date(from), $lte: new Date(to) } },
      { snapshotAt: 1, summary: 1, lineSummaries: 1, _id: 0 }
    )
    .sort({ snapshotAt: 1 })
    .limit(2000)
    .lean();

  if (!snapshots.length) return { from, to, snapshotCount: 0, averages: null, lineTrends: {} };

  const totals     = { onTime: 0, minor: 0, significant: 0, total: 0 };
  const lineTotals = {};

  for (const s of snapshots) {
    const sum = s.summary || {};
    if (sum.total) {
      totals.onTime      += sum.onTime      || 0;
      totals.minor       += sum.minor       || 0;
      totals.significant += sum.significant || 0;
      totals.total       += sum.total       || 0;
    }
    if (line) {
      const ls = (s.lineSummaries || []).find(l => l.lineCode === line.toUpperCase());
      if (ls && ls.total) {
        if (!lineTotals[line]) lineTotals[line] = { onTime: 0, minor: 0, significant: 0, total: 0 };
        lineTotals[line].onTime      += ls.onTime      || 0;
        lineTotals[line].minor       += ls.minor       || 0;
        lineTotals[line].significant += ls.significant || 0;
        lineTotals[line].total       += ls.total       || 0;
      }
    }
  }

  const pct = (n, d) => d > 0 ? Math.round(100 * n / d) : 0;
  const averages = totals.total > 0 ? {
    onTimePct:      pct(totals.onTime,      totals.total),
    minorPct:       pct(totals.minor,       totals.total),
    significantPct: pct(totals.significant, totals.total),
  } : null;

  const lineTrends = {};
  for (const [lc, lt] of Object.entries(lineTotals)) {
    if (lt.total > 0) {
      lineTrends[lc] = {
        onTimePct:      pct(lt.onTime,      lt.total),
        minorPct:       pct(lt.minor,       lt.total),
        significantPct: pct(lt.significant, lt.total),
      };
    }
  }

  return { from, to, snapshotCount: snapshots.length, averages, lineTrends };
}

module.exports = { getScheduleAdherence };
