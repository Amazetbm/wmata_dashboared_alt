import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { z } from 'zod';
import apiFetch, { ApiError, type Fetcher } from '../client.js';

const DESCRIPTION =
  'Live schedule adherence for WMATA Metrobus, powered by GTFS-RT trip updates. ' +
  'Returns on-time percentage (WMATA definition: 2 min early to 7 min late, measured at timepoints), ' +
  'coverage rate, degraded flag, per-route breakdown, and the 10 most-delayed buses. ' +
  'Requires GTFS_BUS_TRIP_UPDATES=true on the server. ' +
  'delaySeconds is positive for late, negative for early. ' +
  'Omit route for all routes.';

interface LiveBusAdherenceResponse {
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
  routeSummaries: Array<{
    routeId: string;
    total: number;
    onTime: number;
    early: number;
    minor: number;
    significant: number;
    noPrediction: number;
  }>;
  buses: Array<{
    vehicleId: string;
    routeId: string;
    tripId?: string;
    delaySeconds: number | null;
    delayLabel: string | null;
  }>;
}

export async function busScheduleAdherenceHandler(
  { route }: { route?: string },
  fetcher: Fetcher = apiFetch,
) {
  try {
    const path = '/api/bus/adherence/summary?method=schedule&mode=live' +
      (route ? `&route=${encodeURIComponent(route)}` : '');
    const data = await fetcher<LiveBusAdherenceResponse>(path);

    const s = data.summary;
    const predictedTotal = (s.early ?? 0) + (s.onTime ?? 0) + (s.minor ?? 0) + (s.significant ?? 0);
    const onTimePct = predictedTotal > 0
      ? Math.round((s.onTime / predictedTotal) * 100)
      : null;

    const byRoute = (data.routeSummaries ?? []).map(rs => {
      const routePredicted = (rs.early ?? 0) + (rs.onTime ?? 0) + (rs.minor ?? 0) + (rs.significant ?? 0);
      return {
        routeId: rs.routeId,
        total: rs.total,
        onTimePct: routePredicted > 0 ? Math.round((rs.onTime / routePredicted) * 100) : null,
        minor: rs.minor ?? 0,
        significant: rs.significant ?? 0,
      };
    });

    const mostDelayed = (data.buses ?? [])
      .filter(b => b.delaySeconds != null)
      .sort((a, b) => (b.delaySeconds ?? 0) - (a.delaySeconds ?? 0))
      .slice(0, 10)
      .map(b => ({
        vehicleId: b.vehicleId,
        routeId: b.routeId,
        tripId: b.tripId ?? null,
        delaySeconds: b.delaySeconds,
        delayLabel: b.delayLabel,
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
      byRoute,
      mostDelayed,
    };

    return { content: [{ type: 'text' as const, text: JSON.stringify(result) }] };
  } catch (err) {
    if (err instanceof ApiError && err.status === 503) {
      return {
        isError: true as const,
        content: [{ type: 'text' as const, text: 'Bus schedule adherence requires GTFS_BUS_TRIP_UPDATES=true and GTFS_BUS_SCHEDULE=true' }],
      };
    }
    const msg = err instanceof ApiError ? `API error ${err.status}: ${err.message}` : String(err);
    return { content: [{ type: 'text' as const, text: JSON.stringify({ error: msg }) }], isError: true as const };
  }
}

export function registerBusScheduleAdherence(server: McpServer) {
  server.tool(
    'bus_schedule_adherence',
    DESCRIPTION,
    { route: z.string().optional() },
    (args) => busScheduleAdherenceHandler(args),
  );
}
