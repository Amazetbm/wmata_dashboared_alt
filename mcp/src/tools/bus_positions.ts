import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { z } from 'zod';
import apiFetch, { ApiError, type Fetcher } from '../client.js';

const DESCRIPTION =
  'Current bus positions from the latest snapshot. ' +
  'With route_id: returns up to 50 buses on that route with coordinates, direction, headsign, deviation, ' +
  'and occupancy when available (null if GTFS feed disabled or stale). ' +
  'Bus occupancy bands: Many seats = <25% full, Few seats = 25–49% full, Full = ≥50% full. ' +
  'Without route_id: returns a summary of the top 20 most active routes with bus counts; ' +
  'each route may include a crowding breakdown {many, few, full, unknown} when the bus GTFS feed is enabled.';

export async function busPositionsHandler(
  { route_id }: { route_id?: string },
  fetcher: Fetcher = apiFetch,
) {
  try {
    const path = route_id
      ? `/api/bus/positions?route_id=${encodeURIComponent(route_id)}`
      : '/api/bus/positions';
    const data = await fetcher<unknown>(path);
    return { content: [{ type: 'text' as const, text: JSON.stringify(data) }] };
  } catch (err) {
    const msg = err instanceof ApiError ? `API error ${err.status}: ${err.message}` : String(err);
    return { content: [{ type: 'text' as const, text: JSON.stringify({ error: msg }) }], isError: true };
  }
}

export function registerBusPositions(server: McpServer) {
  server.tool(
    'bus_positions',
    DESCRIPTION,
    { route_id: z.string().optional() },
    (args) => busPositionsHandler(args),
  );
}
