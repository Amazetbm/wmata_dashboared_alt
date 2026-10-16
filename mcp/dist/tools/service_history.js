import { z } from 'zod';
import apiFetch, { ApiError } from '../client.js';
const DESCRIPTION = 'Adherence trends and incident counts over a date range (ISO 8601). Optional line filter. Use for "how has service been lately" questions.';
const LINE_ENUM = z.enum(['RD', 'BL', 'OR', 'SV', 'GR', 'YL']);
function lineInAffected(linesAffected, line) {
    return (linesAffected ?? '')
        .split(';')
        .map(l => l.trim())
        .filter(Boolean)
        .includes(line);
}
export async function serviceHistoryHandler({ from, to, line }, fetcher = apiFetch) {
    try {
        const adherencePath = `/api/adherence/history?from=${encodeURIComponent(from)}&to=${encodeURIComponent(to)}` +
            (line ? `&line=${line}` : '');
        const incidentsPath = `/api/incidents/history?from=${encodeURIComponent(from)}&to=${encodeURIComponent(to)}`;
        const [snapshots, incidentDocs] = await Promise.all([
            fetcher(adherencePath),
            fetcher(incidentsPath),
        ]);
        // Aggregate summary across all snapshots
        const totals = { total: 0, onTime: 0, minor: 0, significant: 0 };
        for (const snap of snapshots ?? []) {
            const s = snap.summary;
            totals.total += s.total ?? 0;
            totals.onTime += s.onTime ?? 0;
            totals.minor += s.minor ?? 0;
            totals.significant += s.significant ?? 0;
        }
        const onTimePct = totals.total > 0
            ? Math.round((totals.onTime / totals.total) * 1000) / 10
            : null;
        // Deduplicate incidents by IncidentID
        const seen = new Map();
        for (const doc of incidentDocs ?? []) {
            if (!seen.has(doc.IncidentID))
                seen.set(doc.IncidentID, doc);
        }
        let incidents = Array.from(seen.values());
        if (line)
            incidents = incidents.filter(i => lineInAffected(i.LinesAffected, line));
        const result = {
            range: { from, to },
            line: line ?? 'all',
            snapshotCount: (snapshots ?? []).length,
            adherence: { ...totals, onTimePct },
            incidentCount: incidents.length,
            incidents: incidents.map(i => ({
                id: i.IncidentID,
                description: i.Description,
                type: i.IncidentType,
                lines: (i.LinesAffected ?? '').split(';').map(l => l.trim()).filter(Boolean),
                updated: i.DateUpdated,
            })),
        };
        return { content: [{ type: 'text', text: JSON.stringify(result) }] };
    }
    catch (err) {
        const msg = err instanceof ApiError ? `API error ${err.status}: ${err.message}` : String(err);
        return { content: [{ type: 'text', text: JSON.stringify({ error: msg }) }], isError: true };
    }
}
export function registerServiceHistory(server) {
    server.tool('service_history', DESCRIPTION, {
        from: z.string().datetime({ offset: true }),
        to: z.string().datetime({ offset: true }),
        line: LINE_ENUM.optional(),
    }, (args) => serviceHistoryHandler(args));
}
