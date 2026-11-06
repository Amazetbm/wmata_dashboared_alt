import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { z } from 'zod';
import apiFetch, { ApiError, type Fetcher } from '../client.js';

const DESCRIPTION =
  'Adherence trends and incident counts over a date range (ISO 8601). Optional line filter. Use for "how has service been lately" questions. ' +
  'method=headway (default) uses headway-based adherence; method=schedule uses GTFS-RT schedule adherence (requires GTFS_RAIL_TRIP_UPDATES=true).';

const LINE_ENUM = z.enum(['RD', 'BL', 'OR', 'SV', 'GR', 'YL']);
type Line = z.infer<typeof LINE_ENUM>;

interface AdherenceSummary {
  total: number;
  onTime: number;
  minor: number;
  significant: number;
}

interface AdherenceSnapshot {
  snapshotAt: string;
  summary: AdherenceSummary;
}

interface IncidentDoc {
  IncidentID: string;
  Description: string;
  IncidentType: string;
  LinesAffected: string;
  DateUpdated: string;
  snapshotAt: string;
}

function lineInAffected(linesAffected: string, line: string): boolean {
  return (linesAffected ?? '')
    .split(';')
    .map(l => l.trim())
    .filter(Boolean)
    .includes(line);
}

interface ScheduleHistoryResponse {
  from: string;
  to: string;
  snapshotCount: number;
  averages: {
    onTimePct: number | null;
    earlyPct: number;
    minorPct: number;
    significantPct: number;
    noPredictionPct: number;
    canceled: number;
    unscheduled: number;
    added: number;
  } | null;
  lineTrends: Record<string, unknown>;
  degradedCount: number;
  avgCoverageRate: number | null;
}

export async function serviceHistoryHandler(
  { from, to, line, method = 'headway' }: { from: string; to: string; line?: Line; method?: 'headway' | 'schedule' },
  fetcher: Fetcher = apiFetch,
) {
  try {
    if (method === 'schedule') {
      const days = Math.round((new Date(to).getTime() - new Date(from).getTime()) / (24 * 60 * 60 * 1000));
      const path = `/api/adherence/summary?method=schedule&mode=history&days=${days}` +
        (line ? `&line=${line}` : '');
      const data = await fetcher<ScheduleHistoryResponse>(path);

      const result = {
        days,
        method: 'schedule' as const,
        range: { from, to },
        line: line ?? 'all',
        snapshotCount: data.snapshotCount,
        averages: data.averages,
        lineTrends: data.lineTrends,
        degradedCount: data.degradedCount,
        avgCoverageRate: data.avgCoverageRate,
      };
      return { content: [{ type: 'text' as const, text: JSON.stringify(result) }] };
    }

    const adherencePath =
      `/api/adherence/history?from=${encodeURIComponent(from)}&to=${encodeURIComponent(to)}` +
      (line ? `&line=${line}` : '');
    const incidentsPath =
      `/api/incidents/history?from=${encodeURIComponent(from)}&to=${encodeURIComponent(to)}`;

    const [snapshots, incidentDocs] = await Promise.all([
      fetcher<AdherenceSnapshot[]>(adherencePath),
      fetcher<IncidentDoc[]>(incidentsPath),
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
    const seen = new Map<string, IncidentDoc>();
    for (const doc of incidentDocs ?? []) {
      if (!seen.has(doc.IncidentID)) seen.set(doc.IncidentID, doc);
    }

    let incidents = Array.from(seen.values());
    if (line) incidents = incidents.filter(i => lineInAffected(i.LinesAffected, line));

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

    return { content: [{ type: 'text' as const, text: JSON.stringify(result) }] };
  } catch (err) {
    if (err instanceof ApiError && err.status === 503) {
      return {
        isError: true as const,
        content: [{ type: 'text' as const, text: 'Schedule history requires GTFS_RAIL_TRIP_UPDATES=true' }],
      };
    }
    const msg = err instanceof ApiError ? `API error ${err.status}: ${err.message}` : String(err);
    return { content: [{ type: 'text' as const, text: JSON.stringify({ error: msg }) }], isError: true as const };
  }
}

export function registerServiceHistory(server: McpServer) {
  server.tool(
    'service_history',
    DESCRIPTION,
    {
      from: z.string().datetime({ offset: true }),
      to: z.string().datetime({ offset: true }),
      line: LINE_ENUM.optional(),
      method: z.enum(['headway', 'schedule']).default('headway').optional(),
    },
    (args) => serviceHistoryHandler(args),
  );
}
