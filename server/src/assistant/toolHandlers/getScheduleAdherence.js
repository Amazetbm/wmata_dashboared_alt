'use strict';

const AdherenceSnapshot = require('../../models/AdherenceSnapshot');
const ScheduleAdherenceSnapshot = require('../../models/ScheduleAdherenceSnapshot');

async function getScheduleAdherence({ mode = 'live', method = 'headway', from, to, at, line } = {}) {
  const Model = method === 'schedule' ? ScheduleAdherenceSnapshot : AdherenceSnapshot;
  const isSchedule = method === 'schedule';

  if (mode === 'live') {
    const snapshot = await Model.findOne().sort({ snapshotAt: -1 }).lean();
    if (!snapshot) return null;
    const { snapshotAt, summary, lineSummaries, trains, coverageRate, degraded } = snapshot;
    return {
      snapshotAt,
      summary,
      lineSummaries: line
        ? (lineSummaries || []).filter(l => l.lineCode === line.toUpperCase())
        : lineSummaries,
      trains: line
        ? (trains || []).filter(t => t.lineCode === line.toUpperCase())
        : trains,
      ...(isSchedule ? { coverageRate, degraded } : {}),
    };
  }

  if (mode === 'snapshot') {
    if (!at) throw new Error('at is required for mode=snapshot');
    const target = new Date(at);
    const [before, after] = await Promise.all([
      Model.findOne({ snapshotAt: { $lte: target } }).sort({ snapshotAt: -1 }).lean(),
      Model.findOne({ snapshotAt: { $gte: target } }).sort({ snapshotAt:  1 }).lean(),
    ]);
    let closest = before;
    if (after && (!before || Math.abs(after.snapshotAt - target) < Math.abs(before.snapshotAt - target))) {
      closest = after;
    }
    return closest;
  }

  // History mode — summarise trend; return averages not raw array
  if (!from || !to) throw new Error('from and to are required for mode=history');

  const snapshots = await Model
    .find(
      { snapshotAt: { $gte: new Date(from), $lte: new Date(to) } },
      { snapshotAt: 1, summary: 1, lineSummaries: 1, _id: 0 }
    )
    .sort({ snapshotAt: 1 })
    .limit(2000)
    .lean();

  if (!snapshots.length) return { from, to, snapshotCount: 0, averages: null, lineTrends: {} };

  if (isSchedule) {
    // Schedule method — aggregate early/onTime/minor/significant/noPrediction/canceled/unscheduled/added
    const totals     = { early: 0, onTime: 0, minor: 0, significant: 0, noPrediction: 0, canceled: 0, unscheduled: 0, added: 0, total: 0 };
    const lineTotals = {};

    for (const s of snapshots) {
      const sum = s.summary || {};
      if (sum.total) {
        totals.early        += sum.early        || 0;
        totals.onTime       += sum.onTime       || 0;
        totals.minor        += sum.minor        || 0;
        totals.significant  += sum.significant  || 0;
        totals.noPrediction += sum.noPrediction || 0;
        totals.canceled     += sum.canceled     || 0;
        totals.unscheduled  += sum.unscheduled  || 0;
        totals.added        += sum.added        || 0;
        totals.total        += sum.total        || 0;
      }
      if (line) {
        const ls = (s.lineSummaries || []).find(l => l.lineCode === line.toUpperCase());
        if (ls && ls.total) {
          if (!lineTotals[line]) lineTotals[line] = { early: 0, onTime: 0, minor: 0, significant: 0, noPrediction: 0, canceled: 0, unscheduled: 0, added: 0, total: 0 };
          lineTotals[line].early        += ls.early        || 0;
          lineTotals[line].onTime       += ls.onTime       || 0;
          lineTotals[line].minor        += ls.minor        || 0;
          lineTotals[line].significant  += ls.significant  || 0;
          lineTotals[line].noPrediction += ls.noPrediction || 0;
          lineTotals[line].canceled     += ls.canceled     || 0;
          lineTotals[line].unscheduled  += ls.unscheduled  || 0;
          lineTotals[line].added        += ls.added        || 0;
          lineTotals[line].total        += ls.total        || 0;
        }
      }
    }

    const pct = (n, d) => d > 0 ? Math.round(100 * n / d) : 0;
    const averages = totals.total > 0 ? {
      earlyPct:        pct(totals.early,        totals.total),
      onTimePct:       pct(totals.onTime,        totals.total),
      minorPct:        pct(totals.minor,         totals.total),
      significantPct:  pct(totals.significant,   totals.total),
      noPredictionPct: pct(totals.noPrediction,  totals.total),
      canceled:        totals.canceled,
      unscheduled:     totals.unscheduled,
      added:           totals.added,
    } : null;

    const lineTrends = {};
    for (const [lc, lt] of Object.entries(lineTotals)) {
      if (lt.total > 0) {
        lineTrends[lc] = {
          earlyPct:        pct(lt.early,        lt.total),
          onTimePct:       pct(lt.onTime,        lt.total),
          minorPct:        pct(lt.minor,         lt.total),
          significantPct:  pct(lt.significant,   lt.total),
          noPredictionPct: pct(lt.noPrediction,  lt.total),
          canceled:        lt.canceled,
          unscheduled:     lt.unscheduled,
          added:           lt.added,
        };
      }
    }

    return { from, to, snapshotCount: snapshots.length, averages, lineTrends };
  }

  // Headway method (default)
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
