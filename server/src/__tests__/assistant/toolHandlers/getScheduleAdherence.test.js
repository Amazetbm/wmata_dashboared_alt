'use strict';

jest.mock('../../../models/AdherenceSnapshot');
jest.mock('../../../models/ScheduleAdherenceSnapshot');

const { getScheduleAdherence } = require('../../../assistant/toolHandlers/getScheduleAdherence');
const ScheduleAdherenceSnapshot = require('../../../models/ScheduleAdherenceSnapshot');

function makeQueryChain(result) {
  const chain = { sort: jest.fn(), limit: jest.fn(), lean: jest.fn() };
  chain.sort.mockReturnValue(chain);
  chain.limit.mockReturnValue(chain);
  chain.lean.mockResolvedValue(result);
  return chain;
}

const RANGE = { mode: 'history', method: 'schedule', from: '2026-11-01T00:00:00Z', to: '2026-11-02T00:00:00Z' };

beforeEach(() => { jest.clearAllMocks(); });

describe('getScheduleAdherence — history/schedule lineTrends denominator', () => {
  it('lineTrends onTimePct excludes noPrediction from denominator', async () => {
    // predicted = early+onTime+minor+significant = 1+5+2+1 = 9, NOT total=10
    const snapshots = [{
      snapshotAt: '2026-11-01T00:00:00Z',
      summary: { total: 10, early: 1, onTime: 5, minor: 2, significant: 1, noPrediction: 1, canceled: 0, unscheduled: 0, added: 0 },
      lineSummaries: [{ lineCode: 'RD', total: 10, early: 1, onTime: 5, minor: 2, significant: 1, noPrediction: 1, canceled: 0, unscheduled: 0, added: 0 }],
      coverageRate: 0.9,
      degraded: false,
    }];
    ScheduleAdherenceSnapshot.find = jest.fn().mockReturnValue(makeQueryChain(snapshots));

    const result = await getScheduleAdherence({ ...RANGE, line: 'RD' });

    const trend = result.lineTrends['RD'];
    expect(trend.onTimePct).toBe(Math.round(5 / 9 * 100)); // 56
    expect(trend.earlyPct).toBe(Math.round(1 / 9 * 100));  // 11
  });

  it('lineTrends noPredictionPct still uses lt.total as denominator', async () => {
    const snapshots = [{
      snapshotAt: '2026-11-01T00:00:00Z',
      summary: { total: 10, early: 1, onTime: 5, minor: 2, significant: 1, noPrediction: 1, canceled: 0, unscheduled: 0, added: 0 },
      lineSummaries: [{ lineCode: 'RD', total: 10, early: 1, onTime: 5, minor: 2, significant: 1, noPrediction: 1, canceled: 0, unscheduled: 0, added: 0 }],
      coverageRate: 0.9,
      degraded: false,
    }];
    ScheduleAdherenceSnapshot.find = jest.fn().mockReturnValue(makeQueryChain(snapshots));

    const result = await getScheduleAdherence({ ...RANGE, line: 'RD' });

    const trend = result.lineTrends['RD'];
    expect(trend.noPredictionPct).toBe(Math.round(1 / 10 * 100)); // 10
  });

  it('lineTrends onTimePct is null when all noPrediction (predicted=0)', async () => {
    const snapshots = [{
      snapshotAt: '2026-11-01T00:00:00Z',
      summary: { total: 10, early: 0, onTime: 0, minor: 0, significant: 0, noPrediction: 10, canceled: 0, unscheduled: 0, added: 0 },
      lineSummaries: [{ lineCode: 'RD', total: 10, early: 0, onTime: 0, minor: 0, significant: 0, noPrediction: 10, canceled: 0, unscheduled: 0, added: 0 }],
      coverageRate: 0,
      degraded: true,
    }];
    ScheduleAdherenceSnapshot.find = jest.fn().mockReturnValue(makeQueryChain(snapshots));

    const result = await getScheduleAdherence({ ...RANGE, line: 'RD' });

    const trend = result.lineTrends['RD'];
    expect(trend.onTimePct).toBeNull();
    expect(trend.noPredictionPct).toBe(100);
  });

  it('averages onTimePct is null when all noPrediction', async () => {
    const snapshots = [{
      snapshotAt: '2026-11-01T00:00:00Z',
      summary: { total: 5, early: 0, onTime: 0, minor: 0, significant: 0, noPrediction: 5, canceled: 0, unscheduled: 0, added: 0 },
      lineSummaries: [],
      coverageRate: 0,
      degraded: false,
    }];
    ScheduleAdherenceSnapshot.find = jest.fn().mockReturnValue(makeQueryChain(snapshots));

    const result = await getScheduleAdherence(RANGE);

    expect(result.averages.onTimePct).toBeNull();
  });

  it('lineTrends onTimePct rounds correctly with mixed predicted/noPrediction', async () => {
    // 2 snapshots: accumulate to early=2, onTime=10, minor=4, significant=2, noPrediction=2, total=20
    // predicted = 2+10+4+2 = 18; onTimePct = round(10/18*100) = 56
    const snap = (line) => ({
      snapshotAt: '2026-11-01T00:00:00Z',
      summary: { total: 10, early: 1, onTime: 5, minor: 2, significant: 1, noPrediction: 1, canceled: 0, unscheduled: 0, added: 0 },
      lineSummaries: line ? [{ lineCode: line, total: 10, early: 1, onTime: 5, minor: 2, significant: 1, noPrediction: 1, canceled: 0, unscheduled: 0, added: 0 }] : [],
      coverageRate: 0.9,
      degraded: false,
    });
    ScheduleAdherenceSnapshot.find = jest.fn().mockReturnValue(makeQueryChain([snap('RD'), snap('RD')]));

    const result = await getScheduleAdherence({ ...RANGE, line: 'RD' });

    const trend = result.lineTrends['RD'];
    expect(trend.onTimePct).toBe(Math.round(10 / 18 * 100)); // 56
    expect(trend.noPredictionPct).toBe(Math.round(2 / 20 * 100)); // 10
  });
});
