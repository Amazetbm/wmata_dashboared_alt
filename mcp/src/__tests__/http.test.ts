/**
 * Integration tests for the MCP HTTP server (mcp/src/server/http.ts).
 *
 * A real HTTP server is started on a random port (0) in beforeAll and torn
 * down in afterAll.
 *
 * Note: @hono/node-server (used internally by the MCP SDK transport) sets
 * Transfer-Encoding:chunked in the response header but writes plain unchunked
 * bytes into the socket — a known quirk with Node.js 20+.  The standard
 * node:http client rejects such responses as malformed.  We use node:net to
 * send raw HTTP/1.1 requests and parse responses ourselves, bypassing the
 * HTTP parser entirely.
 */

import { startHttpServer } from '../server/http.js';
import { createConnection } from 'node:net';

const TOKEN = 'test-secret-token-abc123';

interface ServerHandle {
  port: number;
  close: () => Promise<void>;
}

let server: ServerHandle;
let port: number;

// ── Raw HTTP client ───────────────────────────────────────────────────────────
// Sends a raw HTTP/1.1 request over TCP and returns the parsed status + body.
// This bypasses node:http's chunked-encoding parser, which rejects responses
// from @hono/node-server that include Transfer-Encoding:chunked headers but
// write plain JSON bodies.

interface RawResponse {
  status: number;
  body: string;
  json<T = unknown>(): T;
}

function decodeChunked(raw: string): string {
  let out = '';
  let pos = 0;
  while (pos < raw.length) {
    const crlfPos = raw.indexOf('\r\n', pos);
    if (crlfPos === -1) break;
    const sizeHex = raw.slice(pos, crlfPos).trim();
    const size = parseInt(sizeHex, 16);
    if (isNaN(size) || size === 0) break;
    out += raw.slice(crlfPos + 2, crlfPos + 2 + size);
    pos = crlfPos + 2 + size + 2; // skip chunk + trailing CRLF
  }
  return out;
}

function rawHttp(opts: {
  method: string;
  path: string;
  headers?: Record<string, string>;
  body?: string;
}): Promise<RawResponse> {
  return new Promise((resolve, reject) => {
    const bodyBytes = opts.body ? Buffer.from(opts.body, 'utf8') : null;

    const headerLines: string[] = [
      `${opts.method} ${opts.path} HTTP/1.1`,
      `Host: 127.0.0.1:${port}`,
      `Connection: close`,
    ];
    if (bodyBytes) {
      headerLines.push(`Content-Type: application/json`);
      headerLines.push(`Accept: application/json, text/event-stream`);
      headerLines.push(`Content-Length: ${bodyBytes.length}`);
    }
    for (const [k, v] of Object.entries(opts.headers ?? {})) {
      headerLines.push(`${k}: ${v}`);
    }
    headerLines.push('', ''); // blank line + empty string join gives trailing CRLF

    const rawRequest = Buffer.concat([
      Buffer.from(headerLines.join('\r\n'), 'utf8'),
      bodyBytes ?? Buffer.alloc(0),
    ]);

    const chunks: Buffer[] = [];
    const sock = createConnection({ host: '127.0.0.1', port }, () => {
      sock.write(rawRequest);
    });

    sock.on('data', (c: Buffer) => chunks.push(c));
    sock.on('error', reject);
    sock.on('end', () => {
      const raw = Buffer.concat(chunks).toString('latin1');
      const headerEnd = raw.indexOf('\r\n\r\n');
      if (headerEnd === -1) { reject(new Error('No header boundary found')); return; }

      const headerSection = raw.slice(0, headerEnd);
      const statusLine = headerSection.split('\r\n')[0] ?? '';
      const statusMatch = statusLine.match(/^HTTP\/\S+\s+(\d+)/);
      const status = statusMatch ? parseInt(statusMatch[1], 10) : 0;

      // Body: everything after headers.
      // Responses from our own res.end() use proper HTTP/1.1 chunked encoding.
      // Responses from @hono/node-server include Transfer-Encoding:chunked header
      // but write raw unchunked bytes — so we must handle both formats.
      const rawBody = raw.slice(headerEnd + 4);
      let body: string;
      if (/^[0-9a-fA-F]+\r\n/.test(rawBody)) {
        // Properly chunked: decode all chunks
        body = decodeChunked(rawBody);
      } else {
        // Unchunked raw body (hono quirk): strip any trailing chunk terminator
        body = rawBody.replace(/\r?\n?0\r\n\r\n$/, '').trimEnd();
      }

      resolve({
        status,
        body,
        json<T>(): T { return JSON.parse(body) as T; },
      });
    });
  });
}

function post(path: string, body: string, headers: Record<string, string> = {}): Promise<RawResponse> {
  return rawHttp({ method: 'POST', path, headers, body });
}

function get(path: string, headers: Record<string, string> = {}): Promise<RawResponse> {
  return rawHttp({ method: 'GET', path, headers });
}

function del(path: string, headers: Record<string, string> = {}): Promise<RawResponse> {
  return rawHttp({ method: 'DELETE', path, headers });
}

// ── JSON-RPC helpers ──────────────────────────────────────────────────────────

function rpc(method: string, params: unknown = {}, id: number | string = 1) {
  return JSON.stringify({ jsonrpc: '2.0', id, method, params });
}

// ── Setup / teardown ──────────────────────────────────────────────────────────

beforeAll(async () => {
  process.env.MCP_AUTH_TOKEN = TOKEN;
  // Point at a non-listening port so tool calls fail gracefully (isError: true)
  process.env.API_BASE_URL = 'http://127.0.0.1:19999';
  delete process.env.MCP_ALLOWED_ORIGINS;

  server = await startHttpServer(0);
  port = server.port;
});

afterAll(async () => {
  await server.close();
});

// ── Health endpoint ───────────────────────────────────────────────────────────

describe('GET /health', () => {
  it('returns 200 { ok: true } without auth', async () => {
    const res = await get('/health');
    expect(res.status).toBe(200);
    expect(res.json()).toEqual({ ok: true });
  });
});

// ── Auth enforcement ──────────────────────────────────────────────────────────

describe('POST /mcp auth', () => {
  it('returns 401 when no Authorization header', async () => {
    const res = await post('/mcp', rpc('initialize', {}));
    expect(res.status).toBe(401);
    const body = res.json() as { error: string };
    expect(body.error).toBe('Unauthorized');
  });

  it('returns 401 for wrong token', async () => {
    const res = await post('/mcp', rpc('initialize', {}), {
      Authorization: 'Bearer wrong-token',
    });
    expect(res.status).toBe(401);
  });
});

// ── Origin enforcement ────────────────────────────────────────────────────────

describe('POST /mcp origin', () => {
  beforeEach(() => {
    process.env.MCP_ALLOWED_ORIGINS = 'http://allowed.example.com';
  });
  afterEach(() => {
    delete process.env.MCP_ALLOWED_ORIGINS;
  });

  it('returns 403 when Origin is not in allowed list', async () => {
    const res = await post('/mcp', rpc('initialize', {}), {
      Authorization: `Bearer ${TOKEN}`,
      Origin: 'http://evil.example.com',
    });
    expect(res.status).toBe(403);
  });

  it('allows request with no Origin header (CLI client)', async () => {
    const res = await post('/mcp', rpc('initialize', {
      protocolVersion: '2024-11-05',
      capabilities: {},
      clientInfo: { name: 'test', version: '1' },
    }), {
      Authorization: `Bearer ${TOKEN}`,
    });
    expect(res.status).toBe(200);
  });
});

// ── MCP round-trip ────────────────────────────────────────────────────────────

describe('MCP protocol round-trip', () => {
  const authHeaders = { Authorization: `Bearer ${TOKEN}` };

  it('initialize succeeds with valid token and no Origin', async () => {
    const res = await post('/mcp', rpc('initialize', {
      protocolVersion: '2024-11-05',
      capabilities: {},
      clientInfo: { name: 'test-client', version: '0.0.1' },
    }), authHeaders);

    expect(res.status).toBe(200);
    const body = res.json() as { result?: { serverInfo?: { name: string } } };
    expect(body.result?.serverInfo?.name).toBe('wmata-dashboard');
  });

  it('tools/list returns exactly 5 tools', async () => {
    const res = await post('/mcp', rpc('tools/list', {}, 2), authHeaders);

    expect(res.status).toBe(200);
    const body = res.json() as { result?: { tools: { name: string }[] } };
    const tools = body.result?.tools ?? [];
    expect(tools).toHaveLength(5);

    const names = tools.map((t: { name: string }) => t.name).sort();
    expect(names).toEqual([
      'accessibility_status',
      'line_status',
      'live_trains',
      'next_arrivals',
      'service_history',
    ]);
  });

  it('tools/call with unreachable API returns isError response (not 5xx)', async () => {
    const res = await post('/mcp', rpc('tools/call', {
      name: 'next_arrivals',
      arguments: { stationCode: 'A01' },
    }, 3), authHeaders);

    // MCP-level errors come back as HTTP 200 with isError in the result
    expect(res.status).toBe(200);
    const body = res.json() as { result?: { isError?: boolean } };
    expect(body.result?.isError).toBe(true);
  });
});

// ── GET /mcp — not supported in stateless mode ────────────────────────────────

describe('unsupported methods', () => {
  it('GET /mcp returns 405', async () => {
    const res = await get('/mcp', { Authorization: `Bearer ${TOKEN}` });
    expect(res.status).toBe(405);
  });

  it('DELETE /mcp returns 405', async () => {
    const res = await del('/mcp', { Authorization: `Bearer ${TOKEN}` });
    expect(res.status).toBe(405);
  });
});
