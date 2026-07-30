/**
 * settings/effective.ts — pure logic for the EFFECTIVE CONFIG table (Console
 * E13.4). Flattens each scope's parsed settings.json into dotted keys and
 * merges them under the documented precedence: local overrides project
 * overrides global. The winning value wears the `.win` accent and its scope
 * badge; a well-known key set by no scope surfaces as a dashed `s-default`
 * row so defaults are visible rather than implied.
 *
 * DOM-free and side-effect-free; all values are strings destined for text
 * nodes (settings content is adversarial data — never markup). Redacted
 * placeholders pass through verbatim: this table only displays.
 */

/** Which layer a value came from. `default` = no file sets the key. */
export type EffectiveScope = 'global' | 'project' | 'local' | 'default';

/** Precedence, weakest first: global < project < local. */
const PRECEDENCE: readonly Exclude<EffectiveScope, 'default'>[] = ['global', 'project', 'local'];

export interface EffectiveRow {
  key: string;
  /** Per-scope display value; undefined = not set in that scope. */
  values: Partial<Record<Exclude<EffectiveScope, 'default'>, string>>;
  /** The layer whose value wins. */
  win: EffectiveScope;
  /** The winning display value. */
  effective: string;
}

/** Bound recursion: settings.json is parsed (adversarial) data — a
 *  pathologically deep object must not blow the stack. */
const MAX_DEPTH = 32;

/** Stringify a leaf for display: scalars verbatim, arrays/others as JSON. */
function leafToString(value: unknown): string {
  if (typeof value === 'string') return value;
  if (typeof value === 'number' || typeof value === 'boolean') return String(value);
  if (value === null) return 'null';
  try {
    return JSON.stringify(value) ?? String(value);
  } catch {
    return String(value);
  }
}

function isPlainObject(v: unknown): v is Record<string, unknown> {
  return typeof v === 'object' && v !== null && !Array.isArray(v);
}

/** Flatten a parsed settings object into dotted-key → display-value pairs.
 *  Plain objects recurse (empty ones render as `{}`); arrays and scalars are
 *  leaves. Insertion order is preserved. */
export function flattenSettings(raw: Record<string, unknown>): Map<string, string> {
  const out = new Map<string, string>();
  const walk = (prefix: string, value: unknown, depth: number): void => {
    if (isPlainObject(value) && depth <= MAX_DEPTH) {
      const entries = Object.entries(value);
      if (entries.length === 0) {
        out.set(prefix, '{}');
        return;
      }
      for (const [k, v] of entries) walk(prefix === '' ? k : `${prefix}.${k}`, v, depth + 1);
      return;
    }
    out.set(prefix, leafToString(value));
  };
  for (const [k, v] of Object.entries(raw)) walk(k, v, 0);
  return out;
}

/** Well-known keys whose built-in behavior is worth surfacing when no scope
 *  sets them: the value shown is the documented fallback, badged `s-default`. */
export const KNOWN_DEFAULTS: ReadonlyArray<[key: string, value: string]> = [
  ['model', '(inherit)'],
  ['permissions.defaultMode', 'default'],
];

export interface ScopeInputs {
  global?: Record<string, unknown>;
  project?: Record<string, unknown>;
  local?: Record<string, unknown>;
}

/** Merge the flattened scopes into effective rows, sorted by key. Every key
 *  present in ANY scope gets a row; the winning value follows precedence
 *  (local > project > global). Unset well-known keys append `default` rows. */
export function effectiveRows(scopes: ScopeInputs): EffectiveRow[] {
  const flat: Record<string, Map<string, string>> = {
    global: flattenSettings(scopes.global ?? {}),
    project: flattenSettings(scopes.project ?? {}),
    local: flattenSettings(scopes.local ?? {}),
  };

  const keys = new Set<string>();
  for (const scope of PRECEDENCE) for (const key of flat[scope]!.keys()) keys.add(key);

  const rows: EffectiveRow[] = [];
  for (const key of [...keys].sort()) {
    const values: EffectiveRow['values'] = {};
    let win: EffectiveScope = 'default';
    let effective = '';
    for (const scope of PRECEDENCE) {
      const value = flat[scope]!.get(key);
      if (value !== undefined) {
        values[scope] = value;
        win = scope; // later scopes in PRECEDENCE override
        effective = value;
      }
    }
    rows.push({ key, values, win, effective });
  }

  for (const [key, value] of KNOWN_DEFAULTS) {
    if (!keys.has(key)) rows.push({ key, values: {}, win: 'default', effective: value });
  }

  rows.sort((a, b) => (a.key < b.key ? -1 : a.key > b.key ? 1 : 0));
  return rows;
}

/** Case-insensitive search over the key and every displayed value. */
export function matchesQuery(row: EffectiveRow, query: string): boolean {
  const q = query.trim().toLowerCase();
  if (q === '') return true;
  if (row.key.toLowerCase().includes(q)) return true;
  if (row.effective.toLowerCase().includes(q)) return true;
  return Object.values(row.values).some((v) => v !== undefined && v.toLowerCase().includes(q));
}

/** Apply the scope chip + search filters. `scope` filters by WINNING layer
 *  ('all' passes everything). */
export function filterRows(
  rows: readonly EffectiveRow[],
  scope: 'all' | EffectiveScope,
  query: string,
): EffectiveRow[] {
  return rows.filter((row) => (scope === 'all' || row.win === scope) && matchesQuery(row, query));
}
