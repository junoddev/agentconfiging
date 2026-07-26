/**
 * settings/model.ts — the PURE transforms behind the settings.json editor (bead
 * agentconfig-wmc.2). DOM-free and side-effect-free so the parse → edit →
 * serialize round-trip is unit-tested without React or a server.
 *
 * REDACTION-SAVE TRAP (the data-safety crux — see {@link hasRedactions}):
 * GET /api/file returns REDACTED content — secret-shaped values (notably `env`
 * values) are replaced server-side with visible `[REDACTED:*]` marks so a raw
 * secret never crosses the wire. If the editor let a user save that content
 * back, it would write the placeholder `[REDACTED:*]` OVER the real secret and
 * destroy it. So a file with ANY redaction span is treated as READ-ONLY here:
 * `parseSettings` still parses it (for display), but the page must not offer a
 * save. This module never emits a redacted placeholder as a value.
 */

import type { RedactionSpan } from '../../api/index.js';

/** The known settings.json fields the visual editor manages. */
export interface SettingsModel {
  model: string;
  defaultMode: string;
  allow: string[];
  ask: string[];
  deny: string[];
  /** Ordered [key, value] pairs — order preserved on round-trip. */
  env: Array<[string, string]>;
  statusLineType: string;
  statusLineCommand: string;
}

export interface ParsedSettings {
  ok: true;
  /** The full parsed object — unknown keys (hooks, additionalDirectories, …) are
   *  preserved verbatim through {@link serializeSettings}. */
  raw: Record<string, unknown>;
  model: SettingsModel;
  /** True if settings.json declares any hooks (shown read-only; wmc.5 owns them). */
  hasHooks: boolean;
  hookEventCount: number;
}

export interface ParseFailure {
  ok: false;
}

/** A served file carries redacted secrets when it has any redaction span. */
export function hasRedactions(spans: readonly RedactionSpan[]): boolean {
  return spans.length > 0;
}

function isObject(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === 'object' && !Array.isArray(value);
}

/** Coerce an unknown JSON value to a list of non-empty strings. */
function toStringList(value: unknown): string[] {
  if (!Array.isArray(value)) return [];
  return value.filter((v): v is string => typeof v === 'string');
}

function toString(value: unknown): string {
  return typeof value === 'string' ? value : '';
}

/** Empty baseline for a not-yet-created settings.json. */
export function emptyModel(): SettingsModel {
  return {
    model: '',
    defaultMode: '',
    allow: [],
    ask: [],
    deny: [],
    env: [],
    statusLineType: '',
    statusLineCommand: '',
  };
}

/**
 * Parse served (already-redacted) settings.json content into the editor model.
 * Returns `{ ok: false }` on invalid JSON so the page can fall back to a
 * read-only raw view instead of guessing.
 */
export function parseSettings(content: string): ParsedSettings | ParseFailure {
  let raw: unknown;
  try {
    raw = JSON.parse(content);
  } catch {
    return { ok: false };
  }
  if (!isObject(raw)) return { ok: false };

  const perms = isObject(raw['permissions']) ? raw['permissions'] : {};
  const env: Array<[string, string]> = isObject(raw['env'])
    ? Object.entries(raw['env']).map(([k, v]) => [k, typeof v === 'string' ? v : String(v)])
    : [];
  const statusLine = isObject(raw['statusLine']) ? raw['statusLine'] : {};
  const hooks = isObject(raw['hooks']) ? raw['hooks'] : undefined;

  return {
    ok: true,
    raw,
    hasHooks: hooks !== undefined && Object.keys(hooks).length > 0,
    hookEventCount: hooks ? Object.keys(hooks).length : 0,
    model: {
      model: toString(raw['model']),
      defaultMode: toString(perms['defaultMode']),
      allow: toStringList(perms['allow']),
      ask: toStringList(perms['ask']),
      deny: toStringList(perms['deny']),
      env,
      statusLineType: toString(statusLine['type']),
      statusLineCommand: toString(statusLine['command']),
    },
  };
}

function setOrDelete(obj: Record<string, unknown>, key: string, value: string): void {
  if (value.trim() !== '') obj[key] = value;
  else delete obj[key];
}

function setListOrDelete(obj: Record<string, unknown>, key: string, list: string[]): void {
  const cleaned = list.map((s) => s.trim()).filter((s) => s !== '');
  if (cleaned.length > 0) obj[key] = cleaned;
  else delete obj[key];
}

/**
 * Serialize the editor model back to settings.json TEXT, preserving every
 * unknown key on `raw` (hooks, permissions.additionalDirectories, statusLine
 * extras, …) — the editor only ever rewrites the fields it manages, never drops
 * data it did not surface. Returns pretty JSON with a trailing newline (the
 * file convention). This is the `content` handed to useWriteFlow.
 */
export function serializeSettings(raw: Record<string, unknown>, model: SettingsModel): string {
  const obj: Record<string, unknown> = { ...raw };

  setOrDelete(obj, 'model', model.model);

  const perms: Record<string, unknown> = isObject(raw['permissions'])
    ? { ...raw['permissions'] }
    : {};
  setOrDelete(perms, 'defaultMode', model.defaultMode);
  setListOrDelete(perms, 'allow', model.allow);
  setListOrDelete(perms, 'ask', model.ask);
  setListOrDelete(perms, 'deny', model.deny);
  if (Object.keys(perms).length > 0) obj['permissions'] = perms;
  else delete obj['permissions'];

  const env: Record<string, string> = {};
  for (const [k, v] of model.env) {
    const key = k.trim();
    if (key !== '') env[key] = v;
  }
  if (Object.keys(env).length > 0) obj['env'] = env;
  else delete obj['env'];

  const statusLine: Record<string, unknown> = isObject(raw['statusLine'])
    ? { ...raw['statusLine'] }
    : {};
  if (model.statusLineCommand.trim() !== '') {
    statusLine['type'] = model.statusLineType.trim() !== '' ? model.statusLineType : 'command';
    statusLine['command'] = model.statusLineCommand;
    obj['statusLine'] = statusLine;
  } else {
    delete obj['statusLine'];
  }

  return JSON.stringify(obj, null, 2) + '\n';
}

/** The four documented Claude permission modes, plus an unset option. */
export const PERMISSION_MODES: readonly string[] = [
  '',
  'default',
  'acceptEdits',
  'plan',
  'bypassPermissions',
];
