import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { registerNextArrivals } from './next_arrivals.js';
import { registerLineStatus } from './line_status.js';
import { registerAccessibilityStatus } from './accessibility_status.js';
import { registerServiceHistory } from './service_history.js';
import { registerLiveTrains } from './live_trains.js';

export function registerAllTools(server: McpServer): void {
  registerNextArrivals(server);
  registerLineStatus(server);
  registerAccessibilityStatus(server);
  registerServiceHistory(server);
  registerLiveTrains(server);
}
