import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { z } from 'zod';
import apiFetch, { ApiError, type Fetcher } from '../client.js';

const DESCRIPTION =
  'Next-train arrivals at a WMATA station. Returns minutes-to-arrival, line, destination, and car count.';

interface TrainPrediction {
  Car: string;
  Destination: string;
  DestinationName: string;
  Line: string;
  Min: string;
}

interface PredictionsResponse {
  Trains: TrainPrediction[];
}

export async function nextArrivalsHandler(
  { stationCode }: { stationCode: string },
  fetcher: Fetcher = apiFetch,
) {
  try {
    const data = await fetcher<PredictionsResponse>(`/api/predictions/${stationCode}`);
    const arrivals = (data.Trains ?? []).map(t => ({
      minutes: t.Min,
      line: t.Line,
      destination: t.DestinationName || t.Destination,
      cars: t.Car,
    }));
    return { content: [{ type: 'text' as const, text: JSON.stringify(arrivals) }] };
  } catch (err) {
    const msg = err instanceof ApiError ? `API error ${err.status}: ${err.message}` : String(err);
    return { content: [{ type: 'text' as const, text: JSON.stringify({ error: msg }) }], isError: true };
  }
}

export function registerNextArrivals(server: McpServer) {
  server.tool(
    'next_arrivals',
    DESCRIPTION,
    { stationCode: z.string() },
    (args) => nextArrivalsHandler(args),
  );
}
