import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { registerAllTools } from './tools/index.js';

export function createServer(): McpServer {
  const server = new McpServer({ name: 'wmata-dashboard', version: '1.0.0' });
  registerAllTools(server);
  return server;
}
