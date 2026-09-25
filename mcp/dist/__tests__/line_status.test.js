import { jest } from '@jest/globals';
import { createRequire } from 'module';
import { lineStatusHandler } from '../tools/line_status.js';
const require = createRequire(import.meta.url);
const adherenceLive = require('./fixtures/adherence_live.json');
const incidentsLive = require('./fixtures/incidents_live.json');
function makeFetcher(adherence = adherenceLive, incidents = incidentsLive) {
    return jest.fn().mockImplementation((path) => {
        if (path.includes('/adherence/live'))
            return Promise.resolve(adherence);
        if (path.includes('/incidents/live'))
            return Promise.resolve(incidents);
        return Promise.reject(new Error(`Unexpected path: ${path}`));
    });
}
describe('lineStatusHandler', () => {
    it('returns all-line summary when no line given', async () => {
        const fetcher = makeFetcher();
        const result = await lineStatusHandler({}, fetcher);
        expect(result.isError).toBeUndefined();
        const data = JSON.parse(result.content[0].text);
        expect(data.line).toBe('all');
        expect(data.summary.total).toBe(50);
        expect(data.incidents).toHaveLength(2);
    });
    it('filters to line-specific summary and incidents', async () => {
        const fetcher = makeFetcher();
        const result = await lineStatusHandler({ line: 'RD' }, fetcher);
        const data = JSON.parse(result.content[0].text);
        expect(data.line).toBe('RD');
        expect(data.summary.total).toBe(20);
        expect(data.summary.onTime).toBe(16);
        // Only INC001 affects RD
        expect(data.incidents).toHaveLength(1);
        expect(data.incidents[0].id).toBe('INC001');
    });
    it('returns zero summary when line not in lineSummaries', async () => {
        const fetcher = makeFetcher();
        const result = await lineStatusHandler({ line: 'GR' }, fetcher);
        const data = JSON.parse(result.content[0].text);
        expect(data.summary.total).toBe(0);
        expect(data.incidents).toHaveLength(0);
    });
    it('drops trains array from output', async () => {
        const fetcher = makeFetcher();
        const result = await lineStatusHandler({ line: 'RD' }, fetcher);
        const data = JSON.parse(result.content[0].text);
        expect(data).not.toHaveProperty('trains');
    });
    it('maps incidents to expected shape', async () => {
        const fetcher = makeFetcher();
        const result = await lineStatusHandler({ line: 'BL' }, fetcher);
        const data = JSON.parse(result.content[0].text);
        expect(data.incidents[0]).toMatchObject({
            id: 'INC002',
            description: expect.stringContaining('Blue'),
            type: 'Alert',
            lines: expect.arrayContaining(['BL', 'OR']),
            updated: '2026-09-24T10:00:00',
        });
    });
    it('returns isError on fetch failure', async () => {
        const fetcher = jest.fn().mockRejectedValue(new Error('timeout'));
        const result = await lineStatusHandler({}, fetcher);
        expect(result.isError).toBe(true);
    });
});
