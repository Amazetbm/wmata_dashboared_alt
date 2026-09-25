import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { z } from 'zod';
import apiFetch, { ApiError, type Fetcher } from '../client.js';

const DESCRIPTION =
  'Live elevator and escalator outages at WMATA stations. Filter by station code or unit type.';

const UNIT_TYPE_ENUM = z.enum(['ELEVATOR', 'ESCALATOR']);

interface OutageRecord {
  UnitName: string;
  UnitType: string;
  StationCode: string;
  StationName: string;
  LocationDescription: string;
  SymptomDescription: string;
  TimeOutOfService: string;
  EstimatedReturnToService: string | null;
  DateUpdated: string;
}

export async function accessibilityStatusHandler(
  { stationCode, unitType }: { stationCode?: string; unitType?: 'ELEVATOR' | 'ESCALATOR' },
  fetcher: Fetcher = apiFetch,
) {
  try {
    const data = await fetcher<OutageRecord[]>('/api/outages');

    let outages = data ?? [];
    if (stationCode) outages = outages.filter(o => o.StationCode === stationCode);
    if (unitType) outages = outages.filter(o => o.UnitType === unitType);

    const mapped = outages.map(o => ({
      unit: o.UnitName,
      type: o.UnitType,
      station: o.StationName,
      stationCode: o.StationCode,
      location: o.LocationDescription,
      symptom: o.SymptomDescription,
      outSince: o.TimeOutOfService,
      estReturn: o.EstimatedReturnToService,
    }));

    const result = { count: mapped.length, outages: mapped };
    return { content: [{ type: 'text' as const, text: JSON.stringify(result) }] };
  } catch (err) {
    const msg = err instanceof ApiError ? `API error ${err.status}: ${err.message}` : String(err);
    return { content: [{ type: 'text' as const, text: JSON.stringify({ error: msg }) }], isError: true };
  }
}

export function registerAccessibilityStatus(server: McpServer) {
  server.tool(
    'accessibility_status',
    DESCRIPTION,
    { stationCode: z.string().optional(), unitType: UNIT_TYPE_ENUM.optional() },
    (args) => accessibilityStatusHandler(args),
  );
}
