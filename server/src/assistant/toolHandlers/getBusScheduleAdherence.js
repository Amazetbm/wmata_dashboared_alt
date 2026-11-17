'use strict';

const BusScheduleAdherenceSnapshot = require('../../models/BusScheduleAdherenceSnapshot');

async function getBusScheduleAdherence({ mode = 'live', route, from, to } = {}) {
  if (mode === 'live') {
    const snapshot = await BusScheduleAdherenceSnapshot.findOne().sort({ snapshotAt: -1 }).lean();
    if (!snapshot) return null;
    const { snapshotAt, summary, routeSummaries, buses, coverageRate, scheduleMatchRate, degraded } = snapshot;
    return {
      snapshotAt,
      summary,
      inactive:         summary?.inactive     ?? null,
      methodCounts:     summary?.methodCounts  ?? null,
      scheduleMatchRate: scheduleMatchRate     ?? null,
      routeSummaries: route
        ? (routeSummaries || []).filter(r => r.routeId === route.toUpperCase())
        : routeSummaries,
      buses: route
        ? (buses || []).filter(b => b.routeId === route.toUpperCase())
        : buses,
      coverageRate,
      degraded,
    };
  }

  if (mode === 'snapshot') {
    throw new Error('snapshot mode not yet implemented for bus adherence');
  }

  // History mode — aggregate trend over range
  if (!from || !to) throw new Error('from and to are required for mode=history');

  const snapshots = await BusScheduleAdherenceSnapshot
    .find(
      { snapshotAt: { $gte: new Date(from), $lte: new Date(to) } },
      { snapshotAt: 1, summary: 1, routeSummaries: 1, coverageRate: 1, degraded: 1, _id: 0 },
    )
    .sort({ snapshotAt: 1 })
    .limit(2000)
    .lean();

  if (!snapshots.length) return { from, to, snapshotCount: 0, averages: null, routeTrends: {} };

  const totals = { early: 0, onTime: 0, minor: 0, significant: 0, noPrediction: 0, canceled: 0, unscheduled: 0, added: 0, total: 0 };
  const routeTotals = {};

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
    if (route) {
      const rs = (s.routeSummaries || []).find(r => r.routeId === route.toUpperCase());
      if (rs && rs.total) {
        const key = route.toUpperCase();
        if (!routeTotals[key]) routeTotals[key] = { early: 0, onTime: 0, minor: 0, significant: 0, noPrediction: 0, canceled: 0, unscheduled: 0, added: 0, total: 0 };
        routeTotals[key].early        += rs.early        || 0;
        routeTotals[key].onTime       += rs.onTime       || 0;
        routeTotals[key].minor        += rs.minor        || 0;
        routeTotals[key].significant  += rs.significant  || 0;
        routeTotals[key].noPrediction += rs.noPrediction || 0;
        routeTotals[key].canceled     += rs.canceled     || 0;
        routeTotals[key].unscheduled  += rs.unscheduled  || 0;
        routeTotals[key].added        += rs.added        || 0;
        routeTotals[key].total        += rs.total        || 0;
      }
    }
  }

  const pct = (n, d) => d > 0 ? Math.round(100 * n / d) : 0;
  const predictedTotal = totals.early + totals.onTime + totals.minor + totals.significant;
  const averages = totals.total > 0 ? {
    earlyPct:        pct(totals.early,        predictedTotal),
    onTimePct:       predictedTotal ? Math.round(totals.onTime / predictedTotal * 100) : null,
    minorPct:        pct(totals.minor,         predictedTotal),
    significantPct:  pct(totals.significant,   predictedTotal),
    noPredictionPct: pct(totals.noPrediction,  totals.total),
    canceled:        totals.canceled,
    unscheduled:     totals.unscheduled,
    added:           totals.added,
  } : null;

  const routeTrends = {};
  for (const [rt, rtTotals] of Object.entries(routeTotals)) {
    if (rtTotals.total > 0) {
      const rt_predicted = rtTotals.early + rtTotals.onTime + rtTotals.minor + rtTotals.significant;
      routeTrends[rt] = {
        earlyPct:        pct(rtTotals.early,        rt_predicted),
        onTimePct:       rt_predicted ? Math.round(rtTotals.onTime / rt_predicted * 100) : null,
        minorPct:        pct(rtTotals.minor,         rt_predicted),
        significantPct:  pct(rtTotals.significant,   rt_predicted),
        noPredictionPct: pct(rtTotals.noPrediction,  rtTotals.total),
        canceled:        rtTotals.canceled,
        unscheduled:     rtTotals.unscheduled,
        added:           rtTotals.added,
      };
    }
  }

  const degradedCount = snapshots.filter(s => s.degraded).length;
  const avgCoverageRate = snapshots.length
    ? Math.round(snapshots.reduce((a, s) => a + (s.coverageRate ?? 0), 0) / snapshots.length * 100) / 100
    : null;

  return { from, to, snapshotCount: snapshots.length, averages, routeTrends, degradedCount, avgCoverageRate };
}

module.exports = { getBusScheduleAdherence };
