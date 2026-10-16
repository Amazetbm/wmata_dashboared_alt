import { z } from 'zod';
import apiFetch, { ApiError } from '../client.js';
const DESCRIPTION = 'Current positions and schedule adherence for trains on a rail line. ' +
    'Returns station-relative location (e.g. "at Metro Center (A01)", "between Foggy Bottom and Rosslyn") ' +
    'and destination name for each train, plus a line adherence summary. ' +
    'Omit line to get all lines.';
const LINE_ENUM = z.enum(['RD', 'BL', 'OR', 'SV', 'GR', 'YL']);
export async function liveTrainsHandler({ line }, fetcher = apiFetch) {
    try {
        const path = line
            ? `/api/trains/located?line=${encodeURIComponent(line)}`
            : '/api/trains/located';
        const data = await fetcher(path);
        const result = {
            snapshotAt: data.snapshotAt,
            ...(line ? { line } : {}),
            trainCount: (data.trains ?? []).length,
            summary: data.summary,
            trains: (data.trains ?? []).map(t => ({
                trainId: t.trainId,
                lineCode: t.lineCode,
                cars: t.carCount,
                status: t.status,
                location: t.location,
                destination: t.destination,
            })),
        };
        return { content: [{ type: 'text', text: JSON.stringify(result) }] };
    }
    catch (err) {
        const msg = err instanceof ApiError ? `API error ${err.status}: ${err.message}` : String(err);
        return { content: [{ type: 'text', text: JSON.stringify({ error: msg }) }], isError: true };
    }
}
export function registerLiveTrains(server) {
    server.tool('live_trains', DESCRIPTION, { line: LINE_ENUM.optional() }, (args) => liveTrainsHandler(args));
}
