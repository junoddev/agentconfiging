/**
 * Minimal node:http ↔ fetch bridge (agentconfig-gxo.2).
 *
 * Hono exposes a fetch-style handler; @hono/node-server is deliberately NOT
 * a dependency, so this ~60-line bridge adapts IncomingMessage → Request and
 * Response → ServerResponse. The Request URL is always built against the
 * server's OWN loopback origin — the client-controlled Host header is never
 * used to construct URLs (it is still forwarded as a header for the app's
 * Host allowlist check).
 */

import { Readable } from 'node:stream';
import type { IncomingMessage, ServerResponse } from 'node:http';

export type FetchHandler = (request: Request) => Response | Promise<Response>;

/**
 * True only for origin-form targets ("/path...") that cannot resolve to a
 * foreign host. Rejects missing targets, non-"/" (absolute/authority-form),
 * and protocol-relative "//" or "/\" (WHATWG treats "\" as "/", so "/\host"
 * becomes "//host" → host=host).
 */
function isSafeTarget(target: string | undefined): target is string {
  if (!target || target[0] !== '/') return false;
  const second = target[1];
  return second !== '/' && second !== '\\';
}

/** True if the request carried more than one Host header (raw wire order). */
function hasDuplicateHost(req: IncomingMessage): boolean {
  let count = 0;
  const raw = req.rawHeaders;
  for (let i = 0; i < raw.length; i += 2) {
    if (raw[i]?.toLowerCase() === 'host' && ++count > 1) return true;
  }
  return false;
}

/**
 * Methods the fetch `Request` constructor accepts. TRACE/CONNECT/TRACK are
 * fetch-FORBIDDEN and would THROW inside `new Request()`, turning a hostile
 * client request into a 500 + an unauthenticated stderr line per hit (a
 * log-flood vector) while also skipping the Host gate. We reject them at the
 * door with a quiet 405 instead — no Request is ever constructed.
 */
const SUPPORTED_METHODS = new Set(['GET', 'HEAD', 'POST', 'PUT', 'DELETE', 'PATCH', 'OPTIONS']);

function toWebRequest(req: IncomingMessage, base: string): Request {
  const headers = new Headers();
  for (const [name, value] of Object.entries(req.headers)) {
    if (value === undefined) continue;
    if (Array.isArray(value)) for (const v of value) headers.append(name, v);
    else headers.set(name, value);
  }
  const url = new URL(req.url ?? '/', base);
  const init: RequestInit & { duplex?: 'half' } = { method: req.method ?? 'GET', headers };
  if (req.method !== 'GET' && req.method !== 'HEAD') {
    init.body = Readable.toWeb(req) as unknown as ReadableStream;
    init.duplex = 'half';
  }
  return new Request(url, init);
}

async function writeResponse(response: Response, res: ServerResponse): Promise<void> {
  const headers: Record<string, string> = {};
  response.headers.forEach((value, key) => {
    headers[key] = value;
  });
  const body = Buffer.from(await response.arrayBuffer());
  res.writeHead(response.status, headers);
  res.end(body);
}

/**
 * Handle one node:http request via the fetch handler. Never throws: failures
 * become a plain 500 with a constant body; details go to stderr only.
 */
export async function handleRequest(
  handler: FetchHandler,
  req: IncomingMessage,
  res: ServerResponse,
  origin: string,
): Promise<void> {
  try {
    // Only origin-form request targets ("/path") are served. Reject:
    //  - absolute-form / authority-form (no leading "/"): proxy-style targets
    //    that smuggle a foreign host into the URL;
    //  - protocol-relative targets ("//evil.com/..." and "/\evil.com/...",
    //    which WHATWG backslash-normalizes to "//"): `new URL` resolves those
    //    to host=evil.com, falsifying the "URL is always the loopback origin"
    //    invariant that Host/Origin checks and future redirects rely on;
    //  - duplicate Host headers (RFC 9112 §3.2): node keeps the first and
    //    silently drops the rest, so an attacker's second Host would evade
    //    the app's Host allowlist — reject outright.
    if (!isSafeTarget(req.url) || hasDuplicateHost(req)) {
      res.writeHead(400, { 'content-type': 'application/json' });
      res.end(JSON.stringify({ error: 'bad request' }));
      return;
    }
    // Validate the method BEFORE constructing the Request: forbidden methods
    // (TRACE/CONNECT/...) throw in `new Request()`. Quiet 405, no logging —
    // client-triggered bad input must not spew to stderr.
    if (!SUPPORTED_METHODS.has((req.method ?? 'GET').toUpperCase())) {
      res.writeHead(405, { 'content-type': 'application/json' });
      res.end(JSON.stringify({ error: 'method not allowed' }));
      return;
    }
    const request = toWebRequest(req, origin);
    // Belt-and-suspenders: the parsed URL's host MUST be our own loopback
    // origin. Any divergence means a smuggled host slipped past the target
    // check above — fail closed rather than route it.
    if (new URL(request.url).host !== new URL(origin).host) {
      res.writeHead(400, { 'content-type': 'application/json' });
      res.end(JSON.stringify({ error: 'bad request' }));
      return;
    }
    const response = await handler(request);
    await writeResponse(response, res);
  } catch (err) {
    console.error(`agentconfiging server: request failed: ${String(err)}`);
    if (!res.headersSent) {
      res.writeHead(500, { 'content-type': 'application/json' });
    }
    res.end(JSON.stringify({ error: 'internal error' }));
  }
}
