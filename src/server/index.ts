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
import { InstanceRegistry } from './registry.js';
import { WatcherSupervisor } from './watcher.js';
import { WsHub, handleUpgrade } from './ws.js';
import { defaultTrashDir } from './trash.js';
import type { WriteScope } from './pathguard.js';
import { LOOPBACK_HOST, resolveServerOptions } from './options.js';

export { LOOPBACK_HOST, resolveServerOptions } from './options.js';
export type { ServerOptions } from './options.js';
export { createApp } from './app.js';
export type { AppConfig } from './app.js';
export { ReportStore } from './store.js';
export type { ReportScope, ServedReport } from './store.js';
export { InstanceRegistry, InvalidRootError, MAX_INSTANCES } from './registry.js';
export type { RegistryInstance, InstanceSummary, StoreFactory } from './registry.js';
export { registerApplyFixRoute, registerWriteRoutes } from './write.js';
export type { ApplyFixRoutesConfig, WriteRoutesConfig } from './write.js';
export { registerStorageRoutes } from './storage.js';
export type { StorageRoutesConfig } from './storage.js';
export { registerCatalogRoutes, stampProvenance } from './catalog.js';
export type { CatalogRoutesConfig, CatalogSource } from './catalog.js';
export { registerMarketplaceRoutes, parseAvailable, parseInstalled } from './marketplace.js';
export type {
  MarketplaceRoutesConfig,
  ClaudeExec,
  ExecResult,
  MarketplacePlugin,
  InstalledPlugin,
} from './marketplace.js';
export {
  registerStatsRoutes,
  sessionSummary,
  sessionIdOf,
  redactBlock,
  toReplayMessage,
  sanitizeTags,
  isLive,
  defaultStateDir,
  TagStore,
  StatsCache,
  ACHIEVEMENT_CATALOG,
  DEFAULT_SESSION_CAP,
  DEFAULT_TTL_MS,
  DEFAULT_LIVE_WINDOW_MS,
  DEFAULT_PAGE_SIZE,
  MAX_PAGE_SIZE,
  MAX_TAGS,
  MAX_TAG_LENGTH,
} from './stats-routes.js';
export type {
  StatsRoutesConfig,
  StatsResponse,
  SessionsResponse,
  SessionSummary,
  SessionDetailResponse,
  SessionTagsResponse,
  ReplayBlock,
  ReplayMessage,
  AchievementMeta,
  AchievementsPayload,
  LoadedHistory,
} from './stats-routes.js';
export { registerSearchRoutes } from './search-routes.js';
export type { SearchRoutesConfig } from './search-routes.js';
export {
  SearchIndex,
  defaultSqliteLoader,
  sanitizeFtsMatch,
  sessionRows,
  messageSearchText,
  clampLimit,
  REASON_NO_MODULE,
  REASON_NO_INDEX,
  REASON_SEMANTIC_DISABLED,
  REASON_SEMANTIC_STUB,
  DEFAULT_MAX_RESULTS,
  MAX_RESULTS_CEILING,
  MAX_QUERY_TERMS,
} from './search.js';
export type {
  SearchHit,
  SearchResult,
  ReindexResult,
  StatusResult,
  SearchMode,
  Coverage,
  IndexRow,
  SearchIndexConfig,
  SqliteLoader,
  SqliteDatabase,
  SqliteDatabaseCtor,
} from './search.js';
export { readManifest, parseManifest, upsertInstall, removeInstall } from './provenance.js';
export type { InstallRecord, ProvenanceManifest } from './provenance.js';
export { resolveWriteTarget } from './pathguard.js';
export type { WriteScope, Resolution } from './pathguard.js';
export { unifiedDiff } from './diff.js';
export { trashFile, defaultTrashDir } from './trash.js';
export { InstanceWatcher, WatcherSupervisor, reportDiff, DEFAULT_DEBOUNCE_MS } from './watcher.js';
export type { WatcherMessage, ReportDiff } from './watcher.js';
export {
  WsHub,
  WsConnection,
  authorizeUpgrade,
  handleUpgrade,
  computeAcceptKey,
  encodeTextFrame,
  encodeCloseFrame,
  decodeFrames,
  DEFAULT_MAX_CONNECTIONS,
} from './ws.js';

export interface StartServerOptions {
  /** Launch root — the DEFAULT instance, served when `?instance=` is absent. */
  root: string;
  /**
   * Additional roots to seed as lazy instances (SPEC §4.2), e.g. the CLI's
   * restored workspace.json list. Registered without scanning; deduped
   * against `root`. A stale/removed root surfaces only at load time.
   */
  instances?: readonly string[];
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
  /**
   * Live-updates WebSocket URL (agentconfig-gxo.4): `ws://127.0.0.1:<port>/api/ws`.
   * The UI connects with the session token as the sole `Sec-WebSocket-Protocol`
   * subprotocol (`new WebSocket(wsUrl, [token])`) — a WS handshake can carry no
   * Authorization header and the URL fragment never reaches the server, so the
   * subprotocol is the token channel. The upgrade enforces the same Host/Origin/
   * token gates as every /api request (see ws.ts).
   */
  wsUrl: string;
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

  // ONE registry hosts every instance; the launch root is the default. Extra
  // roots (the CLI's restored workspace) seed as lazy instances — no scan
  // until first opened. seed() is trusted (no existence check): a since-
  // removed root surfaces as a report-time 500, matching v1's single store.
  const registry = new InstanceRegistry(version);
  registry.seed(opts.root, { makeDefault: true });
  for (const extra of opts.instances ?? []) registry.seed(extra);

  // LIVE UPDATES (agentconfig-gxo.4): the WS hub fans report/live-session
  // pushes to connected clients; the supervisor owns one file watcher per
  // loaded instance and pushes through the hub. Wiring it as the registry's
  // lifecycle seam starts a watcher exactly when an instance loads and stops
  // it on unload/remove.
  const wsHub = new WsHub();
  const supervisor = new WatcherSupervisor({
    home: os.homedir(),
    onMessage: (message) => wsHub.broadcast(message),
  });
  registry.setLifecycle(supervisor);

  // The real port exists only after listen; until then port() returns 0 and
  // the app's Host allowlist rejects everything (fail-closed).
  let boundPort = 0;
  const app = createApp({
    tokenHash,
    port: () => boundPort,
    distDir,
    registry,
    version,
    scopes: buildWriteScopes(opts.root),
    trashDir: defaultTrashDir(),
  });

  const server = createServer((req, res) => {
    void handleRequest(app.fetch, req, res, `http://${LOOPBACK_HOST}:${boundPort}`);
  });

  // WebSocket upgrades are handled at the transport layer (node's 'upgrade'
  // event), NOT through Hono — hono has no WS over the node bridge. The handler
  // gates the upgrade with the SAME Host/Origin/token checks as /api before
  // switching protocols (see ws.ts).
  //
  // We track every upgraded socket ourselves: an upgraded socket is DETACHED
  // from the http server, so `server.closeAllConnections()` never destroys it
  // and `server.close()` would hang forever while one lingers (verified). On
  // shutdown we destroy them directly.
  const wsSockets = new Set<import('node:stream').Duplex>();
  server.on('upgrade', (req, socket, head) => {
    wsSockets.add(socket);
    socket.on('close', () => wsSockets.delete(socket));
    handleUpgrade(req, socket, head, {
      tokenHash,
      port: () => boundPort,
      hub: wsHub,
      path: '/api/ws',
    });
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
    wsUrl: `ws://${LOOPBACK_HOST}:${boundPort}/api/ws`,
    port: boundPort,
    token,
    // Teardown order matters: stop the watchers (release every chokidar handle
    // — no leaks on close/unload) and close the WS connections, THEN close the
    // http server. Do the watcher/WS teardown first so no push races shutdown.
    close: async () => {
      await supervisor.closeAll();
      // Send WS close frames to any graceful clients, then DIRECTLY destroy
      // every upgraded socket — closeAllConnections() cannot reach them, and an
      // undestroyed one keeps server.close()'s callback from ever firing.
      wsHub.closeAll();
      for (const socket of wsSockets) socket.destroy();
      wsSockets.clear();
      await new Promise<void>((resolve, reject) => {
        server.close((err) => (err ? reject(err) : resolve()));
        server.closeAllConnections();
      });
    },
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
