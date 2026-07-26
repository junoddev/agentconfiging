/**
 * Pure logic for the keybindings editor (bead agentconfig-wmc.9). No React, no
 * DOM — every function here is unit-testable in isolation (see logic.test.ts) and
 * every string it returns is rendered by the page as a TEXT NODE, never markup
 * and never evaluated.
 *
 * SCHEMA IS UNCERTAIN. fixtures/README flags the keybindings.json shape as
 * "plausible-but-unofficial", so this parser treats the file as *structured
 * JSON* rather than a fixed contract. The sample (fixtures/trees/claude-rich/
 * .claude/keybindings.json) is:
 *
 *   { "bindings": [ { "context": "chat", "key": "ctrl+j", "command": "..." } ] }
 *
 * but we also tolerate:
 *   - a top-level ARRAY of bindings (no wrapper object), and
 *   - a condition carried under any of `context` / `when` / `condition`.
 * We render whatever fields are present and PRESERVE every key we do not model
 * (per-binding `extra`, plus any non-`bindings` top-level keys) so a
 * parse → edit → serialize round-trip loses nothing.
 *
 * CHORD SUPPORT: a `key` is a whitespace-separated sequence of steps
 * ("ctrl+g ctrl+s" is a two-step chord). {@link chordSteps} / {@link isChord}
 * expose that without mutating the stored combo.
 *
 * REDACTION-SAVE TRAP: keybindings.json normally holds no secrets, but for
 * consistency with the other editors we still gate writes on BOTH signals —
 * {@link isRedacted} (server spans) OR {@link contentHasRedactionMarks} (a raw
 * `[REDACTED:*]` mark). A redacted file is treated READ-ONLY: reserializing the
 * placeholder text back to disk would clobber a real value.
 *
 * All writes go out through useWriteFlow only; this module never touches the API.
 */

import type { RedactionSpan } from '../../api/types.js';

/** Condition may live under any of these keys; first present (string) wins. */
const CONDITION_KEYS = ['context', 'when', 'condition'] as const;

/**
 * One keybinding, normalized. `key` is the (possibly chorded) combo; `command`
 * is the command it runs. `condition` is the optional guard, and `conditionKey`
 * remembers which source key it came from so a round-trip re-emits it verbatim.
 * `extra` preserves any keys this model does not understand.
 */
export interface Binding {
  /** Combo; whitespace-separated steps form a chord. Rendered/stored literally. */
  key: string;
  /** Command to run — inert config text, never executed. */
  command: string;
  /** Optional guard/context, if the source carried one. */
  condition?: string;
  /** Original key name the condition came from (`context` by default on create). */
  conditionKey?: string;
  /** Unmodeled keys, preserved verbatim so a round-trip loses nothing. */
  extra: Record<string, unknown>;
}

/** Where the bindings array lived in the source document. */
export type ContainerShape = 'object' | 'array';

/** Result of parsing keybindings.json content. */
export interface ParsedKeybindings {
  /** Bindings found (malformed, non-object entries skipped). */
  bindings: Binding[];
  /**
   * The wrapper object for the `object` shape (its non-`bindings` keys are
   * preserved on serialize); null for the `array` shape or a failed/empty parse.
   */
  doc: Record<string, unknown> | null;
  /** Whether bindings lived under a wrapper object or at the document root. */
  shape: ContainerShape;
  /** True when `JSON.parse` threw — the file is unusable. */
  parseError: boolean;
  /** True when a bindings array was actually present. */
  hasBindings: boolean;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

/** Normalize one binding entry, or null when it is not a JSON object. */
export function parseBinding(raw: unknown): Binding | null {
  if (!isRecord(raw)) return null;
  const known = new Set<string>(['key', 'command']);
  const binding: Binding = { key: '', command: '', extra: {} };

  if (typeof raw['key'] === 'string') binding.key = raw['key'];
  if (typeof raw['command'] === 'string') binding.command = raw['command'];

  for (const ck of CONDITION_KEYS) {
    if (typeof raw[ck] === 'string') {
      binding.condition = raw[ck];
      binding.conditionKey = ck;
      known.add(ck);
      break;
    }
  }

  for (const [k, v] of Object.entries(raw)) {
    if (!known.has(k)) binding.extra[k] = v;
  }
  return binding;
}

/**
 * Inverse of {@link parseBinding}: the JSON value for one binding. Emits the
 * condition (under its original key name, defaulting to `context`), then `key`,
 * then `command`, then any preserved `extra` keys — so a parse → serialize
 * round-trip of an untouched binding matches the fixture's field order.
 */
export function bindingToConfig(binding: Binding): Record<string, unknown> {
  const out: Record<string, unknown> = {};
  if (binding.condition !== undefined) {
    out[binding.conditionKey ?? 'context'] = binding.condition;
  }
  out['key'] = binding.key;
  out['command'] = binding.command;
  for (const [k, v] of Object.entries(binding.extra)) out[k] = v;
  return out;
}

/**
 * Parse keybindings.json content. Tolerant of the uncertain schema:
 *  - invalid JSON → `parseError:true`
 *  - top-level array → the array IS the bindings (`shape:'array'`)
 *  - top-level object with a `bindings` array → those bindings (`shape:'object'`)
 *  - any other object → no bindings, but editable (`hasBindings:false`)
 *  - a non-object, non-array top level → nothing usable
 * Malformed entries within the array are skipped rather than throwing.
 */
export function parseKeybindings(content: string): ParsedKeybindings {
  let doc: unknown;
  try {
    doc = JSON.parse(content);
  } catch {
    return { bindings: [], doc: null, shape: 'object', parseError: true, hasBindings: false };
  }

  if (Array.isArray(doc)) {
    const bindings = doc.map(parseBinding).filter((b): b is Binding => b !== null);
    return { bindings, doc: null, shape: 'array', parseError: false, hasBindings: true };
  }

  if (!isRecord(doc)) {
    return { bindings: [], doc: null, shape: 'object', parseError: false, hasBindings: false };
  }

  const block = doc['bindings'];
  const hasBindings = Array.isArray(block);
  const bindings = hasBindings
    ? (block as unknown[]).map(parseBinding).filter((b): b is Binding => b !== null)
    : [];
  return { bindings, doc, shape: 'object', parseError: false, hasBindings };
}

/** The container context needed to reserialize (shape + preserved wrapper). */
export type Container = Pick<ParsedKeybindings, 'shape' | 'doc'>;

/**
 * Rebuild file content from a container and a new binding list. For the `object`
 * shape every non-`bindings` key in `doc` is preserved untouched; for the
 * `array` shape the document is the bindings array itself. Output is 2-space
 * JSON with a trailing newline (the repo's file convention), so a bindings-only
 * change produces a minimal, reviewable diff.
 */
export function serializeKeybindings(container: Container, bindings: readonly Binding[]): string {
  const configs = bindings.map(bindingToConfig);
  if (container.shape === 'array') {
    return JSON.stringify(configs, null, 2) + '\n';
  }
  const doc = container.doc ?? {};
  return JSON.stringify({ ...doc, bindings: configs }, null, 2) + '\n';
}

/** Replace the binding at `index`, or append when `index` is undefined. */
export function upsertBinding(
  bindings: readonly Binding[],
  updated: Binding,
  index?: number,
): Binding[] {
  if (index === undefined) return [...bindings, updated];
  return bindings.map((b, i) => (i === index ? updated : b));
}

/** Drop the binding at `index` (a no-op for out-of-range coordinates). */
export function removeBinding(bindings: readonly Binding[], index: number): Binding[] {
  return bindings.filter((_, i) => i !== index);
}

// ── Chord helpers ────────────────────────────────────────────────────────────

/** Split a combo into its chord steps (whitespace-separated, blanks dropped). */
export function chordSteps(key: string): string[] {
  return key
    .trim()
    .split(/\s+/)
    .filter((s) => s.length > 0);
}

/** True when a combo is a multi-step chord ("ctrl+g ctrl+s"). */
export function isChord(key: string): boolean {
  return chordSteps(key).length > 1;
}

// ── Redaction-save trap (dual signal) ────────────────────────────────────────

/** True when the server flagged any `[REDACTED:*]` span in the served file. */
export function isRedacted(spans: readonly RedactionSpan[]): boolean {
  return spans.length > 0;
}

/** Belt-and-braces scan of the raw text for a redaction mark, independent of the
 *  spans array (used to gate writes even if spans were somehow empty). */
export function contentHasRedactionMarks(content: string): boolean {
  return /\[REDACTED:/.test(content);
}

// ── Form <-> model ───────────────────────────────────────────────────────────

/** A blank binding for the "add" form. */
export function emptyBinding(): Binding {
  return { key: '', command: '', extra: {} };
}

/** Build a Binding from plain form fields, preserving a seed binding's `extra`
 *  and condition key. A blank condition is omitted (and its source key dropped). */
export function buildBinding(fields: {
  key: string;
  command: string;
  condition: string;
  seed?: Binding;
}): Binding {
  const binding: Binding = {
    key: fields.key.trim(),
    command: fields.command.trim(),
    extra: fields.seed ? { ...fields.seed.extra } : {},
  };
  const condition = fields.condition.trim();
  if (condition !== '') {
    binding.condition = condition;
    binding.conditionKey = fields.seed?.conditionKey ?? 'context';
  }
  return binding;
}

/** Non-empty reason a binding cannot be saved yet, or undefined when valid. */
export function invalidReason(fields: { key: string; command: string }): string | undefined {
  if (fields.key.trim() === '') return 'a key combo is required';
  if (fields.command.trim() === '') return 'a command is required';
  return undefined;
}

// ── Reset to a starter set ───────────────────────────────────────────────────

/**
 * A small, inert STARTER set — NOT the official Claude Code defaults, which are
 * not published (see fixtures/README). "Reset" writes these through the normal
 * dry-run diff so the user reviews the exact change; it never silently
 * overwrites. Non-`bindings` top-level keys in the current file are preserved.
 */
export const STARTER_BINDINGS: readonly Binding[] = [
  {
    condition: 'chat',
    conditionKey: 'context',
    key: 'ctrl+j',
    command: 'chat.insertNewline',
    extra: {},
  },
  {
    condition: 'chat',
    conditionKey: 'context',
    key: 'ctrl+g ctrl+s',
    command: 'git.status',
    extra: {},
  },
  {
    condition: 'global',
    conditionKey: 'context',
    key: 'ctrl+t',
    command: 'todos.toggle',
    extra: {},
  },
];

/** Build the file content for a reset to the starter set, preserving the
 *  container's shape and any non-`bindings` wrapper keys. */
export function buildResetContent(container: Container): string {
  return serializeKeybindings(
    container,
    STARTER_BINDINGS.map((b) => ({ ...b, extra: { ...b.extra } })),
  );
}
