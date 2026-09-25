import { jest } from '@jest/globals';
import { createRequire } from 'module';
import { serviceHistoryHandler } from '../tools/service_history.js';
const require = createRequire(import.meta.url);
const adherenceHistory = require('./fixtures/adherence_history.json');
const incidentsHistory = require('./fixtures/incidents_history.json');
const RANGE = {
    from: '2026-09-24T00:00:00-04:00',
    to: '2026-09-24T23:59:59-04:00',
};
function makeFetcher(adherence = adherenceHistory, incidents = incidentsHistory) {
    return jest.fn().mockImplementation((path) => {
        if (path.includes('/adherence/history'))
            return Promise.resolve(adherence);
        if (path.includes('/incidents/history'))
            return Promise.resolve(incidents);
        return Promise.reject(new Error(`Unexpected path: ${path}`));
    });
}
describe('serviceHistoryHandler', () => {
    it('aggregates adherence totals across snapshots', async () => {
        const fetcher = makeFetcher();
        const result = await serviceHistoryHandler(RANGE, fetcher);
        expect(result.isError).toBeUndefined();
        const data = JSON.parse(result.content[0].text);
        expect(data.snapshotCount).toBe(2);
        // 50 + 48 = 98 total; 40 + 38 = 78 onTime
        expect(data.adherence.total).toBe(98);
        expect(data.adherence.onTime).toBe(78);
        expect(data.adherence.onTimePct).toBeCloseTo(79.6, 0);
    });
    it('deduplicates incidents by IncidentID', async () => {
        const fetcher = makeFetcher();
        const result = await serviceHistoryHandler(RANGE, fetcher);
        const data = JSON.parse(result.content[0].text);
        // INC001 appears twice in fixture; INC002 once → should deduplicate to 2
        expect(data.incidentCount).toBe(2);
    });
    it('filters incidents by line', async () => {
        const fetcher = makeFetcher();
        const result = await serviceHistoryHandler({ ...RANGE, line: 'RD' }, fetcher);
        const data = JSON.parse(result.content[0].text);
        // Only INC001 affects RD
        expect(data.incidentCount).toBe(1);
        expect(data.incidents[0].id).toBe('INC001');
    });
    it('passes line param to adherence history endpoint', async () => {
        const fetcher = makeFetcher();
        await serviceHistoryHandler({ ...RANGE, line: 'RD' }, fetcher);
        const calls = fetcher.mock.calls.map((c) => c[0]);
        const adherenceCall = calls.find((p) => p.includes('/adherence/history'));
        expect(adherenceCall).toContain('line=RD');
    });
    it('returns onTimePct null when no snapshots', async () => {
        const fetcher = makeFetcher([], []);
        const result = await serviceHistoryHandler(RANGE, fetcher);
        const data = JSON.parse(result.content[0].text);
        expect(data.adherence.onTimePct).toBeNull();
    });
    it('returns isError on fetch failure', async () => {
        const fetcher = jest.fn().mockRejectedValue(new Error('DB error'));
        const result = await serviceHistoryHandler(RANGE, fetcher);
        expect(result.isError).toBe(true);
    });
});
