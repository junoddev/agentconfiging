/**
 * http — shared route helpers for the Hono server surface (np4 server dedup).
 * These were copy-pasted across the route modules (jsonError ~8x, isPlainObject/
 * asObject ~4x, the instance-resolution + JSON-body-parse boilerplate in
 * git-routes/pipeline-routes). Consolidated here so there is ONE definition of
 * each; behavior is identical to the copies it replaces.
 *
 * Pure helper module: no route registration, no side effects.
 */

import type { Context } from 'hono';
import type { InstanceRegistry, RegistryInstance } from './registry.js';

/**
 * The WIDEST status union across every caller's local jsonError so a single
 * definition serves all of them (app.ts 401/500, hooks-edit/write 409/413,
 * catalog 422, git-routes/pipeline-routes 400/404, …).
 */
export type JsonErrorStatus = 400 | 401 | 403 | 404 | 409 | 413 | 422 | 500;

/** A JSON error response: `{ error: message }` with the given status. */
export function jsonError(status: JsonErrorStatus, message: string): Response {
  return new Response(JSON.stringify({ error: message }), {
    status,
    headers: { 'content-type': 'application/json' },
  });
}

/** True for a plain (non-array, non-null) object. */
export function isPlainObject(v: unknown): v is Record<string, unknown> {
  return v !== null && typeof v === 'object' && !Array.isArray(v);
}

/** A plain JSON object, or undefined for anything else. */
export function asObject(v: unknown): Record<string, unknown> | undefined {
  return isPlainObject(v) ? v : undefined;
}

/**
 * Parse a request's JSON body into a plain object, or `undefined` (never throws)
 * when the body is not JSON or is not an object — the shape every write route
 * maps to a 400. Keeps a malformed/hostile body from ever reaching the fs layer.
 */
export async function readJsonBody(req: Request): Promise<Record<string, unknown> | undefined> {
  try {
    return asObject((await req.json()) as unknown);
  } catch {
    return undefined;
  }
}

/**
 * Resolve `?instance=` against the registry — ONLY an already-registered
 * instance, never an attacker-chosen path. `undefined` ⇒ the caller returns 404.
 */
export function resolveInstanceFromQuery(
  c: Context,
  registry: InstanceRegistry,
): RegistryInstance | undefined {
  return registry.resolve(new URL(c.req.url).searchParams.get('instance') ?? undefined);
}

/**
 * Read + resolve the instance from a POST body's `instance` field (returns the
 * parsed body too). `undefined` ⇒ a malformed/non-object body (caller 400); a
 * present body with an unknown/missing selector yields `{ instance: undefined }`
 * (caller 404).
 */
export async function resolveInstanceFromBody(
  c: Context,
  registry: InstanceRegistry,
): Promise<{ instance?: RegistryInstance; body: Record<string, unknown> } | undefined> {
  const body = await readJsonBody(c.req.raw);
  if (!body) return undefined;
  const sel = typeof body['instance'] === 'string' ? (body['instance'] as string) : undefined;
  return { instance: registry.resolve(sel), body };
}
