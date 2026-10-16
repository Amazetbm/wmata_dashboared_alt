import { z } from 'zod';
import apiFetch, { ApiError } from '../client.js';
const DESCRIPTION = 'Current bus positions from the latest snapshot. ' +
    'With route_id: returns up to 50 buses on that route with coordinates, direction, headsign, and deviation. ' +
    'Without route_id: returns a summary of the top 20 most active routes with bus counts.';
export async function busPositionsHandler({ route_id }, fetcher = apiFetch) {
    try {
        const path = route_id
            ? `/api/bus/positions?route_id=${encodeURIComponent(route_id)}`
            : '/api/bus/positions';
        const data = await fetcher(path);
        return { content: [{ type: 'text', text: JSON.stringify(data) }] };
    }
    catch (err) {
        const msg = err instanceof ApiError ? `API error ${err.status}: ${err.message}` : String(err);
        return { content: [{ type: 'text', text: JSON.stringify({ error: msg }) }], isError: true };
    }
}
export function registerBusPositions(server) {
    server.tool('bus_positions', DESCRIPTION, { route_id: z.string().optional() }, (args) => busPositionsHandler(args));
}
