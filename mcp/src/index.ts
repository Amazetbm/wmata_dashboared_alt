import { createServer } from './factory.js';

export { createServer };

const transport = process.env.MCP_TRANSPORT ?? 'http';

if (transport === 'stdio') {
  const { StdioServerTransport } = await import('@modelcontextprotocol/sdk/server/stdio.js');
  await createServer().connect(new StdioServerTransport());
} else {
  const { startHttpServer } = await import('./server/http.js');
  await startHttpServer();
}
