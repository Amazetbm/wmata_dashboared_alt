import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { z } from 'zod';
import apiFetch, { ApiError, type Fetcher } from '../client.js';

const DESCRIPTION =
  'Current positions and schedule adherence for trains on a rail line. ' +
  'Returns station-relative location (e.g. "at Metro Center (A01)", "between Foggy Bottom and Rosslyn"), ' +
  'destination name, and occupancy when available for each train, plus a line adherence summary. ' +
  'Occupancy bands: "Many seats (<20% full)", "Few seats (20–32% full)", "Full (≥33% full)". ' +
  'Occupancy is null when the GTFS-RT feed is disabled or stale. ' +
  'Omit line to get all lines.';

const LINE_ENUM = z.enum(['RD', 'BL', 'OR', 'SV', 'GR', 'YL']);
type Line = z.infer<typeof LINE_ENUM>;

interface Train {
  trainId: string;
  lineCode: string;
  carCount: number;
  status: string;
  location: string;
  destination: string;
  occupancy?: { status: number; label: string | null } | null;
}

interface TrainsLocated {
  snapshotAt: string;
  summary: object;
  lineSummaries: object[];
  trains: Train[];
}

export async function liveTrainsHandler(
  { line }: { line?: Line },
  fetcher: Fetcher = apiFetch,
) {
  try {
    const path = line
      ? `/api/trains/located?line=${encodeURIComponent(line)}`
      : '/api/trains/located';
    const data = await fetcher<TrainsLocated>(path);

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
        ...(t.occupancy !== undefined ? { occupancy: t.occupancy } : {}),
      })),
    };

    return { content: [{ type: 'text' as const, text: JSON.stringify(result) }] };
  } catch (err) {
    const msg = err instanceof ApiError ? `API error ${err.status}: ${err.message}` : String(err);
    return { content: [{ type: 'text' as const, text: JSON.stringify({ error: msg }) }], isError: true };
  }
}

export function registerLiveTrains(server: McpServer) {
  server.tool(
    'live_trains',
    DESCRIPTION,
    { line: LINE_ENUM.optional() },
    (args) => liveTrainsHandler(args),
  );
}
