/**
 * Pure logic for the Skills & agents editor (bead agentconfig-wmc.4). DOM-free
 * and React-free so it is unit-testable in isolation; Skills.tsx is a thin
 * renderer over these helpers.
 *
 * Two jobs:
 *   1. Discover the instance's SKILL.md / agent .md files from the report and
 *      classify each as a skill or an agent.
 *   2. Turn parsed frontmatter into a display CARD, and derive the CONNECTIONS
 *      graph (which skill/agent references which tool, MCP server, or other
 *      agent) — this doubles as the config graph.
 *
 * All input (report paths, frontmatter) is UNTRUSTED config data: values only
 * ever become plain strings, and derivations are deterministic (stable sort
 * everywhere) so the static graph render never jitters.
 */

import type { Report } from '../../api/types.js';
import { collectFiles, collectGlobalFiles } from '../../lib/collect.js';
import { asList, asScalar, getField, type FmEntry } from '../../lib/frontmatter.js';
import { joinGlobalPath } from '../../lib/paths.js';

/** A discovered config file: a skill (SKILL.md) or an agent (.md). */
export type EntryKind = 'skill' | 'agent';

export interface SkillEntry {
  kind: EntryKind;
  /** Display name — the skill directory name, or the agent file basename. */
  name: string;
  /** The report-relative file path (fed straight to getFile / writeFile). */
  path: string;
}

const SKILL_RE = /(?:^|\/)skills\/([^/]+)\/SKILL\.md$/i;
const AGENT_RE = /(?:^|\/)agents\/([^/]+)\.md$/i;

/** Classify a single file path as a skill or agent entry, or null when it is
 *  neither. Path separators are normalized so Windows-style paths still match. */
export function classifyFile(path: string): SkillEntry | null {
  const norm = path.replace(/\\/g, '/');
  const skill = SKILL_RE.exec(norm);
  if (skill) return { kind: 'skill', name: skill[1] as string, path };
  const agent = AGENT_RE.exec(norm);
  if (agent) return { kind: 'agent', name: agent[1] as string, path };
  return null;
}

/** Deterministic entry order: kind, then name, then path. */
function byKindNameThenPath(a: SkillEntry, b: SkillEntry): number {
  return (
    a.kind.localeCompare(b.kind) || a.name.localeCompare(b.name) || a.path.localeCompare(b.path)
  );
}

/** All skill + agent files referenced by any detected agent, de-duplicated by
 *  path and deterministically ordered (kind, then name, then path). */
export function collectEntries(report: Report | undefined): SkillEntry[] {
  return collectFiles(report?.agents ?? [], classifyFile, byKindNameThenPath);
}

// ── Inherited global skills & agents (bead 71h.5) ──────────────────────────

/** The slice of a machine-global report entry this page consumes. */
export interface GlobalSkillSource {
  /** Absolute path of the global config dir (e.g. '/Users/x/.claude'). */
  root: string;
  /** Well-known dir name under home (e.g. '.claude'). */
  dir: string;
  agents: readonly { files: string[] }[];
}

/** An inherited skill/agent entry. `path` is ABSOLUTE (root-joined) and only
 *  ever fed to getFile — it must never enter any write-target list. */
export interface GlobalSkillEntry extends SkillEntry {
  /** The global config dir the file came from. */
  root: string;
}

/** Inherited skills/agents from the machine-global `~/.claude` entry (the one
 *  runtime whose home layout carries `skills/` + `agents/` md files), classified
 *  with the same patterns as the project list, absolute-joined, de-duped, and
 *  deterministically ordered. No matching entries ⇒ [] (page renders as before). */
export function collectGlobalEntries(entries: readonly GlobalSkillSource[]): GlobalSkillEntry[] {
  return collectGlobalFiles(
    entries,
    (entry, rel) => {
      if (entry.dir !== '.claude') return null;
      const classified = classifyFile(rel);
      if (!classified) return null;
      return { ...classified, path: joinGlobalPath(entry.root, rel), root: entry.root };
    },
    byKindNameThenPath,
  );
}

/** The known frontmatter keys the card surfaces explicitly; everything else
 *  falls through to `other`. */
const KNOWN_KEYS = new Set([
  'name',
  'description',
  'model',
  'tools',
  'allowed-tools',
  'allowedtools',
  'permissions',
  'permission',
  'hooks',
  'mcp',
  'mcpservers',
]);

/** The visual card for one skill/agent — the frontmatter, grouped for display. */
export interface SkillCard {
  name: string;
  description: string;
  model: string;
  tools: string[];
  permissions: string[];
  hooks: string[];
  mcp: string[];
  /** Any frontmatter entry not surfaced in a dedicated slot above. */
  other: FmEntry[];
}

/** Extract MCP server names from tool tokens of the form
 *  `mcp__<server>__<tool>` (Claude Code's MCP tool naming). Server names may
 *  themselves contain single underscores; the `__` is the delimiter. */
export function extractMcpServers(tokens: readonly string[]): string[] {
  const servers: string[] = [];
  for (const token of tokens) {
    const parts = token.split('__');
    if (parts.length >= 2 && parts[0] === 'mcp') {
      const server = parts[1];
      if (server && server.trim() !== '') servers.push(server);
    }
  }
  return servers;
}

/** De-duplicate while preserving first-seen order, then sort for determinism. */
function uniqueSorted(items: readonly string[]): string[] {
  return [...new Set(items)].sort((a, b) => a.localeCompare(b));
}

/**
 * Build the display card from parsed frontmatter entries. `fallbackName` (the
 * entry name) fills in when the frontmatter omits `name` — a common case for
 * agent files named by their filename.
 */
export function toCard(entries: readonly FmEntry[], fallbackName: string): SkillCard {
  const tools = uniqueSorted([
    ...asList(getField(entries, 'tools')),
    ...asList(getField(entries, 'allowed-tools')),
    ...asList(getField(entries, 'allowedTools')),
  ]);
  const mcp = uniqueSorted([
    ...extractMcpServers(tools),
    ...asList(getField(entries, 'mcp')),
    ...asList(getField(entries, 'mcpServers')),
  ]);
  const name = asScalar(getField(entries, 'name')).trim() || fallbackName;

  const other = entries.filter((e) => !KNOWN_KEYS.has(e.key.toLowerCase()));

  return {
    name,
    description: asScalar(getField(entries, 'description')),
    model: asScalar(getField(entries, 'model')),
    tools,
    permissions: asList(getField(entries, 'permissions') ?? getField(entries, 'permission')),
    hooks: asList(getField(entries, 'hooks')),
    mcp,
    other,
  };
}

/** A node in the connections graph. */
export type NodeKind = EntryKind | 'tool' | 'mcp';

export interface GraphNode {
  id: string;
  kind: NodeKind;
  label: string;
}

export interface GraphEdge {
  from: string;
  to: string;
}

/** The connections graph: skills/agents on the left, the resources they
 *  reference on the right, with the edges between them. Bipartite and fully
 *  sorted so the static render is deterministic. */
export interface Graph {
  sources: GraphNode[];
  targets: GraphNode[];
  edges: GraphEdge[];
}

/** All reference tokens a card exposes (excludes description/prose). */
function cardTokens(card: SkillCard): string[] {
  const other = card.other.flatMap((e) => (Array.isArray(e.value) ? e.value : [e.value]));
  return [...card.tools, ...card.mcp, ...other];
}

const nodeId = (kind: NodeKind, label: string): string => `${kind}:${label}`;

/**
 * Derive the connections graph from the loaded skill/agent cards. Edges are:
 *   - source → tool     for each tool the card lists,
 *   - source → mcp      for each MCP server the card references,
 *   - source → agent    when a card names another discovered entry (a subagent
 *                       / skill reference detected by exact token match).
 * Targets are the union of referenced resources; a referenced agent appears in
 * the right column even if it is also a left-column source.
 */
export function deriveGraph(cards: readonly { entry: SkillEntry; card: SkillCard }[]): Graph {
  const sources: GraphNode[] = cards.map(({ entry }) => ({
    id: nodeId(entry.kind, entry.name),
    kind: entry.kind,
    label: entry.name,
  }));

  const targetById = new Map<string, GraphNode>();
  const edgeSet = new Set<string>();
  const edges: GraphEdge[] = [];

  const addTarget = (node: GraphNode): void => {
    if (!targetById.has(node.id)) targetById.set(node.id, node);
  };
  const addEdge = (from: string, to: string): void => {
    const key = `${from} ${to}`;
    if (edgeSet.has(key)) return;
    edgeSet.add(key);
    edges.push({ from, to });
  };

  // Name → source node, for cross-reference detection. First writer wins on a
  // name collision across kinds; deterministic by source order.
  const byName = new Map<string, GraphNode>();
  for (const node of sources) {
    if (!byName.has(node.label)) byName.set(node.label, node);
  }

  for (const { entry, card } of cards) {
    const from = nodeId(entry.kind, entry.name);
    for (const tool of card.tools) {
      // An `mcp__server__tool` token is already represented by its MCP server
      // node below — don't also draw a noisy raw-token tool node for it.
      if (tool.startsWith('mcp__')) continue;
      const node = { id: nodeId('tool', tool), kind: 'tool' as const, label: tool };
      addTarget(node);
      addEdge(from, node.id);
    }
    for (const server of card.mcp) {
      const node = { id: nodeId('mcp', server), kind: 'mcp' as const, label: server };
      addTarget(node);
      addEdge(from, node.id);
    }
    // Cross-references: an exact-name token matching another entry.
    for (const token of cardTokens(card)) {
      const ref = byName.get(token.trim());
      if (ref && ref.id !== from) {
        addTarget({ id: ref.id, kind: ref.kind, label: ref.label });
        addEdge(from, ref.id);
      }
    }
  }

  const byKindThenLabel = (a: GraphNode, b: GraphNode): number =>
    a.kind.localeCompare(b.kind) || a.label.localeCompare(b.label);

  return {
    sources: [...sources].sort(byKindThenLabel),
    targets: [...targetById.values()].sort(byKindThenLabel),
    edges: edges.sort((a, b) => a.from.localeCompare(b.from) || a.to.localeCompare(b.to)),
  };
}
