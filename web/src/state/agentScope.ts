/**
 * Active-agent scoping (bead agentconfig-a6y). The top-bar AGENT picker selects
 * ONE detected runtime; every Configure page scopes its content to that agent
 * instead of flattening the union of all agents' files. Pure and DOM-free (the
 * storage wrappers mirror shell/theme.ts and tolerate a disabled store) so the
 * load-bearing rules are unit-testable:
 *   - which stored preference resolves to which detected agent (stickiness:
 *     a stored kind absent from this report falls back to the first agent);
 *   - which agent kinds reference a given report file ("also applies to" —
 *     items note the OTHER agents that read the same file);
 *   - which kinds are Claude surfaces (Settings/Hooks/Keybindings are
 *     Claude-only files and show a not-applicable state for other agents).
 */

import type { DetectedAgent, Report } from '../api/types.js';
import { KNOWN_RUNTIMES } from '../catalog/runtimeSetup.js';
import { EDITOR_ROUTES } from '../routes.js';

export const AGENT_KEY = 'agentconfig:agent';

/** The slice of DetectedAgent the scoping helpers need. */
export interface AgentFiles {
  kind: string;
  files: string[];
}

/**
 * The runtimes available to the shell picker. Project detections take
 * precedence, but machine-global detections keep the picker usable for a
 * project that has no local config of its own. A runtime can be detected by
 * more than one global config directory, so collapse those entries by kind.
 */
export function availableAgents(
  projectAgents: readonly DetectedAgent[],
  globalEntries: readonly unknown[],
): DetectedAgent[] {
  const merged = new Map<string, DetectedAgent>();
  const add = (agent: DetectedAgent) => {
    const existing = merged.get(agent.kind);
    if (existing === undefined) {
      merged.set(agent.kind, agent);
      return;
    }
    merged.set(agent.kind, {
      ...existing,
      files: [...new Set([...existing.files, ...agent.files])],
    });
  };

  for (const agent of projectAgents) add(agent);
  for (const entry of globalEntries) {
    if (typeof entry !== 'object' || entry === null || !('agents' in entry)) continue;
    const agents = entry.agents;
    if (!Array.isArray(agents)) continue;
    for (const agent of agents) add(agent as DetectedAgent);
  }
  return [...merged.values()];
}

/**
 * Resolve the effective active agent: the stored/selected kind when this
 * report detected it, else the first detected agent (report order), else
 * undefined (no agents detected — pages render their empty states).
 */
export function resolveActiveAgent(
  agents: readonly DetectedAgent[],
  storedKind: string | undefined,
): DetectedAgent | undefined {
  return agents.find((a) => a.kind === storedKind) ?? agents[0];
}

/** The agents the active selection scopes to (undefined kind ⇒ all — the
 *  pre-selection boot window only). */
export function scopedAgents<T extends AgentFiles>(
  agents: readonly T[],
  kind: string | undefined,
): T[] {
  if (kind === undefined) return [...agents];
  return agents.filter((a) => a.kind === kind);
}

/** A report narrowed to the active agent — collectors that take a whole Report
 *  only read `.agents`, so pages pass this instead of changing signatures. */
export function scopeReport(report: Report, kind: string | undefined): Report {
  if (kind === undefined) return report;
  return { ...report, agents: scopedAgents(report.agents, kind) };
}

/** Every agent kind that references `path`, codepoint-sorted. */
export function agentKindsForFile(agents: readonly AgentFiles[], path: string): string[] {
  const kinds = new Set<string>();
  for (const agent of agents) {
    if (agent.files.includes(path)) kinds.add(agent.kind);
  }
  return [...kinds].sort((a, b) => a.localeCompare(b));
}

/** The OTHER agent kinds a file applies to — the "also: …" badge input. */
export function otherAgentKinds(
  agents: readonly AgentFiles[],
  path: string,
  activeKind: string | undefined,
): string[] {
  return agentKindsForFile(agents, path).filter((k) => k !== activeKind);
}

/** Kind → display name via the runtime table's detector kinds; an unknown kind
 *  displays as itself (honest — never an invented name). */
export function displayNameForKind(kind: string): string {
  const runtime = KNOWN_RUNTIMES.find((r) => r.detectKinds.includes(kind));
  return runtime?.displayName ?? kind;
}

/** True when a kind is the Claude Code runtime — the only runtime that reads
 *  `.claude/settings*.json` and `.claude/keybindings.json`. */
export function isClaudeKind(kind: string | undefined): boolean {
  return kind === 'claude-code';
}

// ── Section relevance (which Configure nav items a runtime gets) ────────────

/** One Configure nav section — typed off the router's editor-route list so the
 *  relevance map below can never drift from the rail. */
export type ConfigSection = (typeof EDITOR_ROUTES)[number];

/**
 * Which runtimes each Configure section applies to. `'all'` = every runtime.
 * This mirrors what each PAGE can actually read/write today, not aspiration:
 * Settings/Hooks/Keybindings/Skills/Memory/MCP work over Claude Code's file
 * layout only; Rules understands `.claude/rules/*.md` and `.cursor/rules/*.mdc`;
 * Instructions and Sync are inherently multi-runtime. Extend a section's list
 * when its page learns another runtime's format.
 */
const SECTION_KINDS: Record<ConfigSection, 'all' | readonly string[]> = {
  settings: ['claude-code'],
  instructions: 'all',
  skills: ['claude-code'],
  hooks: ['claude-code'],
  rules: ['claude-code', 'cursor'],
  memory: ['claude-code'],
  mcp: ['claude-code'],
  keybindings: ['claude-code'],
  sync: 'all',
};

/** True when a Configure section is relevant to the active agent. No active
 *  agent (nothing detected — the boot window) shows every section. */
export function sectionApplies(section: ConfigSection, kind: string | undefined): boolean {
  if (kind === undefined) return true;
  const kinds = SECTION_KINDS[section];
  return kinds === 'all' || kinds.includes(kind);
}

// ── Persistence (mirrors shell/theme.ts: non-sensitive preference) ──────────

function storage(): Storage | undefined {
  try {
    return typeof window !== 'undefined' ? window.localStorage : undefined;
  } catch {
    // Storage disabled (private mode / sandbox) — selection degrades to session-only.
    return undefined;
  }
}

/** Read the stored agent-kind preference, or undefined when unset/unavailable. */
export function readStoredAgentKind(): string | undefined {
  try {
    return storage()?.getItem(AGENT_KEY) ?? undefined;
  } catch {
    return undefined;
  }
}

/** Persist the agent-kind preference so it survives reload. */
export function writeStoredAgentKind(kind: string): void {
  try {
    storage()?.setItem(AGENT_KEY, kind);
  } catch {
    // Storage disabled — the selection still applies for this session.
  }
}
