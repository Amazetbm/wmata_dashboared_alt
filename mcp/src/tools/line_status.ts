import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { z } from 'zod';
import apiFetch, { ApiError, type Fetcher } from '../client.js';

const DESCRIPTION =
  'Current on-time performance and active incidents for one or all rail lines. Returns adherence counts and any active alerts.';

const LINE_ENUM = z.enum(['RD', 'BL', 'OR', 'SV', 'GR', 'YL']);
type Line = z.infer<typeof LINE_ENUM>;

interface LineSummary {
  lineCode: string;
  total: number;
  onTime: number;
  minor: number;
  significant: number;
}

interface AdherenceLive {
  snapshotAt: string;
  summary: { total: number; onTime: number; minor: number; significant: number };
  lineSummaries: LineSummary[];
}

interface Incident {
  IncidentID: string;
  Description: string;
  IncidentType: string;
  LinesAffected: string;
  DateUpdated: string;
}

interface IncidentsLive {
  Incidents: Incident[];
}

function lineInAffected(linesAffected: string, line: string): boolean {
  return linesAffected
    .split(';')
    .map(l => l.trim())
    .filter(Boolean)
    .includes(line);
}

export async function lineStatusHandler(
  { line }: { line?: Line },
  fetcher: Fetcher = apiFetch,
) {
  try {
    const [adherence, incidentsData] = await Promise.all([
      fetcher<AdherenceLive>('/api/adherence/live'),
      fetcher<IncidentsLive>('/api/incidents/live'),
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

    return { content: [{ type: 'text' as const, text: JSON.stringify(result) }] };
  } catch (err) {
    const msg = err instanceof ApiError ? `API error ${err.status}: ${err.message}` : String(err);
    return { content: [{ type: 'text' as const, text: JSON.stringify({ error: msg }) }], isError: true };
  }
}

export function registerLineStatus(server: McpServer) {
  server.tool(
    'line_status',
    DESCRIPTION,
    { line: LINE_ENUM.optional() },
    (args) => lineStatusHandler(args),
  );
}
