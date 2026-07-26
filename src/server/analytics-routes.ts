/**
 * analytics-routes — the read-only TOKEN/COST analytics surface (SPEC §5 row 15
 * / E7, bead agentconfig-7yb.5). Registered under `/api`, so the route INHERITS
 * the hardened app's gates (Host allowlist, bearer token, same-origin/CSRF). It
 * adds no gate of its own.
 *
 * LOCAL-ONLY read: analytics are derived from THIS machine's runtime history
 * under `~/.claude`, read through the committed `claudeAdapter` via the same
 * bounded, TTL-cached {@link StatsCache} the dashboard routes use (the reader is
 * REUSED, not duplicated). The server binds loopback only, so this on-disk
 * history is never exposed off-machine.
 *
 * CONTENT-FREE responses: `computeAnalytics` is pure over the typed models and
 * reads only per-message token COUNTS + timestamps — never message CONTENT. The
 * response carries token counts, USD costs, model ids, and trend buckets — never
 * a message body. Model ids are opaque log text; callers render them as text
 * nodes.
 *
 * BOUNDED work: analytics reflect the most-recent {@link DEFAULT_SESSION_CAP}
 * session files (by mtime), reported via `sessionsScanned` / `sessionsTotal` /
 * `capped`, exactly like the dashboard stats.
 */

import os from 'node:os';
import path from 'node:path';
import type { Hono } from 'hono';
import { computeAnalytics, type AnalyticsResult } from '../core/index.js';
import {
  DEFAULT_SESSION_CAP,
  DEFAULT_TTL_MS,
  StatsCache,
  type StatsRoutesConfig,
} from './stats-routes.js';

/**
 * GET /api/analytics payload — the analytics bundle + the session-window meta.
 * `AnalyticsResult` is content-free (token counts, costs, model ids, trends).
 */
export interface AnalyticsResponse extends AnalyticsResult {
  /** Distinct session files fully read this scan (≤ the cap). */
  sessionsScanned: number;
  /** Session files discovered on disk before the cap was applied. */
  sessionsTotal: number;
  /** True when discovery found more files than the cap (totals are windowed). */
  capped: boolean;
}

/**
 * Register the read-only analytics route. Uses its own {@link StatsCache} over
 * the same `~/.claude` home + cap as the dashboard routes; both share the
 * committed adapter + caching discipline, so a huge history never hangs the
 * server and a missing home degrades to zeroed analytics, never an error.
 */
export function registerAnalyticsRoutes(app: Hono, config: StatsRoutesConfig = {}): void {
  const home = config.home ?? path.join(os.homedir(), '.claude');
  const now = config.now ?? (() => Date.now());
  const cap = config.sessionCap ?? DEFAULT_SESSION_CAP;
  const ttlMs = config.ttlMs ?? DEFAULT_TTL_MS;
  const cache = new StatsCache(home, cap, ttlMs);

  // GET /api/analytics — token/cost aggregates. Local-only (~/.claude), bounded
  // (session cap), content-free (counts + costs + model ids + trends only).
  app.get('/api/analytics', async (c) => {
    const nowMs = now();
    const { sessions, sessionsTotal, capped } = await cache.load(nowMs);
    const analytics = computeAnalytics(sessions, { now: nowMs });
    const body: AnalyticsResponse = {
      ...analytics,
      sessionsScanned: sessions.length,
      sessionsTotal,
      capped,
    };
    return c.json(body);
  });
}
