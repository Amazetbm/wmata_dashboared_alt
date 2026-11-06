import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { z } from 'zod';
import apiFetch, { ApiError, type Fetcher } from '../client.js';

const DESCRIPTION =
  'Live schedule adherence for WMATA rail, powered by GTFS-RT trip updates. ' +
  'Returns on-time percentage (excluding trains with no GTFS-RT prediction), ' +
  'coverage rate, degraded flag, per-line breakdown, and the 10 most-delayed trains. ' +
  'Requires GTFS_RAIL_TRIP_UPDATES=true on the server; returns an error if disabled. ' +
  'scheduleDelay.seconds is positive for late trains, negative for early trains. ' +
  'Omit line to get all lines.';

const LINE_ENUM = z.enum(['RD', 'BL', 'OR', 'SV', 'YL', 'GR']);
type Line = z.infer<typeof LINE_ENUM>;

interface LiveScheduleResponse {
  snapshotAt: string;
  coverageRate: number;
  degraded: boolean;
  summary: {
    total: number;
    onTime: number;
    early: number;
    minor: number;
    significant: number;
    noPrediction: number;
    canceled?: number;
    unscheduled?: number;
    added?: number;
  };
  lineSummaries: Array<{
    lineCode: string;
    total: number;
    onTime: number;
    early: number;
    minor: number;
    significant: number;
    noPrediction: number;
  }>;
  trains: Array<{
    trainId: string;
    lineCode: string;
    tripId?: string;
    scheduleDelay?: { seconds: number; label: string } | null;
  }>;
}

export async function scheduleAdherenceHandler(
  { line }: { line?: Line },
  fetcher: Fetcher = apiFetch,
) {
  try {
    const path = '/api/adherence/summary?method=schedule&mode=live' +
      (line ? `&line=${encodeURIComponent(line)}` : '');
    const data = await fetcher<LiveScheduleResponse>(path);

    const s = data.summary;
    const predictedTotal = (s.early ?? 0) + (s.onTime ?? 0) + (s.minor ?? 0) + (s.significant ?? 0);
    const onTimePct = predictedTotal > 0
      ? Math.round((s.onTime / predictedTotal) * 100)
      : null;

    const byLine = (data.lineSummaries ?? []).map(ls => {
      const linePredicted = (ls.early ?? 0) + (ls.onTime ?? 0) + (ls.minor ?? 0) + (ls.significant ?? 0);
      return {
        lineCode: ls.lineCode,
        total: ls.total,
        onTimePct: linePredicted > 0 ? Math.round((ls.onTime / linePredicted) * 100) : null,
        minor: ls.minor ?? 0,
        significant: ls.significant ?? 0,
      };
    });

    const mostDelayed = (data.trains ?? [])
      .filter(t => t.scheduleDelay != null && t.scheduleDelay!.seconds != null)
      .sort((a, b) => b.scheduleDelay!.seconds - a.scheduleDelay!.seconds)
      .slice(0, 10)
      .map(t => ({
        trainId: t.trainId,
        lineCode: t.lineCode,
        tripId: t.tripId ?? null,
        delaySeconds: t.scheduleDelay!.seconds,
        delayLabel: t.scheduleDelay!.label,
      }));

    const result = {
      asOf: data.snapshotAt,
      coverageRate: data.coverageRate,
      degraded: data.degraded,
      summary: {
        total: s.total,
        onTime: s.onTime,
        early: s.early,
        minor: s.minor,
        significant: s.significant,
        noPrediction: s.noPrediction,
        onTimePct,
      },
      byLine,
      mostDelayed,
    };

    return { content: [{ type: 'text' as const, text: JSON.stringify(result) }] };
  } catch (err) {
    if (err instanceof ApiError && err.status === 503) {
      return {
        isError: true as const,
        content: [{ type: 'text' as const, text: 'Schedule adherence requires GTFS_RAIL_TRIP_UPDATES=true' }],
      };
    }
    const msg = err instanceof ApiError ? `API error ${err.status}: ${err.message}` : String(err);
    return { content: [{ type: 'text' as const, text: JSON.stringify({ error: msg }) }], isError: true as const };
  }
}

export function registerScheduleAdherence(server: McpServer) {
  server.tool(
    'schedule_adherence',
    DESCRIPTION,
    { line: LINE_ENUM.optional() },
    (args) => scheduleAdherenceHandler(args),
  );
}
