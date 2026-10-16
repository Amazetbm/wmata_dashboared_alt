import { z } from 'zod';
import apiFetch, { ApiError } from '../client.js';
const DESCRIPTION = 'Next-train arrivals at a WMATA station. Returns minutes-to-arrival, line, destination, and car count.';
export async function nextArrivalsHandler({ stationCode }, fetcher = apiFetch) {
    try {
        const data = await fetcher(`/api/predictions/${stationCode}`);
        const arrivals = (data.Trains ?? []).map(t => ({
            minutes: t.Min,
            line: t.Line,
            destination: t.DestinationName || t.Destination,
            cars: t.Car,
        }));
        return { content: [{ type: 'text', text: JSON.stringify(arrivals) }] };
    }
    catch (err) {
        const msg = err instanceof ApiError ? `API error ${err.status}: ${err.message}` : String(err);
        return { content: [{ type: 'text', text: JSON.stringify({ error: msg }) }], isError: true };
    }
}
export function registerNextArrivals(server) {
    server.tool('next_arrivals', DESCRIPTION, { stationCode: z.string() }, (args) => nextArrivalsHandler(args));
}
