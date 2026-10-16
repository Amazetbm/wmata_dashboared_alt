import { z } from 'zod';
import apiFetch, { ApiError } from '../client.js';
const DESCRIPTION = 'Current on-time performance and active incidents for one or all rail lines. Returns adherence counts and any active alerts.';
const LINE_ENUM = z.enum(['RD', 'BL', 'OR', 'SV', 'GR', 'YL']);
function lineInAffected(linesAffected, line) {
    return linesAffected
        .split(';')
        .map(l => l.trim())
        .filter(Boolean)
        .includes(line);
}
export async function lineStatusHandler({ line }, fetcher = apiFetch) {
    try {
        const [adherence, incidentsData] = await Promise.all([
            fetcher('/api/adherence/live'),
            fetcher('/api/incidents/live'),
        ]);
        const summary = line
            ? adherence.lineSummaries.find(ls => ls.lineCode === line) ??
                { lineCode: line, total: 0, onTime: 0, minor: 0, significant: 0 }
            : adherence.summary;
        const allIncidents = incidentsData.Incidents ?? [];
        const filteredIncidents = line
            ? allIncidents.filter(i => lineInAffected(i.LinesAffected ?? '', line))
            : allIncidents;
        const incidents = filteredIncidents.map(i => ({
            id: i.IncidentID,
            description: i.Description,
            type: i.IncidentType,
            lines: (i.LinesAffected ?? '').split(';').map(l => l.trim()).filter(Boolean),
            updated: i.DateUpdated,
        }));
        const result = {
            snapshotAt: adherence.snapshotAt,
            line: line ?? 'all',
            summary,
            incidentCount: incidents.length,
            incidents,
        };
        return { content: [{ type: 'text', text: JSON.stringify(result) }] };
    }
    catch (err) {
        const msg = err instanceof ApiError ? `API error ${err.status}: ${err.message}` : String(err);
        return { content: [{ type: 'text', text: JSON.stringify({ error: msg }) }], isError: true };
    }
}
export function registerLineStatus(server) {
    server.tool('line_status', DESCRIPTION, { line: LINE_ENUM.optional() }, (args) => lineStatusHandler(args));
}
