/**
 * Local control-center server entry point (SPEC §4.3, agentconfig-gxo.2).
 *
 * `startServer` binds 127.0.0.1 ONLY (loopback; a non-loopback `host` is
 * rejected) on an OS-assigned ephemeral port by default (`port: 0`), and
 * serves the Hono app from ./app.js over the node:http ↔ fetch bridge in
 * ./bridge.js. See app.js for the full security model (Host/Origin
 * allowlists, constant-time bearer token, no CORS, traversal-proof static).
 *
 * TOKEN FLOW / URL PATTERN (the contract the web UI bead builds against):
 * a per-session token is generated here with crypto.randomBytes(32) and
 * embedded in the returned launch URL as a FRAGMENT —
 *
 *     http://127.0.0.1:<port>/#token=<token>
 *
 * The fragment never reaches the server, proxies, or logs. On boot the UI
 * reads `location.hash`, keeps the token in memory (stripping the fragment
 * via history.replaceState), and sends `Authorization: Bearer <token>` on
 * every /api call. This header is the ONLY accepted channel — there is no
 * `?token=` query fallback (query strings leak into Referer/history/logs).
 * Static assets (the public app shell — no user data) are served without the
 * token; every /api route requires it.
 */

import { createHash, randomBytes } from 'node:crypto';
import { createServer } from 'node:http';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { KNOWN_DIRS } from '../core/index.js';
import { createApp } from './app.js';
import { handleRequest } from './bridge.js';
import { ReportStore } from './store.js';
import { defaultTrashDir } from './trash.js';
import type { WriteScope } from './pathguard.js';
import { LOOPBACK_HOST, resolveServerOptions } from './options.js';

export { LOOPBACK_HOST, resolveServerOptions } from './options.js';
export type { ServerOptions } from './options.js';
export { createApp } from './app.js';
export type { AppConfig } from './app.js';
export { ReportStore } from './store.js';
export type { ReportScope, ServedReport } from './store.js';
export { registerWriteRoutes } from './write.js';
export type { WriteRoutesConfig } from './write.js';
export { resolveWriteTarget } from './pathguard.js';
export type { WriteScope, Resolution } from './pathguard.js';
export { unifiedDiff } from './diff.js';
export { trashFile, defaultTrashDir } from './trash.js';

export interface StartServerOptions {
  /** Project root the report engine scans. */
  root: string;
  /** Bind host — loopback only; anything but 127.0.0.1 is rejected. */
  host?: string;
  /** Port to bind; default 0 (OS-assigned random ephemeral port). */
  port?: number;
  /** Static app-shell directory; default <package>/dist/web. */
  distDir?: string;
}

export interface RunningServer {
  /** Launch URL with the session token in the fragment (see module header). */
  url: string;
  port: number;
  token: string;
  close(): Promise<void>;
}

function packageVersion(): string {
  // package.json is two levels up from both src/server and dist/server.
  try {
    const raw = fs.readFileSync(new URL('../../package.json', import.meta.url), 'utf-8');
    const version = (JSON.parse(raw) as { version?: unknown }).version;
    return typeof version === 'string' ? version : '0.0.0';
  } catch {
    return '0.0.0';
  }
}

/**
 * Build the WRITE-API scopes: the project root (relative writes anchor here)
 * plus every agent home config dir that exists (~/.claude, ~/.codex, ...). Each
 * root is realpath'd so the path guard compares against canonical paths.
 */
function buildWriteScopes(root: string): WriteScope[] {
  const scopes: WriteScope[] = [];
  try {
    scopes.push({ root: fs.realpathSync(path.resolve(root)), kind: 'project' });
  } catch {
    // Project root missing — the scan would fail anyway; leave it out.
  }
  const home = os.homedir();
  for (const dir of KNOWN_DIRS) {
    try {
      const real = fs.realpathSync(path.join(home, dir));
      if (fs.statSync(real).isDirectory()) scopes.push({ root: real, kind: 'global' });
    } catch {
      // Not present on this machine.
    }
  }
  return scopes;
}

export async function startServer(opts: StartServerOptions): Promise<RunningServer> {
  if (opts.host !== undefined && opts.host !== LOOPBACK_HOST) {
    throw new Error(`refusing to bind non-loopback host ${opts.host}; only ${LOOPBACK_HOST}`);
  }
  const options = resolveServerOptions(opts.port === undefined ? {} : { port: opts.port });
  const distDir = opts.distDir ?? fileURLToPath(new URL('../../dist/web', import.meta.url));
  const version = packageVersion();

  const token = randomBytes(32).toString('base64url');
  const tokenHash = createHash('sha256').update(token).digest();

  // The real port exists only after listen; until then port() returns 0 and
  // the app's Host allowlist rejects everything (fail-closed).
  let boundPort = 0;
  const app = createApp({
    tokenHash,
    port: () => boundPort,
    distDir,
    store: new ReportStore(opts.root, version),
    version,
    scopes: buildWriteScopes(opts.root),
    trashDir: defaultTrashDir(),
  });

  const server = createServer((req, res) => {
    void handleRequest(app.fetch, req, res, `http://${LOOPBACK_HOST}:${boundPort}`);
  });

  // Reject only on a listen-time failure, then DETACH that handler — leaving
  // it attached would let a post-listen socket error call reject() on an
  // already-settled promise (swallowed). A real ongoing handler replaces it.
  await new Promise<void>((resolve, reject) => {
    const onListenError = (err: Error) => reject(err);
    server.once('error', onListenError);
    server.listen(options.port, options.host, () => {
      server.removeListener('error', onListenError);
      resolve();
    });
  });
  server.on('error', (err) => {
    console.error(`agentconfiging server: socket error: ${String(err)}`);
  });
  const address = server.address();
  if (address === null || typeof address === 'string') {
    server.close();
    throw new Error('server did not bind a TCP address');
  }
  boundPort = address.port;

  return {
    url: `http://${LOOPBACK_HOST}:${boundPort}/#token=${token}`,
    port: boundPort,
    token,
    close: () =>
      new Promise<void>((resolve, reject) => {
        server.close((err) => (err ? reject(err) : resolve()));
        server.closeAllConnections();
      }),
  };
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  startServer({ root: process.cwd() }).then(
    ({ url }) => console.log(`agentconfiging server on ${url}`),
    (err: unknown) => {
      console.error(`agentconfiging server failed to start: ${String(err)}`);
      process.exitCode = 1;
    },
  );
}
