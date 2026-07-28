/** Pure logic for the agent list + detail views (bead c6p.3). DOM-free and
 *  React-free so it is unit-testable in isolation; the pages (Agents.tsx,
 *  AgentDetail.tsx) are thin renderers over these helpers.
 *
 *  Everything here treats report/extras data as UNTRUSTED (parsed config, some
 *  of it attacker-controlled): values only ever become plain strings, never
 *  markup. The pages then emit them as text nodes. */

import type {
  Confidence,
  DetectedAgent,
  GlobalEntry,
  Report,
  ReportFinding,
} from '../../api/types.js';
import type { ConfigSource } from '../../components/signal/index.js';
import type { Severity as RowSeverity } from '../../components/core/index.js';

/** Find the detected agent for a route `kind`, or undefined when unknown. */
export function findAgent(report: Report | undefined, kind: string): DetectedAgent | undefined {
  return report?.agents.find((a) => a.kind === kind);
}

/** Findings scoped to one agent kind (findings are content-free; `.agent`
 *  links each to a runtime). Preserves report order. */
export function findingsForAgent(report: Report | undefined, kind: string): ReportFinding[] {
  return report?.findings.filter((f) => f.agent === kind) ?? [];
}

/** Detector confidence → VU meter level in [0, 1]. Three discrete rungs; matches
 *  the terse low/medium/high rating the detectors emit. */
export function confidenceLevel(confidence: Confidence): number {
  switch (confidence) {
    case 'low':
      return 0.3;
    case 'medium':
      return 0.6;
    case 'high':
      return 0.9;
  }
}

/** Wire finding severity → the core FindingRow's severity vocabulary. */
export function toRowSeverity(severity: ReportFinding['severity']): RowSeverity {
  switch (severity) {
    case 'error':
      return 'error';
    case 'warning':
      return 'warn';
    case 'info':
      return 'ok';
  }
}

/** Agent file paths → waveform config sources. Only paths are known here (size
 *  is unused by the fingerprint's path-driven seed), so size is 0. */
export function toConfigSources(files: readonly string[]): ConfigSource[] {
  return files.map((path) => ({ path, size: 0 }));
}

/** Href into the artifact browser (c6p.4) for one file path. The path is
 *  percent-encoded so slashes, spaces, and hostile characters round-trip
 *  through the query string without breaking the hash route. */
export function artifactHref(path: string): string {
  return `#/artifacts?path=${encodeURIComponent(path)}`;
}

/** Global (inherited) entries worth listing on the agent pages: only dirs where
 *  the scanner actually detected agents. Preserves server order. Pure filter —
 *  an empty result means the pages render exactly as they do today. */
export function globalAgentEntries(entries: readonly GlobalEntry[]): GlobalEntry[] {
  return entries.filter((e) => e.agents.length > 0);
}

/** One global config file for an agent kind: the entry-relative path the report
 *  carries, plus the absolute path (root + rel) the file API is addressed by. */
export interface GlobalKindFile {
  rel: string;
  abs: string;
}

/** The global files contributed to one agent kind by one global config dir. */
export interface GlobalKindGroup {
  /** Real path of the global config dir (filesystem data — text nodes only). */
  root: string;
  files: GlobalKindFile[];
}

/** Join a global entry root and an entry-relative file into an absolute path.
 *  Roots are realpaths (no trailing slash), but normalize defensively. */
function joinGlobalPath(root: string, rel: string): string {
  return `${root.replace(/\/+$/, '')}/${rel}`;
}

/** Per-global-dir file groups for one agent kind (E12, AgentDetail FILES
 *  grouping). Only entries where the SAME kind was detected with at least one
 *  file contribute a group; entry order is preserved. */
export function globalFilesForKind(
  entries: readonly GlobalEntry[],
  kind: string,
): GlobalKindGroup[] {
  const groups: GlobalKindGroup[] = [];
  for (const entry of entries) {
    const match = entry.agents.find((a) => a.kind === kind);
    if (!match || match.files.length === 0) continue;
    groups.push({
      root: entry.root,
      files: match.files.map((rel) => ({ rel, abs: joinGlobalPath(entry.root, rel) })),
    });
  }
  return groups;
}

/** One flattened extras entry: a dotted key and its stringified value. */
export interface ExtraRow {
  key: string;
  value: string;
}

function isPlainObject(v: unknown): v is Record<string, unknown> {
  return typeof v === 'object' && v !== null && !Array.isArray(v);
}

/** Stringify a leaf value safely — never `[object Object]`, never markup. */
function scalarToString(v: unknown): string {
  if (v === null) return 'null';
  if (v === undefined) return 'undefined';
  switch (typeof v) {
    case 'string':
      return v;
    case 'number':
    case 'boolean':
      return String(v);
    case 'bigint':
      return `${v}n`;
    case 'symbol':
      return v.toString();
    case 'function':
      return '[function]';
    default:
      return String(v);
  }
}

/**
 * Flatten an extras bag into readable key/value rows. Nested objects/arrays
 * become dotted (`a.b`) / indexed (`a[0]`) keys down to their leaves; empty
 * containers render as `{}` / `[]`. A `seen` set guards against circular refs
 * (report data arrives as JSON so cycles are not expected, but adversarial
 * shapes must not hang the render).
 */
export function extrasToRows(extras: Record<string, unknown>): ExtraRow[] {
  const rows: ExtraRow[] = [];
  const seen = new WeakSet<object>();
  // Bound recursion: extras is attacker-influenceable parsed config, so a
  // pathologically deep shape must not blow the stack and white-screen the page
  // (the cycle guard alone doesn't cover an acyclic 50k-deep object).
  const MAX_DEPTH = 32;

  const walk = (key: string, value: unknown, depth: number): void => {
    if (depth > MAX_DEPTH) {
      rows.push({ key, value: '[too deep]' });
      return;
    }
    if (Array.isArray(value)) {
      if (value.length === 0) {
        rows.push({ key, value: '[]' });
        return;
      }
      if (seen.has(value)) {
        rows.push({ key, value: '[circular]' });
        return;
      }
      seen.add(value);
      value.forEach((item, i) => walk(`${key}[${i}]`, item, depth + 1));
      return;
    }
    if (isPlainObject(value)) {
      const entries = Object.entries(value);
      if (entries.length === 0) {
        rows.push({ key, value: '{}' });
        return;
      }
      if (seen.has(value)) {
        rows.push({ key, value: '[circular]' });
        return;
      }
      seen.add(value);
      for (const [k, v] of entries) walk(`${key}.${k}`, v, depth + 1);
      return;
    }
    rows.push({ key, value: scalarToString(value) });
  };

  for (const [k, v] of Object.entries(extras)) walk(k, v, 0);
  return rows;
}
