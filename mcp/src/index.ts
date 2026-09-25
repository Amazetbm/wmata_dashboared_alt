import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js';
import { registerNextArrivals } from './tools/next_arrivals.js';
import { registerLineStatus } from './tools/line_status.js';
import { registerAccessibilityStatus } from './tools/accessibility_status.js';
import { registerServiceHistory } from './tools/service_history.js';
import { registerLiveTrains } from './tools/live_trains.js';

const server = new McpServer({ name: 'wmata-dashboard', version: '1.0.0' });
registerNextArrivals(server);
registerLineStatus(server);
registerAccessibilityStatus(server);
registerServiceHistory(server);
registerLiveTrains(server);

await server.connect(new StdioServerTransport());
