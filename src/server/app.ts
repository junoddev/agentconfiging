/**
 * Hono application for the local control center (SPEC §4.3) — read-only v1.
 *
 * SECURITY MODEL (enforced here, transport-agnostic so tests run in-process):
 *
 * - Host allowlist, EVERY request: the Host header must be exactly
 *   `127.0.0.1:<port>` or `localhost:<port>` (case-insensitive hostname),
 *   else 403. This is the DNS-rebinding defense: a rebound hostname still
 *   arrives with the attacker's Host value and is rejected before routing.
 *
 * - Bearer token, EVERY /api request (including /api/health): the
 *   per-session token must arrive as `Authorization: Bearer <token>`, else
 *   401. There is NO `?token=` query fallback — query strings leak into
 *   Referer, browser history, and access logs, so the token travels only in
 *   the URL fragment (never sent to the server) until the UI promotes it to
 *   the Authorization header (see src/server/index.ts). Comparison is
 *   constant-time: both sides are SHA-256 hashed and compared with
 *   `crypto.timingSafeEqual`, so missing/short/wrong tokens all take the
 *   same-length path. The app only ever holds the token's hash.
 *
 * - Origin allowlist, EVERY /api request: if an Origin header is present it
 *   must be the server's own origin (`http://127.0.0.1:<port>` or
 *   `http://localhost:<port>`), else 403 — `null` and cross-site origins are
 *   rejected. Additionally, STATE-CHANGING methods (anything but GET/HEAD/
 *   OPTIONS) MUST prove same-origin: a valid Origin header OR
 *   `Sec-Fetch-Site: same-origin`; a write with neither is 403 even with a
 *   valid token. (v1 exposes no write routes, but the write bead gxo.3
 *   inherits this gate.) Token + Origin together are the CSRF defense.
 *
 * - NO CORS headers, ever. Their absence means browsers block cross-origin
 *   reads. Every response also carries `X-Content-Type-Options: nosniff`,
 *   `X-Frame-Options: DENY` + CSP `frame-ancestors 'none'` (the control
 *   center must never be framed — critical once write/PTY controls exist),
 *   and `Referrer-Policy: no-referrer`.
 *
 * Case sensitivity: the Host/Origin comparisons lowercase their inputs, but
 * path routing (the `/api/*` middleware and every route) is case-SENSITIVE
 * and consistently so — middleware and routes agree because both match the
 * literal `/api` prefix. Keep new routes lowercase to preserve that.
 *
 * - Static files (the public app shell — no user data) are served WITHOUT
 *   the token from `distDir` only: percent-decoded paths containing a `..`
 *   segment (any of `/` or `\` separators) are 400; resolved AND
 *   canonicalized (realpath, so symlinks cannot escape) paths must stay
 *   under the canonical distDir or the file is treated as absent. No
 *   directory listings. SPA fallback: extensionless paths that miss serve
 *   index.html; paths with an extension that miss are 404.
 *
 * - Unknown /api paths → 404 JSON. Errors → 500 JSON with a constant body;
 *   details (never stack traces) go to stderr only.
 */

import { createHash, timingSafeEqual } from 'node:crypto';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { Hono } from 'hono';
import type { Context } from 'hono';
import { DiscoveryError, discoverProjects, RegistryClient } from '../core/index.js';
import { GlobalStore } from './store.js';
import { InstanceRegistry, InvalidRootError } from './registry.js';
import { registerApplyFixRoute, registerWriteRoutes } from './write.js';
import { registerHooksEditRoute } from './hooks-edit.js';
import { registerStorageRoutes } from './storage.js';
import { registerSyncRoute } from './sync.js';
import { registerCatalogRoutes, type CatalogSource } from './catalog.js';
import { registerMarketplaceRoutes, type ClaudeExec } from './marketplace.js';
import { registerGitRoutes } from './git-routes.js';
import type { GitExec } from './git.js';
import { registerStatsRoutes } from './stats-routes.js';
import { registerKnownProjectsRoute } from './known-projects.js';
import { registerSearchRoutes } from './search-routes.js';
import { registerPtyRoutes } from './pty-routes.js';
import { registerPipelineRoutes } from './pipeline-routes.js';
import type { RuntimeMap } from './pipeline/index.js';
import { PtyManager } from './pty.js';
import type { WriteScope } from './pathguard.js';

export interface AppConfig {
  /** SHA-256 digest of the session bearer token — the app never sees the raw token. */
  tokenHash: Buffer;
  /**
   * The bound port, late-resolved: with `port: 0` the real port exists only
   * after listen. Until then this returns 0 and every request fails the
   * Host check (fail-closed).
   */
  port: () => number;
  /** Directory the static app shell is served from (dist/web). */
  distDir: string;
  /**
   * The multi-instance registry (SPEC §4.2). Hosts every root the server
   * knows about; the default instance (launch cwd) serves report requests
   * that omit `?instance=`. Replaces the single ReportStore of v1.
   */
  registry: InstanceRegistry;
  version: string;
  /**
   * GLOBAL REPORT (71h.2): the server-owned machine-global report cache — ONE
   * per server, NOT per instance. Defaults to a store over os.homedir();
   * injectable so tests point it at a fixture home. Its roots are a FIXED
   * server-side set (core KNOWN_DIRS under that home) — no request parameter
   * ever selects what it scans.
   */
  globalStore?: GlobalStore;
  /**
   * WRITE-API scopes (bead gxo.3): the project root + any agent home config
   * dirs, each realpath'd. Optional and defaults to [] — with no scopes every
   * write/read is refused (fail-closed), which keeps the read-only tests valid.
   */
  scopes?: WriteScope[];
  /** Where deletes are moved (never hard-unlinked). Required once scopes exist. */
  trashDir?: string;
  /**
   * CATALOG source (bead 0zm.4): the registry client the install/remove flow
   * reads the merged catalog + checksum-verified file bytes from. Defaults to a
   * production RegistryClient (seed floor + fetched overlay). Injectable so tests
   * can fire hostile catalog shapes at the real install path.
   */
  catalogClient?: CatalogSource;
  /**
   * MARKETPLACE (bead 0zm.5): how the plugin-marketplace routes reach the
   * `claude` CLI. Defaults to the real subprocess (execFile, fixed command, arg
   * array, no shell, timeout). Injectable so tests fire a FAKE exec — a valid
   * listing, hostile JSON, an ENOENT, a timeout — at the parse + validation path
   * with no real CLI present.
   */
  marketplaceExec?: ClaudeExec;
  /**
   * GIT PANEL (bead ngs.1): how the git-panel routes reach `git`. Defaults to the
   * real subprocess (execFile, fixed command `git`, arg array, no shell, cwd
   * pinned to the instance repo root, timeout). Injectable so tests fire a FAKE
   * exec — recorded args/cwd/stdin, hostile output, ENOENT, timeout — at the
   * parse + validation path with no real git present.
   */
  gitExec?: GitExec;
  /**
   * EMBEDDED TERMINAL (bead ngs.2): true only when the server was launched
   * INTERACTIVELY. The PTY is the highest-privilege surface, so it exists ONLY
   * in interactive mode — daemon mode leaves this false and GET /api/pty/status
   * reports unavailable (and index.ts does not serve the /api/pty WS upgrade).
   * Defaults to false (fail-closed) for a directly-constructed app.
   */
  interactive?: boolean;
  /**
   * The shared PTY manager (bead ngs.2). index.ts constructs one (with the
   * session token to scrub from child envs) and passes it here so the status
   * route + the WS upgrade share one caps/teardown owner. When omitted, a
   * default manager is built from `interactive` — used by the status route only.
   */
  ptyManager?: PtyManager;
  /**
   * PIPELINES (bead ira.2): the state dir pipeline JSON persists under
   * (`<stateDir>/pipelines`). Defaults to the shared XDG state dir; injectable so
   * tests point it at a tmp dir.
   */
  pipelineStateDir?: string;
  /**
   * PIPELINES (bead ira.2): the executor runtime table a pipeline RUN uses.
   * Defaults to the real committed node runtimes (bash/http/file/git, guarded).
   * Injectable so tests exercise the run route through fake runtimes with zero
   * real side effects while still going through the committed executor.
   */
  pipelineRuntimes?: RuntimeMap;
}

const MIME: Record<string, string> = {
  '.html': 'text/html; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.mjs': 'text/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.json': 'application/json',
  '.map': 'application/json',
  '.svg': 'image/svg+xml',
  '.png': 'image/png',
  '.jpg': 'image/jpeg',
  '.jpeg': 'image/jpeg',
  '.gif': 'image/gif',
  '.webp': 'image/webp',
  '.ico': 'image/x-icon',
  '.woff': 'font/woff',
  '.woff2': 'font/woff2',
  '.txt': 'text/plain; charset=utf-8',
  '.webmanifest': 'application/manifest+json',
};

function jsonError(status: 400 | 401 | 403 | 404 | 500, message: string): Response {
  return new Response(JSON.stringify({ error: message }), {
    status,
    headers: { 'content-type': 'application/json' },
  });
}

/** Constant-time token check: hash the presented value, timingSafeEqual on digests. */
function tokenMatches(presented: string | undefined, tokenHash: Buffer): boolean {
  const digest = createHash('sha256')
    .update(presented ?? '')
    .digest();
  return timingSafeEqual(digest, tokenHash);
}

/**
 * Extract the bearer token from the Authorization header ONLY. No query-
 * string fallback: `?token=` would leak into Referer/history/logs (see the
 * module header) — the token lives in the URL fragment until the UI promotes
 * it to this header.
 */
function presentedToken(c: Context): string | undefined {
  const auth = c.req.header('authorization');
  const match = auth ? /^Bearer\s+(.+)$/i.exec(auth) : null;
  return match?.[1];
}

/** Canonical file under distReal, or undefined (missing, dir, or symlink escape). */
function safeFile(candidate: string, distReal: string): string | undefined {
  try {
    const real = fs.realpathSync(candidate);
    if (real !== distReal && !real.startsWith(distReal + path.sep)) return undefined;
    return fs.statSync(real).isFile() ? real : undefined;
  } catch {
    return undefined;
  }
}

function fileResponse(file: string): Response {
  const body = fs.readFileSync(file);
  const type = MIME[path.extname(file).toLowerCase()] ?? 'application/octet-stream';
  return new Response(body as unknown as BodyInit, { headers: { 'content-type': type } });
}

function serveStatic(distDir: string, pathname: string): Response {
  let decoded: string;
  try {
    decoded = decodeURIComponent(pathname);
  } catch {
    return jsonError(400, 'bad request');
  }
  if (decoded.includes('\0')) return jsonError(400, 'bad request');

  // Traversal guard on the decoded path: any `..` segment (either separator)
  // is rejected outright — never resolved, never answered with content.
  const segments = decoded.split(/[/\\]+/);
  if (segments.includes('..')) return jsonError(400, 'bad request');

  let distReal: string;
  try {
    distReal = fs.realpathSync(distDir);
  } catch {
    return jsonError(404, 'not found'); // no dist build present
  }

  const parts = segments.filter((s) => s !== '' && s !== '.');
  const resolved = path.resolve(distReal, ...parts);
  if (resolved !== distReal && !resolved.startsWith(distReal + path.sep)) {
    return jsonError(404, 'not found');
  }

  const direct = safeFile(resolved, distReal);
  if (direct) return fileResponse(direct);

  // SPA fallback for extensionless routes only; asset-shaped misses are 404.
  const last = parts[parts.length - 1];
  if (last !== undefined && last.includes('.')) return jsonError(404, 'not found');
  const fallback = safeFile(path.join(distReal, 'index.html'), distReal);
  return fallback ? fileResponse(fallback) : jsonError(404, 'not found');
}

export function createApp(config: AppConfig): Hono {
  const app = new Hono();

  const allowedHosts = () => {
    const port = config.port();
    return new Set([`127.0.0.1:${port}`, `localhost:${port}`]);
  };
  const allowedOrigins = () => {
    const port = config.port();
    return new Set([`http://127.0.0.1:${port}`, `http://localhost:${port}`]);
  };

  // Every response: nosniff, no framing, no referrer leakage. NO CORS header
  // is ever added. The CSP suits the self-contained app shell (same-origin
  // assets, inline styles from the bundler) and — crucially — forbids
  // framing so the control center cannot be embedded and clickjacked.
  app.use('*', async (c, next) => {
    await next();
    c.header('X-Content-Type-Options', 'nosniff');
    c.header('X-Frame-Options', 'DENY');
    c.header('Referrer-Policy', 'no-referrer');
    c.header(
      'Content-Security-Policy',
      "default-src 'self'; script-src 'self'; style-src 'self' 'unsafe-inline'; " +
        "img-src 'self' data:; font-src 'self'; connect-src 'self'; " +
        "frame-ancestors 'none'; base-uri 'none'; object-src 'none'",
    );
  });

  // Host allowlist on EVERY request (DNS-rebinding defense).
  app.use('*', async (c, next) => {
    const host = c.req.header('host');
    if (!host || !allowedHosts().has(host.toLowerCase())) {
      return jsonError(403, 'forbidden');
    }
    await next();
  });

  // /api/*: Origin/CSRF gate + bearer token; responses are never cached.
  app.use('/api/*', async (c, next) => {
    const origin = c.req.header('origin');
    if (origin !== undefined && !allowedOrigins().has(origin.toLowerCase())) {
      return jsonError(403, 'forbidden');
    }
    // State-changing methods must PROVE same-origin (CSRF): a valid Origin
    // header, or Sec-Fetch-Site: same-origin. A write with neither — the
    // classic form/img CSRF shape, which never sends Origin — is rejected.
    // GET/HEAD/OPTIONS keep the lenient behavior (safe, and Origin is often
    // absent on same-origin reads). v1 has no write routes; gxo.3 inherits it.
    const method = c.req.method.toUpperCase();
    const isSafe = method === 'GET' || method === 'HEAD' || method === 'OPTIONS';
    if (!isSafe && origin === undefined && c.req.header('sec-fetch-site') !== 'same-origin') {
      return jsonError(403, 'forbidden');
    }
    if (!tokenMatches(presentedToken(c), config.tokenHash)) {
      return jsonError(401, 'unauthorized');
    }
    await next();
    c.header('Cache-Control', 'no-store');
  });

  app.get('/api/health', (c) => c.json({ ok: true, version: config.version }));

  const registry = config.registry;

  // Parse a JSON body's `path` field. Returns undefined (never throws) when
  // the body is not JSON or `path` is missing/blank — the route maps that to
  // a 400. Keeps a malformed/hostile body from ever reaching the fs layer.
  const readPathField = async (c: Context): Promise<string | undefined> => {
    let body: unknown;
    try {
      body = await c.req.json();
    } catch {
      return undefined;
    }
    if (body === null || typeof body !== 'object') return undefined;
    const value = (body as { path?: unknown }).path;
    return typeof value === 'string' && value.trim() !== '' ? value : undefined;
  };

  // GET /api/instances — the hosted instance list (summaries, no engine data).
  app.get('/api/instances', (c) => c.json({ instances: registry.list() }));

  // POST /api/instances {path} — the ADD flow: the ONE place new roots enter.
  // Validated (realpath + must be an existing directory) in the registry;
  // added lazily (no scan until first report). Bad path → 400.
  app.post('/api/instances', async (c) => {
    const requested = await readPathField(c);
    if (requested === undefined) return jsonError(400, 'path required');
    try {
      return c.json(registry.summary(registry.add(requested)));
    } catch (err) {
      if (err instanceof InvalidRootError) return jsonError(400, err.message);
      console.error(`agentconfiging server: add instance failed: ${String(err)}`);
      return jsonError(500, 'add failed');
    }
  });

  // POST /api/instances/scan {path} — recursive discovery. Returns hits to
  // OFFER; does NOT auto-add (adding still goes through POST /api/instances).
  // discoverProjects is depth/dir-bounded and realpaths its own root; a bad
  // root throws DiscoveryError → 400.
  app.post('/api/instances/scan', async (c) => {
    const requested = await readPathField(c);
    if (requested === undefined) return jsonError(400, 'path required');
    try {
      const { hits, stats } = discoverProjects(requested);
      return c.json({ hits, stats });
    } catch (err) {
      if (err instanceof DiscoveryError) return jsonError(400, 'invalid scan root');
      console.error(`agentconfiging server: scan failed: ${String(err)}`);
      return jsonError(500, 'scan failed');
    }
  });

  // POST /api/instances/:id/unload — drop the engine store (free memory),
  // keep the instance in the list. Next report re-scans. Unknown id → 404.
  app.post('/api/instances/:id/unload', (c) =>
    registry.unload(c.req.param('id'))
      ? c.json({ id: c.req.param('id'), loaded: false })
      : jsonError(404, 'unknown instance'),
  );

  // DELETE /api/instances/:id — remove the instance entirely. Unknown id → 404.
  app.delete('/api/instances/:id', (c) =>
    registry.remove(c.req.param('id'))
      ? c.json({ id: c.req.param('id'), removed: true })
      : jsonError(404, 'unknown instance'),
  );

  // GLOBAL REPORT (71h.2): one server-owned store over THIS machine's home,
  // instance-independent by design (see AppConfig.globalStore).
  const globalStore = config.globalStore ?? new GlobalStore(os.homedir(), config.version);

  app.get('/api/report', (c) => {
    const url = new URL(c.req.url);
    const scope = url.searchParams.get('scope') ?? 'project';
    if (scope === 'global') {
      // Global is instance-independent — mixing in an instance selector is a
      // contract error, rejected rather than silently ignored.
      if (url.searchParams.get('instance') !== null) {
        return jsonError(400, 'scope=global takes no instance');
      }
      try {
        return c.json(globalStore.get({ fresh: url.searchParams.get('fresh') === '1' }));
      } catch (err) {
        // Details to stderr only — no stack traces or messages in responses.
        console.error(`agentconfiging server: global report failed: ${String(err)}`);
        return jsonError(500, 'report failed');
      }
    }
    if (scope !== 'project') return jsonError(400, 'unsupported scope');
    const fresh = url.searchParams.get('fresh') === '1';
    // Selector resolves ONLY against registered instances — an unknown id or
    // an unregistered path is a 404, never a scan of an attacker-chosen path.
    const instance = registry.resolve(url.searchParams.get('instance') ?? undefined);
    if (!instance) return jsonError(404, 'unknown instance');
    try {
      return c.json(registry.report(instance, { fresh }));
    } catch (err) {
      // Details to stderr only — no stack traces or messages in responses.
      console.error(`agentconfiging server: report failed: ${String(err)}`);
      return jsonError(500, 'report failed');
    }
  });

  // CONTEXT HEALTH (7yb.6): GET /api/context-health?instance= — the content-free
  // size/footprint view of the agent config that loads into an agent's context
  // window (sizes + paths + suggestions, never file bodies). Computed over the
  // SAME scanned manifest the report route caches (no extra scan). Selector
  // resolves ONLY against registered instances — unknown id/path → 404.
  app.get('/api/context-health', (c) => {
    const url = new URL(c.req.url);
    const fresh = url.searchParams.get('fresh') === '1';
    const instance = registry.resolve(url.searchParams.get('instance') ?? undefined);
    if (!instance) return jsonError(404, 'unknown instance');
    try {
      return c.json(registry.contextHealth(instance, { fresh }));
    } catch (err) {
      console.error(`agentconfiging server: context-health failed: ${String(err)}`);
      return jsonError(500, 'context-health failed');
    }
  });

  // WRITE API (gxo.3): POST /api/write, POST /api/delete, GET /api/file. These
  // register under /api, so they inherit the token + Origin/CSRF gates above.
  registerWriteRoutes(app, { scopes: config.scopes ?? [], trashDir: config.trashDir ?? '' });

  // APPLY-FIX (wmc.1): POST /api/apply-fix — one-click machine-fix apply. Also
  // under /api (inherits the same gates); recomputes the fix per-instance and
  // writes every edit through the SAME guarded write path as /api/write.
  registerApplyFixRoute(app, { scopes: config.scopes ?? [], registry });

  // HOOKS EDIT (71h.9): POST /api/hooks/edit — structured hook add/remove
  // applied to the RAW settings file server-side, so a REDACTED settings.json
  // (secrets in env) is editable without the client round-tripping redacted
  // content. Also under /api (inherits the token + Origin/CSRF gates); resolves
  // through the SAME scopes/guard and writes through the SAME guarded primitive
  // as /api/write; the dry-run/commit diff is redacted before it crosses the
  // wire. See src/server/hooks-edit.ts.
  registerHooksEditRoute(app, { scopes: config.scopes ?? [] });

  // STORAGE (wmc.2): GET /api/storage + POST /api/storage/cleanup — disk-usage
  // breakdown per instance and a recoverable, allowlisted cleanup. Also under
  // /api (inherits the token + Origin/CSRF gates); cleanup trashes (never
  // hard-deletes) and only ever an allowlisted runtime-state subdir.
  registerStorageRoutes(app, {
    scopes: config.scopes ?? [],
    registry,
    trashDir: config.trashDir ?? '',
  });

  // INSTRUCTION SYNC (wmc.10): POST /api/sync — regenerate every runtime's
  // instruction file from a designated source of truth. Under /api (inherits the
  // token + Origin/CSRF gates); every generated target is written through the
  // SAME guarded write path as /api/write, so a sync can never escape scope.
  registerSyncRoute(app, { scopes: config.scopes ?? [], registry });

  // CATALOG (0zm.4): GET /api/catalog + POST /api/catalog/install|remove — the
  // registry install/remove flow. Also under /api (inherits the token +
  // Origin/CSRF gates); registry content is UNTRUSTED — every entry file path is
  // path-guarded and every file's content is checksum-verified BEFORE any write,
  // provenance is recorded to a manifest, and remove trashes only recorded files.
  registerCatalogRoutes(app, {
    scopes: config.scopes ?? [],
    registry,
    client: config.catalogClient ?? new RegistryClient(),
    trashDir: config.trashDir ?? '',
  });

  // MARKETPLACE (0zm.5): GET /api/marketplace + /installed + POST /install — the
  // Claude Code plugin-marketplace surface. Also under /api (inherits the token +
  // Origin/CSRF gates); it SHELLS OUT to the `claude` CLI via execFile (fixed
  // command, arg array, NO shell), validates any install name (strict charset +
  // allowlist from the listing) before it is ever passed as an arg, times out
  // every spawn, degrades gracefully when the CLI is absent, and parses the CLI's
  // UNTRUSTED output defensively. See src/server/marketplace.ts.
  registerMarketplaceRoutes(app, { exec: config.marketplaceExec });

  // GIT PANEL (ngs.1): GET /api/git/status|log|branches|diff + POST
  // /api/git/stage|unstage|commit|checkout|push|pull — the launched-repo git
  // panel. Also under /api (inherits the token + Origin/CSRF gates; the POSTs are
  // thus CSRF-gated). It SHELLS OUT to `git` via execFile (fixed command, arg
  // array, NO shell), pins cwd to the resolved instance's realpath'd repo root
  // (the scope), validates every ref/path (no leading dash, no `..`, `--`
  // separators) and pipes the commit message on stdin, times out every spawn, and
  // degrades gracefully when git is absent / the dir is not a repo. See
  // src/server/git.ts.
  registerGitRoutes(app, { registry, exec: config.gitExec });

  // DASHBOARD STATS (7yb.2) + SESSION REPLAY (7yb.3): GET /api/stats,
  // /api/sessions (list), /api/sessions/:id (paginated replay DETAIL) + POST
  // /api/sessions/:id/tags (local tag sidecar). Also under /api (inherits the
  // token + Origin/CSRF gates); reads THIS machine's runtime history (~/.claude)
  // through the committed claude adapter, bounded to the most-recent N session
  // files. Aggregates + session metadata are content-free; replay DETAIL renders
  // session CONTENT but REDACTS every secret-bearing string server-side (SPEC §3)
  // before it crosses the wire.
  registerStatsRoutes(app);

  // KNOWN-PROJECT SUGGESTIONS (qoc.3): GET /api/known-projects — project roots
  // seen in THIS machine's ~/.claude history (cwd read from each session's
  // in-file ENTRIES, never the lossy slug dir) that EXIST on disk and are NOT
  // already registered. Also under /api (inherits the token + Origin/CSRF gates);
  // local-only, bounded (most-recent N), content-free (roots + a session count +
  // last-seen only). Feeds the EXISTING add flow (POST /api/instances) — the UI
  // one-click adds a suggestion. See src/server/known-projects.ts.
  registerKnownProjectsRoute(app, { registry });

  // SESSION SEARCH (7yb.4): GET /api/search, /api/search/status + POST
  // /api/search/reindex. Also under /api (inherits the token + Origin/CSRF
  // gates). Full-text search over session turns + tool results via SQLite FTS5,
  // built from THIS machine's runtime history (~/.claude). The FTS engine depends
  // on the OPTIONAL, lazily-loaded better-sqlite3 native module: when it cannot
  // load, every search route degrades to { available:false, reason } (a 200) and
  // the rest of the server keeps working — the core npx path never requires a
  // native module. Result snippets are REDACTED server-side; the query is
  // sanitized + bound as a parameter (no FTS5 injection). Semantic/embeddings mode
  // is behind an opt-in flag (a documented stub in v1).
  registerSearchRoutes(app);

  // EMBEDDED TERMINAL (ngs.2): GET /api/pty/status — the capability probe for the
  // PTY surface. Also under /api (inherits the token + Origin/CSRF gates). The
  // PTY data pipe is a WebSocket wired at the transport layer in index.ts; this
  // route only reports whether the terminal is available (interactive launch +
  // loadable node-pty) and the validated shell/CLI launch choices. The shared
  // manager is injected by index.ts; a directly-constructed app builds a default
  // one from `interactive` (default false → status reports unavailable).
  const ptyManager =
    config.ptyManager ?? new PtyManager({ interactive: config.interactive ?? false });
  registerPtyRoutes(app, { manager: ptyManager, registry });

  // PIPELINES (ira.2): GET /api/pipelines(+/:id) + POST /api/pipelines +
  // DELETE /api/pipelines/:id + POST /api/pipelines/:id/run + GET
  // /api/pipelines/runs/:runId — the visual-workflow persistence + run surface.
  // Also under /api (inherits the token + Origin/CSRF gates; the save/delete/RUN
  // POSTs are thus CSRF-gated — a run executes bash, the highest privilege here).
  // Pipeline files are UNTRUSTED user config: every read parses defensively and
  // the run path re-validates BEFORE handing the graph to the COMMITTED guarded
  // executor (bash/http/file/git bounded + scoped to the instance root — never
  // bypassed). Per-node status streams into an in-memory run record the client
  // polls. See src/server/pipeline-routes.ts.
  registerPipelineRoutes(app, {
    registry,
    ...(config.pipelineStateDir !== undefined ? { stateDir: config.pipelineStateDir } : {}),
    ...(config.pipelineRuntimes !== undefined ? { runtimes: config.pipelineRuntimes } : {}),
  });

  // Unknown /api paths (any method): 404 JSON, no static fallback.
  app.all('/api/*', () => jsonError(404, 'not found'));

  // Static app shell — token-free by design (public shell, no user data).
  app.get('*', (c) => serveStatic(config.distDir, new URL(c.req.url).pathname));

  app.notFound(() => jsonError(404, 'not found'));
  app.onError((err) => {
    console.error(`agentconfiging server: ${String(err)}`);
    return jsonError(500, 'internal error');
  });

  return app;
}
