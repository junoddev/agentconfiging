/**
 * Pure logic for the hooks manager (bead agentconfig-wmc.5). No React, no DOM —
 * every function here is unit-testable in isolation (see logic.test.ts) and every
 * string it returns is rendered by the page as a TEXT NODE, never markup.
 *
 * The manager edits settings.json's `hooks` block. On-disk shape (see
 * fixtures/trees/claude-rich/.claude/settings.json and src/core/parsers/claude.ts):
 *
 *   "hooks": {
 *     "<EventName>": [
 *       { "matcher"?: string, "hooks": [ { "type"?, "command"?, "timeout"? } ] }
 *     ]
 *   }
 *
 * We flatten that into a flat list of {@link HookEntry} cards for display, and we
 * build the next settings.json content by mutating a parsed copy and
 * re-serializing — so unrelated keys (model, env, permissions …) round-trip
 * untouched. Writes go out through useWriteFlow only; this module never touches
 * the API.
 *
 * REDACTION-SAVE TRAP: settings.json can carry secrets in `env`, so the server
 * serves it REDACTED (`[REDACTED:*]` marks). Serializing redacted content back to
 * disk would clobber the real secrets with the mark text. Callers MUST gate every
 * write on {@link isRedacted} / {@link contentHasRedactionMarks} and fall back to
 * read-only when redaction is present.
 */

import type { GlobalEntry, RedactionSpan } from '../../api/types.js';
import { homeRel } from '../../lib/format.js';

/** One hook command, flattened with its event + matcher context, for a card. */
export interface HookEntry {
  /** Owning event name (a key under `hooks`). */
  event: string;
  /** The matcher-group's matcher, if any. */
  matcher?: string;
  /** Hook action type — Claude Code uses `command`; other values pass through. */
  type?: string;
  /** Inert command string — surfaced, never executed. */
  command?: string;
  timeout?: number;
  /** Index of the matcher-group within `hooks[event]` (for edit/remove). */
  groupIndex: number;
  /** Index of this command within the group's `hooks` array (for remove). */
  hookIndex: number;
}

/** Result of reading the `hooks` block out of settings.json content. */
export type HooksParse =
  | { ok: true; entries: HookEntry[] }
  | { ok: false; reason: 'malformed' | 'not-object' | 'hooks-not-object' };

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

/**
 * Parse settings.json content and flatten its `hooks` block to cards.
 * - invalid JSON → `{ ok:false, reason:'malformed' }`
 * - top-level not an object → `reason:'not-object'`
 * - `hooks` present but not an object → `reason:'hooks-not-object'`
 * - `hooks` absent → `{ ok:true, entries:[] }` (a valid, hook-free file)
 *
 * Malformed group/hook entries are skipped rather than throwing, mirroring the
 * server parser's tolerance.
 */
export function parseHooksBlock(content: string): HooksParse {
  let root: unknown;
  try {
    root = JSON.parse(content);
  } catch {
    return { ok: false, reason: 'malformed' };
  }
  if (!isRecord(root)) return { ok: false, reason: 'not-object' };

  const hooks = root['hooks'];
  if (hooks === undefined) return { ok: true, entries: [] };
  if (!isRecord(hooks)) return { ok: false, reason: 'hooks-not-object' };

  const entries: HookEntry[] = [];
  for (const [event, groupList] of Object.entries(hooks)) {
    if (!Array.isArray(groupList)) continue;
    groupList.forEach((group, groupIndex) => {
      if (!isRecord(group)) return;
      const matcher = typeof group['matcher'] === 'string' ? group['matcher'] : undefined;
      const hookList = group['hooks'];
      if (!Array.isArray(hookList)) return;
      hookList.forEach((hook, hookIndex) => {
        if (!isRecord(hook)) return;
        const entry: HookEntry = { event, groupIndex, hookIndex };
        if (matcher !== undefined) entry.matcher = matcher;
        if (typeof hook['type'] === 'string') entry.type = hook['type'];
        if (typeof hook['command'] === 'string') entry.command = hook['command'];
        if (typeof hook['timeout'] === 'number') entry.timeout = hook['timeout'];
        entries.push(entry);
      });
    });
  }
  return { ok: true, entries };
}

// ── Inherited global hooks (beads 71h.4 / 71h.10) ───────────────────────────

/** The inherited ~/.claude settings file that can carry hooks. */
export interface GlobalHookSource {
  /** Absolute root of the global config dir (e.g. '/Users/x/.claude'). */
  root: string;
  /** Absolute path of its settings.json — pass to getFile as-is. */
  path: string;
}

/**
 * Derive the global Claude settings source from the machine-global report's
 * entries. Only the `.claude` home dir carries Claude Code hooks. Returns the
 * source whenever a `.claude` entry exists — even when settings.json is not
 * (yet) on disk: since bead 71h.10 the create-form can target it, and an
 * absent file is CREATED via the whole-file write fallback (the actual load
 * decides present vs absent; see {@link globalAddViaWholeFile}). Undefined
 * only when the machine has no `.claude` home at all.
 */
export function globalHookSource(
  entries: readonly Pick<GlobalEntry, 'root' | 'dir' | 'agents'>[],
): GlobalHookSource | undefined {
  const claude = entries.find((e) => e.dir === '.claude');
  return claude ? { root: claude.root, path: `${claude.root}/settings.json` } : undefined;
}

/** A global hook card: a parsed entry pinned to its source label. Since bead
 *  71h.10 these are REMOVABLE via the structured /api/hooks/edit op (gated by
 *  {@link canRemoveHookEntry}); they still never join the whole-file editors. */
export interface GlobalHookCard {
  entry: HookEntry;
  /** Display label for the owning file (e.g. '~/.claude/settings.json'). */
  source: string;
}

/** Build the cards for the global settings file's hooks. A failed or
 *  malformed parse yields [] (the page surfaces the error separately). */
export function globalHookCards(
  parse: HooksParse | undefined,
  sourceLabel: string,
): GlobalHookCard[] {
  if (parse?.ok !== true) return [];
  return parse.entries.map((entry) => ({ entry, source: sourceLabel }));
}

/** Load status of the global settings file on the Hooks page. */
export type GlobalHookStatus = 'loading' | 'ready' | 'absent' | 'error';

/**
 * True when a hook card can drive the structured REMOVE op. The endpoint
 * addresses the hook by coordinates AND pins `expected.command` as a
 * precondition, which must be a STRING — an entry without one would 400
 * (71h.9 adversarial-review addendum #1), so its [REMOVE] is hidden instead.
 */
export function canRemoveHookEntry(entry: Pick<HookEntry, 'command'>): boolean {
  return typeof entry.command === 'string';
}

/**
 * How a GLOBAL hook ADD is written (71h.9 addendum #2): the structured
 * endpoint intentionally 404s on an ABSENT file, so only an absent global
 * settings.json takes the whole-file /api/write CREATE fallback (fresh client
 * JSON — nothing redacted in a file that does not exist; the dry-run will show
 * willCreate). A PRESENT file — even a redacted one — must use the structured
 * /api/hooks/edit path.
 */
export function globalAddViaWholeFile(status: GlobalHookStatus): boolean {
  return status === 'absent';
}

/** One create-form write target: the file path plus its display label. */
export interface HookTargetOption {
  path: string;
  label: string;
  global: boolean;
}

/**
 * Compose the create-form targets: the writable project settings files plus —
 * when the machine-global source is usable (loaded, or absent-and-creatable) —
 * the global settings.json labeled with its scope (`GLOBAL · ~/.claude`).
 * A loading or errored global source never becomes a target.
 */
export function hookWriteTargets(
  projectPaths: readonly string[],
  globalSrc: GlobalHookSource | undefined,
  globalStatus: GlobalHookStatus | undefined,
): HookTargetOption[] {
  const out: HookTargetOption[] = projectPaths.map((p) => ({ path: p, label: p, global: false }));
  if (globalSrc && (globalStatus === 'ready' || globalStatus === 'absent')) {
    out.push({ path: globalSrc.path, label: `GLOBAL · ${homeRel(globalSrc.root)}`, global: true });
  }
  return out;
}

/** Group flattened entries by event, preserving first-seen event order. */
export function groupByEvent(entries: readonly HookEntry[]): Map<string, HookEntry[]> {
  const byEvent = new Map<string, HookEntry[]>();
  for (const entry of entries) {
    const list = byEvent.get(entry.event);
    if (list) list.push(entry);
    else byEvent.set(entry.event, [entry]);
  }
  return byEvent;
}

// ── Redaction-save trap ────────────────────────────────────────────────────

/** True when the server flagged any `[REDACTED:*]` span in the served file. */
export function isRedacted(spans: readonly RedactionSpan[]): boolean {
  return spans.length > 0;
}

/** Belt-and-braces scan of the raw text for a redaction mark, independent of
 *  the spans array (used to gate writes even if spans were somehow empty). */
export function contentHasRedactionMarks(content: string): boolean {
  return /\[REDACTED:/.test(content);
}

// ── Templates & drafts (create flow) ────────────────────────────────────────

/** The four quick-add hook types (SPEC §5 row 3). */
export type TemplateId = 'shell' | 'webhook' | 'guard' | 'log';

/** A draft hook the visual form edits and the templates pre-fill. */
export interface HookDraft {
  event: string;
  /** Only meaningful for matcher-scoped events; empty string = match all. */
  matcher: string;
  type: string;
  command: string;
}

/** One quick-add template: a labelled starter {@link HookDraft}. */
export interface HookTemplate {
  id: TemplateId;
  label: string;
  /** One-line description of what the starter command does. */
  hint: string;
  /** Default event for the template (the user can change it in the form). */
  event: string;
  matcher: string;
  type: string;
  command: string;
}

export const HOOK_TEMPLATES: readonly HookTemplate[] = [
  {
    id: 'shell',
    label: 'shell command',
    hint: 'run a script or command',
    event: 'PostToolUse',
    matcher: '',
    type: 'command',
    command: '.claude/hooks/my-hook.sh',
  },
  {
    id: 'webhook',
    label: 'HTTP webhook',
    hint: 'POST the event payload to a URL',
    event: 'Stop',
    matcher: '',
    type: 'command',
    command:
      'curl -sS -X POST -H "Content-Type: application/json" -d "$CLAUDE_HOOK_PAYLOAD" https://example.com/webhook',
  },
  {
    id: 'guard',
    label: 'prompt guard',
    hint: 'gate a tool call before it runs',
    event: 'PreToolUse',
    matcher: 'Bash',
    type: 'command',
    command: '.claude/hooks/guard.sh',
  },
  {
    id: 'log',
    label: 'log to file',
    hint: 'append the event to a log file',
    event: 'PostToolUse',
    matcher: '',
    type: 'command',
    command: 'echo "$CLAUDE_HOOK_EVENT $(date -u +%FT%TZ)" >> .claude/hooks.log',
  },
];

/** A blank draft for the "from scratch" visual form. */
export function emptyDraft(event: string): HookDraft {
  return { event, matcher: '', type: 'command', command: '' };
}

/** A pre-filled draft from a template. */
export function draftFromTemplate(template: HookTemplate): HookDraft {
  return {
    event: template.event,
    matcher: template.matcher,
    type: template.type,
    command: template.command,
  };
}

/** True when a draft is complete enough to serialize (needs a command). */
export function isDraftValid(draft: HookDraft): boolean {
  return draft.event.trim() !== '' && draft.command.trim() !== '';
}

// ── Serialization (build the next settings.json content) ─────────────────────

/** Parse settings content into a mutable object, or throw a terse error the
 *  caller turns into an in-panel message. Guards the redaction trap. */
function loadSettingsObject(content: string): Record<string, unknown> {
  if (contentHasRedactionMarks(content)) {
    throw new Error('refused · settings.json contains redacted secrets');
  }
  let root: unknown;
  try {
    root = JSON.parse(content);
  } catch {
    throw new Error('refused · settings.json is not valid JSON');
  }
  if (!isRecord(root)) throw new Error('refused · settings.json is not an object');
  return root;
}

/**
 * Serialize an object back to settings.json content. Two-space indent + trailing
 * newline matches the fixtures and the project's Prettier defaults, so a
 * hooks-only change produces a minimal, reviewable diff.
 */
function serialize(root: Record<string, unknown>): string {
  return JSON.stringify(root, null, 2) + '\n';
}

/**
 * Build the next settings.json content with `draft` appended as a new
 * matcher-group under its event. Preserves every other key. The matcher is
 * written only when the draft has one (empty string ⇒ omitted, matching the
 * "match all" convention). Throws on redacted/invalid content.
 */
export function addHookToSettings(content: string, draft: HookDraft): string {
  const root = loadSettingsObject(content);

  const hooksBlock = isRecord(root['hooks']) ? { ...root['hooks'] } : {};
  const eventGroups = Array.isArray(hooksBlock[draft.event])
    ? [...(hooksBlock[draft.event] as unknown[])]
    : [];

  const command: Record<string, unknown> = { type: draft.type, command: draft.command };
  const group: Record<string, unknown> = {};
  if (draft.matcher.trim() !== '') group['matcher'] = draft.matcher;
  group['hooks'] = [command];

  eventGroups.push(group);
  hooksBlock[draft.event] = eventGroups;
  root['hooks'] = hooksBlock;

  return serialize(root);
}

/**
 * Build the next settings.json content with one hook command removed, addressed
 * by the coordinates a {@link HookEntry} card carries. Empty groups and an empty
 * `hooks` block are pruned so removal never leaves dangling scaffolding. A
 * no-op (out-of-range coordinates) still round-trips the file. Throws on
 * redacted/invalid content.
 */
export function removeHookFromSettings(
  content: string,
  event: string,
  groupIndex: number,
  hookIndex: number,
): string {
  const root = loadSettingsObject(content);
  if (!isRecord(root['hooks'])) return serialize(root);

  const hooksBlock = { ...root['hooks'] };
  const eventGroups = hooksBlock[event];
  if (!Array.isArray(eventGroups)) return serialize(root);

  const groups = eventGroups.map((g) => (isRecord(g) ? { ...g } : g));
  const group = groups[groupIndex];
  if (!isRecord(group) || !Array.isArray(group['hooks'])) return serialize(root);

  const hookList = [...group['hooks']];
  if (hookIndex < 0 || hookIndex >= hookList.length) return serialize(root);
  hookList.splice(hookIndex, 1);

  if (hookList.length === 0) {
    groups.splice(groupIndex, 1);
  } else {
    group['hooks'] = hookList;
    groups[groupIndex] = group;
  }

  if (groups.length === 0) {
    delete hooksBlock[event];
  } else {
    hooksBlock[event] = groups;
  }

  if (Object.keys(hooksBlock).length === 0) {
    delete root['hooks'];
  } else {
    root['hooks'] = hooksBlock;
  }

  return serialize(root);
}
