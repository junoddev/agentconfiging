/**
 * pty-routes — the non-WS HTTP surface for the embedded terminal (SPEC §5 row
 * 11, bead agentconfig-ngs.2). Registered under `/api`, so it INHERITS the
 * hardened app's gates (Host allowlist, bearer token, same-origin/CSRF).
 *
 * The PTY data pipe itself is a WebSocket handled at the transport layer (see
 * ./pty.ts `handlePtyUpgrade`, wired in ./index.ts) — Hono has no WS over the
 * node bridge. This module exposes only the capability probe:
 *
 *   GET /api/pty/status?instance= → { available, interactive, shells, reason? }
 *
 * `available` is true ONLY when the server was launched interactively AND the
 * optional node-pty module is loadable. Daemon mode or a missing native module
 * degrades to `{ available:false, reason }` (a 200) with an empty shell list —
 * the terminal UI renders a clear unavailable state and the rest of the app
 * keeps working. `shells` are the VALIDATED launch choices for the resolved
 * instance (the plain shell + each detected runtime's allowlisted CLI); they are
 * never raw commands, and the WS upgrade re-validates the chosen id server-side.
 */

import type { Hono } from 'hono';
import type { InstanceRegistry, RegistryInstance } from './registry.js';
import {
  PtyManager,
  REASON_NOT_INTERACTIVE,
  REASON_NO_MODULE,
  shellChoices,
  type ShellChoice,
} from './pty.js';

export interface PtyRoutesConfig {
  /** The shared PTY manager (interactive flag + native loader live here). */
  manager: PtyManager;
  /** Resolves `?instance=` to the scope whose detected runtimes seed the choices. */
  registry: InstanceRegistry;
}

export interface PtyStatus {
  available: boolean;
  interactive: boolean;
  shells: ShellChoice[];
  reason?: string;
}

/** Detected runtime kinds for an instance (from its cached report). Never throws. */
function detectedKinds(registry: InstanceRegistry, instance: RegistryInstance): string[] {
  try {
    return registry.report(instance).agents.map((a) => a.kind);
  } catch {
    return [];
  }
}

export function registerPtyRoutes(app: Hono, config: PtyRoutesConfig): void {
  const { manager, registry } = config;

  app.get('/api/pty/status', async (c) => {
    // INTERACTIVE-ONLY: a daemon-mode server never exposes a terminal.
    if (!manager.interactive) {
      const body: PtyStatus = {
        available: false,
        interactive: false,
        shells: [],
        reason: REASON_NOT_INTERACTIVE,
      };
      return c.json(body);
    }

    // OPTIONAL NATIVE MODULE: node-pty must be loadable.
    const spawner = await manager.loadSpawner();
    if (!spawner) {
      const body: PtyStatus = {
        available: false,
        interactive: true,
        shells: [],
        reason: REASON_NO_MODULE,
      };
      return c.json(body);
    }

    // Resolve the instance (already-registered only) and compute its choices.
    const instance = registry.resolve(new URL(c.req.url).searchParams.get('instance') ?? undefined);
    const kinds = instance ? detectedKinds(registry, instance) : [];
    const shells = shellChoices(kinds, manager.env, manager.platform);
    const body: PtyStatus = { available: true, interactive: true, shells };
    return c.json(body);
  });
}
