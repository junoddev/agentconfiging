/**
 * hooks-edit — POST /api/hooks/edit, the STRUCTURED hook add/remove write
 * surface (bead agentconfig-71h.9, the hooks slice of wmc.11). Registered under
 * `/api` like every sibling write route, so it INHERITS the committed gates
 * (Host allowlist, bearer token, Origin/CSRF for POST — see app.ts).
 *
 * WHY A SERVER ENDPOINT: settings.json can carry secrets in `env`, so
 * GET /api/file serves it REDACTED (`[REDACTED:*]` marks) and the client-side
 * editor flow (web/src/pages/hooks/logic.ts) must refuse to serialize redacted
 * content back — writing the marks would destroy the real secrets (the
 * redaction-save trap). This endpoint takes a STRUCTURED op instead of file
 * content: the server re-reads the RAW file, applies the surgical hook
 * mutation, and writes it back — the raw bytes never cross the wire in either
 * direction, so a redacted file becomes editable without secret loss. Works for
 * project AND global paths (global config dirs are already write scopes).
 *
 * OP SEMANTICS (kept aligned with the client's hooks/logic.ts so addresses the
 * client computes from parseHooksBlock match what the server mutates):
 *  - add {event, matcher?, hook:{type,command}} — appended as a NEW matcher
 *    group under `hooks[event]` (creating the event array and/or the `hooks`
 *    block when absent), exactly like addHookToSettings: the matcher key is
 *    written only when non-blank, the group is `{matcher?, hooks:[{type,
 *    command}]}`.
 *  - remove {address:{event,groupIndex,hookIndex}, expected:{command}} — the
 *    PRECONDITION (apply-fix style): after re-parsing the raw file, the
 *    addressed hook must still exist AND its `command` must equal
 *    `expected.command`, else 409 and the file is untouched (the client's view
 *    may be stale). Removal prunes an emptied group, an emptied event array,
 *    and an emptied `hooks` block, exactly like removeHookFromSettings.
 *
 * FORMATTING NORMALIZATION (documented contract): the whole file is re-parsed
 * and re-serialized as `JSON.stringify(root, null, 2) + '\n'` — two-space
 * indent, trailing newline (the fixtures' and Prettier's shape). A file with
 * different formatting is normalized by its first structured edit; key order
 * and all non-`hooks` values round-trip untouched.
 *
 * RESPONSE mirrors /api/write's WriteResponse so the existing client write-flow
 * UX can drive it (pathScope included — the client shows the global warning off
 * it). The `diff` is REDACTED before serialization (shared core redact
 * catalogue): a hunk context line carrying a secret env value never reaches the
 * wire ([[fix-patch-carries-content]] discipline).
 *
 * ERROR DISCIPLINE (constant JSON bodies, no path echo, no content echo):
 *  - 400 'bad request'      malformed body / bad op shape / result over cap
 *  - 401                    (inherited) missing/wrong token
 *  - 403 'forbidden'        out-of-scope OR not-a-known-config-path (identical
 *                           body whether or not the path exists — no oracle);
 *                           also a symlinked leaf (ELOOP backstop)
 *  - 404 'not found'        in-scope path absent (in-scope existence is not
 *                           secret; the guard already 403'd everything else)
 *  - 409 'conflict'         precondition failed: file is not valid JSON / not
 *                           an object, remove address gone or expected.command
 *                           mismatch, add would clobber a non-object `hooks`
 *                           or a non-array event entry. File untouched.
 *  - 413 'file too large'   on-disk file over CAPS.maxFileBytes (read-cap
 *                           parity with GET /api/file)
 */

import fs from 'node:fs';
import type { Hono } from 'hono';
import { CAPS, redact } from '../core/index.js';
import { unifiedDiff } from './diff.js';
import { resolveWriteTarget, type WriteScope } from './pathguard.js';
import { commitResolved, O_NOFOLLOW, readJsonBody, statFile } from './write.js';

export interface HooksEditRoutesConfig {
  scopes: WriteScope[];
}

/** A validated structured hook edit (see module header for semantics). */
export type HookEditOp =
  | { op: 'add'; event: string; matcher?: string; hook: { type: string; command: string } }
  | {
      op: 'remove';
      address: { event: string; groupIndex: number; hookIndex: number };
      expected: { command: string };
    };

function jsonError(status: 400 | 403 | 404 | 409 | 413, message: string): Response {
  return new Response(JSON.stringify({ error: message }), {
    status,
    headers: { 'content-type': 'application/json' },
  });
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

/**
 * Validate the request body into a {@link HookEditOp}, or undefined (→ 400).
 * Everything is hostile until proven shaped: op must be 'add'|'remove'; add
 * needs a non-blank event and a hook with non-blank type + command (matching
 * the client's isDraftValid gate); remove needs integer, non-negative indexes
 * and a string expected.command.
 */
export function parseHookEditOp(body: Record<string, unknown>): HookEditOp | undefined {
  if (body['op'] === 'add') {
    const event = body['event'];
    const matcher = body['matcher'];
    const hook = body['hook'];
    if (typeof event !== 'string' || event.trim() === '') return undefined;
    if (matcher !== undefined && typeof matcher !== 'string') return undefined;
    if (!isRecord(hook)) return undefined;
    const type = hook['type'];
    const command = hook['command'];
    // The only hook shape the engine understands; a free-form type would write
    // unrecognized structures into the file.
    if (type !== 'command') return undefined;
    if (typeof command !== 'string' || command.trim() === '') return undefined;
    return {
      op: 'add',
      event,
      ...(matcher !== undefined ? { matcher } : {}),
      hook: { type, command },
    };
  }
  if (body['op'] === 'remove') {
    const address = body['address'];
    const expected = body['expected'];
    if (!isRecord(address) || !isRecord(expected)) return undefined;
    const event = address['event'];
    const groupIndex = address['groupIndex'];
    const hookIndex = address['hookIndex'];
    const command = expected['command'];
    if (typeof event !== 'string' || event === '') return undefined;
    if (typeof groupIndex !== 'number' || !Number.isInteger(groupIndex) || groupIndex < 0)
      return undefined;
    if (typeof hookIndex !== 'number' || !Number.isInteger(hookIndex) || hookIndex < 0)
      return undefined;
    if (typeof command !== 'string') return undefined;
    return { op: 'remove', address: { event, groupIndex, hookIndex }, expected: { command } };
  }
  return undefined;
}

/** Serialize with the documented normalization: 2-space indent + trailing \n. */
function serialize(root: Record<string, unknown>): string {
  return JSON.stringify(root, null, 2) + '\n';
}

export type HookEditApplied = { ok: true; next: string } | { ok: false; status: 409 };

/**
 * Apply a validated op to the RAW file content. Pure: parse → mutate the
 * `hooks` block only → re-serialize. Every failure is a 409 precondition (the
 * file on disk does not support the requested edit) and touches nothing.
 *
 * Divergence note vs the client's addHookToSettings: where the client SILENTLY
 * replaces a non-object `hooks` / non-array event entry (it only runs after
 * parseHooksBlock succeeded, so the case is unreachable there), the server
 * REFUSES with 409 — a structured edit must never clobber unrecognized data in
 * the raw file.
 */
export function applyHookEdit(raw: string, op: HookEditOp): HookEditApplied {
  let parsed: unknown;
  try {
    parsed = JSON.parse(raw);
  } catch {
    return { ok: false, status: 409 };
  }
  if (!isRecord(parsed)) return { ok: false, status: 409 };
  const root = { ...parsed };

  if (op.op === 'add') {
    // Own-property reads throughout: `op.event` is request-chosen, and a plain
    // read/write of a prototype-named key ('__proto__', 'toString') would hit
    // Object.prototype instead of the file's own data.
    const existingHooks = Object.hasOwn(root, 'hooks') ? root['hooks'] : undefined;
    if (existingHooks !== undefined && !isRecord(existingHooks)) return { ok: false, status: 409 };
    const hooksBlock = isRecord(existingHooks) ? { ...existingHooks } : {};
    const existingGroups = Object.hasOwn(hooksBlock, op.event) ? hooksBlock[op.event] : undefined;
    if (existingGroups !== undefined && !Array.isArray(existingGroups))
      return { ok: false, status: 409 };
    const eventGroups = Array.isArray(existingGroups) ? [...existingGroups] : [];

    const command: Record<string, unknown> = { type: op.hook.type, command: op.hook.command };
    const group: Record<string, unknown> = {};
    if (op.matcher !== undefined && op.matcher.trim() !== '') group['matcher'] = op.matcher;
    group['hooks'] = [command];

    eventGroups.push(group);
    // defineProperty, not assignment: `obj['__proto__'] = x` on a plain object
    // triggers the prototype setter and silently drops the data.
    Object.defineProperty(hooksBlock, op.event, {
      value: eventGroups,
      enumerable: true,
      writable: true,
      configurable: true,
    });
    root['hooks'] = hooksBlock;
    return { ok: true, next: serialize(root) };
  }

  // remove — every navigation step is a PRECONDITION: a miss means the client's
  // address is stale (or the file never had the shape) → 409, file untouched.
  const { event, groupIndex, hookIndex } = op.address;
  if (!Object.hasOwn(root, 'hooks') || !isRecord(root['hooks'])) return { ok: false, status: 409 };
  const hooksBlock = { ...root['hooks'] };
  const eventGroups = Object.hasOwn(hooksBlock, event) ? hooksBlock[event] : undefined;
  if (!Array.isArray(eventGroups)) return { ok: false, status: 409 };

  const groups = eventGroups.map((g) => (isRecord(g) ? { ...g } : g));
  const group = groups[groupIndex];
  if (!isRecord(group) || !Array.isArray(group['hooks'])) return { ok: false, status: 409 };

  const hookList = [...group['hooks']];
  const target: unknown = hookList[hookIndex];
  if (hookIndex >= hookList.length || !isRecord(target)) return { ok: false, status: 409 };
  if (target['command'] !== op.expected.command) return { ok: false, status: 409 };
  hookList.splice(hookIndex, 1);

  // Prune emptied scaffolding exactly like the client's removeHookFromSettings.
  if (hookList.length === 0) {
    groups.splice(groupIndex, 1);
  } else {
    group['hooks'] = hookList;
    groups[groupIndex] = group;
  }
  if (groups.length === 0) {
    delete hooksBlock[event];
  } else {
    Object.defineProperty(hooksBlock, event, {
      value: groups,
      enumerable: true,
      writable: true,
      configurable: true,
    });
  }
  if (Object.keys(hooksBlock).length === 0) {
    delete root['hooks'];
  } else {
    root['hooks'] = hooksBlock;
  }
  return { ok: true, next: serialize(root) };
}

export function registerHooksEditRoute(app: Hono, config: HooksEditRoutesConfig): void {
  const { scopes } = config;

  app.post('/api/hooks/edit', async (c) => {
    const body = await readJsonBody(c.req.raw);
    if (!body) return jsonError(400, 'bad request');

    const op = parseHookEditOp(body);
    if (!op) return jsonError(400, 'bad request');
    const dryRun = body['dryRun'];
    if (dryRun !== undefined && typeof dryRun !== 'boolean') return jsonError(400, 'bad request');

    // The SAME path guard as every write: input discipline, scope containment,
    // config allowlist, symlink defenses. Global scopes are already present.
    const resolved = resolveWriteTarget(body['path'], scopes);
    if (!resolved.ok)
      return jsonError(resolved.status, resolved.status === 400 ? 'bad request' : 'forbidden');

    const st = statFile(resolved.absPath);
    if (!st) {
      // Exists but is not a regular file (a dir) → 403, never an EISDIR.
      if (fs.existsSync(resolved.absPath)) return jsonError(403, 'forbidden');
      // A structured edit needs an existing file to edit; in-scope existence
      // is not secret (the guard already 403'd everything out of scope).
      return jsonError(404, 'not found');
    }
    if (st.size > CAPS.maxFileBytes) return jsonError(413, 'file too large');

    // O_NOFOLLOW backstop on the READ too: refuse a symlinked leaf swapped in
    // after the guard rather than read (and then write) through it.
    let fd: number;
    try {
      fd = fs.openSync(resolved.absPath, fs.constants.O_RDONLY | O_NOFOLLOW);
    } catch (err) {
      const code = (err as NodeJS.ErrnoException).code;
      if (code === 'ELOOP') return jsonError(403, 'forbidden');
      if (code === 'ENOENT') return jsonError(404, 'not found');
      throw err;
    }
    let raw: string;
    try {
      raw = fs.readFileSync(fd, 'utf-8');
    } finally {
      fs.closeSync(fd);
    }

    const applied = applyHookEdit(raw, op);
    if (!applied.ok) return jsonError(409, 'conflict');
    if (Buffer.byteLength(applied.next, 'utf-8') > CAPS.maxFileBytes)
      return jsonError(400, 'bad request');

    // The ONLY disclosure of file content: the unified diff, REDACTED before it
    // is serialized — a secret in a context line becomes a [REDACTED:*] mark.
    const diff = redact(unifiedDiff(raw, applied.next, resolved.relPath)).text;

    if (dryRun !== false) {
      return c.json({
        diff,
        willCreate: false,
        willModify: true,
        pathScope: resolved.scope.kind,
      });
    }

    try {
      commitResolved(resolved, applied.next);
    } catch (err) {
      if ((err as NodeJS.ErrnoException).code === 'ELOOP') return jsonError(403, 'forbidden');
      throw err;
    }
    return c.json({
      committed: true,
      created: false,
      modified: true,
      path: resolved.relPath,
      pathScope: resolved.scope.kind,
      diff,
    });
  });
}
