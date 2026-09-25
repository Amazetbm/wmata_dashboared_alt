import { z } from 'zod';
import apiFetch, { ApiError } from '../client.js';
const DESCRIPTION = 'Current positions and schedule adherence for every train on a rail line.';
const LINE_ENUM = z.enum(['RD', 'BL', 'OR', 'SV', 'GR', 'YL']);
export async function liveTrainsHandler({ line }, fetcher = apiFetch) {
    try {
        const data = await fetcher('/api/adherence/live');
        const trains = (data.trains ?? [])
            .filter(t => t.lineCode === line)
            .map(t => ({
            trainId: t.trainId,
            direction: t.directionNum,
            circuitId: t.circuitId,
            currentSeq: t.currentSeq,
            deviation: t.deviation,
            status: t.status,
            cars: t.carCount,
        }));
        const lineSummary = (data.lineSummaries ?? []).find(ls => ls.lineCode === line) ?? null;
        const result = {
            snapshotAt: data.snapshotAt,
            line,
            trainCount: trains.length,
            lineSummary,
            trains,
        };
        return { content: [{ type: 'text', text: JSON.stringify(result) }] };
    }
    catch (err) {
        const msg = err instanceof ApiError ? `API error ${err.status}: ${err.message}` : String(err);
        return { content: [{ type: 'text', text: JSON.stringify({ error: msg }) }], isError: true };
    }
}
export function registerLiveTrains(server) {
    server.tool('live_trains', DESCRIPTION, { line: LINE_ENUM }, (args) => liveTrainsHandler(args));
}
