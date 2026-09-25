import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { z } from 'zod';
import apiFetch, { ApiError, type Fetcher } from '../client.js';

const DESCRIPTION =
  'Current positions and schedule adherence for every train on a rail line.';

const LINE_ENUM = z.enum(['RD', 'BL', 'OR', 'SV', 'GR', 'YL']);
type Line = z.infer<typeof LINE_ENUM>;

interface Train {
  trainId: string;
  trainNumber: string;
  lineCode: string;
  directionNum: number;
  circuitId: number;
  currentSeq: number;
  expectedSeq: number;
  deviation: number;
  status: string;
  carCount: number;
}

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
  trains: Train[];
}

export async function liveTrainsHandler(
  { line }: { line: Line },
  fetcher: Fetcher = apiFetch,
) {
  try {
    const data = await fetcher<AdherenceLive>('/api/adherence/live');

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
    { line: LINE_ENUM },
    (args) => liveTrainsHandler(args),
  );
}
