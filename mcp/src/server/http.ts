import { createServer as createHttpServer, IncomingMessage, ServerResponse } from 'node:http';
import type { AddressInfo } from 'node:net';
import { timingSafeEqual } from 'node:crypto';
import { StreamableHTTPServerTransport } from '@modelcontextprotocol/sdk/server/streamableHttp.js';
import { createServer } from '../factory.js';

// ── Rate limiter ──────────────────────────────────────────────────────────────

interface RateBucket { count: number; resetAt: number; }
const rateBuckets = new Map<string, RateBucket>();
const RATE_LIMIT = 60;
const RATE_WINDOW_MS = 60_000;

function getClientIp(req: IncomingMessage): string {
  const header = req.headers['x-real-ip'];
  if (typeof header === 'string' && header) return header;
  return req.socket.remoteAddress ?? 'unknown';
}

function checkRateLimit(ip: string): boolean {
  const now = Date.now();
  let bucket = rateBuckets.get(ip);
  if (!bucket || now >= bucket.resetAt) {
    bucket = { count: 0, resetAt: now + RATE_WINDOW_MS };
    rateBuckets.set(ip, bucket);
  }
  bucket.count++;
  return bucket.count <= RATE_LIMIT;
}

function rateLimitResetSeconds(ip: string): number {
  const bucket = rateBuckets.get(ip);
  if (!bucket) return RATE_WINDOW_MS / 1000;
  return Math.ceil((bucket.resetAt - Date.now()) / 1000);
}

// ── Auth ──────────────────────────────────────────────────────────────────────

function checkAuth(req: IncomingMessage, expected: string): boolean {
  const authHeader = req.headers['authorization'] ?? '';
  const prefix = 'Bearer ';
  if (!authHeader.startsWith(prefix)) return false;
  const provided = authHeader.slice(prefix.length);

  // Pad both to same length to prevent length-based side channels
  const a = Buffer.from(provided.padEnd(Math.max(provided.length, expected.length)));
  const b = Buffer.from(expected.padEnd(Math.max(provided.length, expected.length)));
  return timingSafeEqual(a, b) && provided.length === expected.length;
}

// ── Origin check ──────────────────────────────────────────────────────────────

function parseAllowedOrigins(): string[] {
  const raw = process.env.MCP_ALLOWED_ORIGINS ?? '';
  return raw ? raw.split(',').map(o => o.trim()).filter(Boolean) : [];
}

function checkOrigin(req: IncomingMessage, allowedOrigins: string[]): boolean {
  if (allowedOrigins.length === 0) return true; // allow all
  const origin = req.headers['origin'];
  if (!origin) return true; // CLI clients don't send Origin
  return allowedOrigins.includes(origin);
}

// ── Body reader ───────────────────────────────────────────────────────────────

function readBody(req: IncomingMessage): Promise<unknown> {
  return new Promise((resolve, reject) => {
    const chunks: Buffer[] = [];
    req.on('data', (chunk: Buffer) => chunks.push(chunk));
    req.on('end', () => {
      const raw = Buffer.concat(chunks).toString('utf8');
      if (!raw) { resolve(undefined); return; }
      try { resolve(JSON.parse(raw)); } catch { resolve(raw); }
    });
    req.on('error', reject);
  });
}

// ── HTTP server ───────────────────────────────────────────────────────────────

export function startHttpServer(port = parseInt(process.env.MCP_PORT ?? '3001', 10)): Promise<{ port: number; close: () => Promise<void> }> {
  const token = process.env.MCP_AUTH_TOKEN;
  if (!token) {
    console.error('MCP_AUTH_TOKEN is required for HTTP transport. Set it or use MCP_TRANSPORT=stdio.');
    process.exit(1);
  }

  const httpServer = createHttpServer(async (req: IncomingMessage, res: ServerResponse) => {
    // Re-read per request so tests (and live config reloads) can change the env var.
    const allowedOrigins = parseAllowedOrigins();
    const ip = getClientIp(req);

    // 1. Rate limit (applied to all routes)
    if (!checkRateLimit(ip)) {
      res.writeHead(429, {
        'Content-Type': 'application/json',
        'Retry-After': String(rateLimitResetSeconds(ip)),
      });
      res.end(JSON.stringify({ error: 'Too Many Requests' }));
      return;
    }

    // 2. Health endpoint — auth exempt
    if (req.method === 'GET' && req.url === '/health') {
      res.writeHead(200, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ ok: true }));
      return;
    }

    // 3. Auth (all other routes require Bearer token)
    if (!checkAuth(req, token)) {
      res.writeHead(401, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ error: 'Unauthorized' }));
      return;
    }

    // 4. Origin check
    if (!checkOrigin(req, allowedOrigins)) {
      res.writeHead(403, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ error: 'Forbidden' }));
      return;
    }

    // 5. MCP routing
    if (req.url === '/mcp') {
      if (req.method === 'POST') {
        const mcpServer = createServer();
        const transport = new StreamableHTTPServerTransport({
          sessionIdGenerator: undefined, // stateless mode
          enableJsonResponse: true,
        });
        await mcpServer.connect(transport);
        const body = await readBody(req);
        await transport.handleRequest(req, res, body);
        return;
      }
      // GET and DELETE are not meaningful in stateless mode
      res.writeHead(405, { Allow: 'POST' });
      res.end();
      return;
    }

    res.writeHead(404);
    res.end();
  });

  return new Promise((resolve) => {
    httpServer.listen(port, () => {
      const address = httpServer.address() as AddressInfo;
      console.log(`MCP HTTP server on :${address.port}`);
      resolve({
        port: address.port,
        close: () => new Promise<void>((res, rej) => httpServer.close(err => err ? rej(err) : res())),
      });
    });
  });
}
