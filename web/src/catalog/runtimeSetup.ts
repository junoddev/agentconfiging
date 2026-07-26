/**
 * Pure logic for RUNTIME SCAFFOLDING (bead agentconfig-0zm.6, SPEC §4.5/§5). A
 * runtime setup is INSTALLING a `runtime-template` catalog entry — the guarded
 * install path already exists (0zm.4); this module only DERIVES the guided
 * picker's model: which known runtimes have a real starter template, which files
 * each would scaffold, and whether a runtime is already set up (agentconfig
 * installed it) or merely detected in the project. DOM-free and React-free so the
 * load-bearing derivation is unit-testable; RuntimeScaffold.tsx is a thin render.
 *
 * Registry text (entry names/descriptions/paths/tags) is UNTRUSTED — these
 * functions only compare/collect strings into plain values; callers render every
 * field as a text node, never markup.
 */

import type { CatalogEntryMeta, DetectedAgent, InstalledRecord } from '../api/types.js';

/** The catalog kind a runtime-template entry carries (SPEC §4.5). */
export const RUNTIME_TEMPLATE_KIND = 'runtime-template';

/**
 * One runtime agentconfig knows about. This is a DISPLAY list — the web app
 * cannot import src/, so it mirrors the runtime knowledge in
 * `src/core/runtimes/table.ts` (display names + identifying slugs + detector
 * kinds), NOT any template content. A runtime with a matching runtime-template
 * catalog entry becomes an installable scaffold; one without shows "template
 * coming soon" (honest — no template is fabricated).
 */
export interface KnownRuntime {
  /** Stable runtime id (mirrors src/core/runtimes/table.ts ids). */
  id: string;
  displayName: string;
  /** Tags a runtime-template entry stamps to identify this runtime's template. */
  slugs: string[];
  /** DetectedAgent.kind values that mean this runtime is present in the project. */
  detectKinds: string[];
}

/**
 * The runtimes agentconfig recognises (mirrors src/core/runtimes/table.ts: the 8
 * first-class runtimes + the long-tail sync targets). Only cursor/codex/gemini
 * have a seed runtime-template today; the rest surface as "coming soon" until a
 * template ships, and light up automatically once a matching entry appears in the
 * catalog. Kept in table order: first-class runtimes, then long-tail.
 */
export const KNOWN_RUNTIMES: readonly KnownRuntime[] = [
  { id: 'aider', displayName: 'Aider', slugs: ['aider'], detectKinds: ['aider'] },
  {
    id: 'claude-code',
    displayName: 'Claude Code',
    slugs: ['claude-code', 'claude'],
    detectKinds: ['claude-code'],
  },
  { id: 'codex', displayName: 'OpenAI Codex', slugs: ['codex'], detectKinds: ['codex'] },
  { id: 'continue', displayName: 'Continue', slugs: ['continue'], detectKinds: ['continue'] },
  { id: 'copilot', displayName: 'GitHub Copilot', slugs: ['copilot'], detectKinds: ['copilot'] },
  { id: 'cursor', displayName: 'Cursor', slugs: ['cursor'], detectKinds: ['cursor'] },
  {
    id: 'gemini-cli',
    displayName: 'Gemini CLI',
    slugs: ['gemini', 'gemini-cli'],
    detectKinds: ['gemini-cli'],
  },
  { id: 'opencode', displayName: 'opencode', slugs: ['opencode'], detectKinds: ['opencode'] },
  {
    id: 'amazon-q',
    displayName: 'Amazon Q Developer',
    slugs: ['amazon-q'],
    detectKinds: ['amazon-q'],
  },
  { id: 'cline', displayName: 'Cline', slugs: ['cline'], detectKinds: ['cline'] },
  { id: 'junie', displayName: 'JetBrains Junie', slugs: ['junie'], detectKinds: ['junie'] },
  { id: 'qodo', displayName: 'Qodo', slugs: ['qodo'], detectKinds: ['qodo'] },
  { id: 'roo', displayName: 'Roo Code', slugs: ['roo'], detectKinds: ['roo'] },
  { id: 'windsurf', displayName: 'Windsurf', slugs: ['windsurf'], detectKinds: ['windsurf'] },
  { id: 'zed', displayName: 'Zed', slugs: ['zed'], detectKinds: ['zed'] },
];

/**
 * A materialised runtime-setup row. `entry` present ⇒ a real installable template
 * (drives the dry-run → commit flow); absent ⇒ "coming soon". `scaffolded` means
 * agentconfig installed the template on this instance (⇒ REMOVE); `detected`
 * means the runtime is otherwise present in the project report.
 */
export interface RuntimeSetup {
  /** Runtime id, or the entry key for a template not tied to a known runtime. */
  id: string;
  displayName: string;
  /** The runtime-template entry that scaffolds this runtime (undefined = coming soon). */
  entry?: CatalogEntryMeta;
  /** Project-relative files the template would scaffold (empty when coming soon). */
  files: string[];
  /** agentconfig installed this template on the resolved instance. */
  scaffolded: boolean;
  /** The runtime is present in the project report (may pre-date agentconfig). */
  detected: boolean;
  /** The install provenance record, when scaffolded. */
  installedRecord?: InstalledRecord;
}

/** The runtime-template entries in a catalog, order preserved. */
export function runtimeTemplateEntries(entries: CatalogEntryMeta[]): CatalogEntryMeta[] {
  return entries.filter((e) => e.kind === RUNTIME_TEMPLATE_KIND);
}

/** The set of detector kinds present in the current report (drives the DETECTED badge). */
export function detectedKindSet(agents: DetectedAgent[]): Set<string> {
  return new Set(agents.map((a) => a.kind));
}

/** The runtime-template entry (if any) whose tags claim a known runtime. */
function entryForRuntime(
  rt: KnownRuntime,
  templates: CatalogEntryMeta[],
): CatalogEntryMeta | undefined {
  const slugs = new Set(rt.slugs);
  return templates.find((e) => e.tags.some((t) => slugs.has(t)));
}

/**
 * Build the guided runtime-setup rows: one per known runtime (in table order),
 * plus a trailing row for any runtime-template entry not claimed by a known
 * runtime (so a newly-seeded template is surfaced honestly, never hidden).
 */
export function buildRuntimeSetups(
  entries: CatalogEntryMeta[],
  installed: Map<string, InstalledRecord>,
  detected: Set<string>,
  runtimes: readonly KnownRuntime[] = KNOWN_RUNTIMES,
): RuntimeSetup[] {
  const templates = runtimeTemplateEntries(entries);
  const claimed = new Set<string>();
  const setups: RuntimeSetup[] = [];

  for (const rt of runtimes) {
    const entry = entryForRuntime(rt, templates);
    if (entry) claimed.add(entry.key);
    const rec = entry ? installed.get(entry.key) : undefined;
    setups.push({
      id: rt.id,
      displayName: rt.displayName,
      entry,
      files: entry ? entry.files : [],
      scaffolded: rec !== undefined,
      detected: rt.detectKinds.some((k) => detected.has(k)),
      installedRecord: rec,
    });
  }

  // Orphan templates (no known runtime claims them) — surface under the entry's
  // own name rather than dropping them.
  for (const entry of templates) {
    if (claimed.has(entry.key)) continue;
    const rec = installed.get(entry.key);
    setups.push({
      id: entry.key,
      displayName: entry.name,
      entry,
      files: entry.files,
      scaffolded: rec !== undefined,
      detected: false,
      installedRecord: rec,
    });
  }

  return setups;
}

/**
 * Split setups into the AVAILABLE group (a real template — rendered as install
 * cards) and the COMING-SOON group (no template yet — rendered as terse rows),
 * each preserving input order.
 */
export function partitionRuntimeSetups(setups: RuntimeSetup[]): {
  available: RuntimeSetup[];
  comingSoon: RuntimeSetup[];
} {
  return {
    available: setups.filter((s) => s.entry !== undefined),
    comingSoon: setups.filter((s) => s.entry === undefined),
  };
}
