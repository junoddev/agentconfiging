/**
 * Report + analyzer input view (SPEC §4.1).
 *
 * `AnalyzerInput` is the ONLY thing analyzers see: manifest facts, detected
 * agents, parsed models, and an optional caller-populated env bag. Building
 * it (`buildAnalyzerInput`) and running the registered analyzers over it
 * (`runAnalyzers`) are both pure — zero I/O, fixture-testable from JSON.
 * The full scan→detect→parse→analyze pipeline wiring lives elsewhere
 * (np8.7); with these exports it is a one-liner:
 *
 *   buildReport(manifest, detect(manifest), env)
 *
 * Env bag: some checks depend on facts outside the manifest (e.g. whether
 * an MCP `command` resolves on PATH). Analyzers must NOT probe the
 * environment themselves — instead a CALLER may collect such facts up
 * front and pass them in `env`. When a fact is absent, the analyzers that
 * need it skip their check entirely (no finding, never a guess).
 */

import type { DetectedAgent } from './detectors/index.js';
import { dirPrefix, filesUnder, findFile } from './detectors/shared.js';
import { sortFindings, type Finding, type Fix } from './findings.js';
import type { Manifest } from './manifest.js';
import { allAnalyzers } from './analyzers/index.js';
import {
  parseClaudeCommand,
  parseClaudeMd,
  parseClaudeRule,
  parseClaudeSettings,
  parseClaudeSkill,
  parseClaudeSubagent,
  parseCursorRule,
  parseGuide,
  parseMcpJson,
  type ClaudeCommand,
  type ClaudeMd,
  type ClaudeRule,
  type ClaudeSettings,
  type ClaudeSkill,
  type ClaudeSubagent,
  type CursorRule,
  type Guide,
  type McpConfig,
  type ParseResult,
} from './parsers/index.js';

/** A parsed model together with the manifest path it came from. */
export interface ParsedFile<T> {
  path: string;
  model: T;
}

/**
 * Typed models parsed out of the manifest's file contents. Entries exist
 * only when the file is present, its content was inlined, and the parse
 * salvaged a model (`ok: true`).
 */
export interface ParsedArtifacts {
  /** Root CLAUDE.md with its `@import` references. */
  claudeMd?: ParsedFile<ClaudeMd>;
  /** .claude/settings.json */
  settings?: ParsedFile<ClaudeSettings>;
  /** .claude/settings.local.json */
  localSettings?: ParsedFile<ClaudeSettings>;
  subagents: ParsedFile<ClaudeSubagent>[];
  skills: ParsedFile<ClaudeSkill>[];
  commands: ParsedFile<ClaudeCommand>[];
  rules: ParsedFile<ClaudeRule>[];
  /** .mcp.json */
  mcp?: ParsedFile<McpConfig>;
  cursorRules: ParsedFile<CursorRule>[];
  /** Root instruction guides: CLAUDE.md, AGENTS.md, GEMINI.md, .cursorrules, Copilot instructions. */
  guides: ParsedFile<Guide>[];
}

/**
 * Caller-collected environment facts (see module docstring). Everything is
 * optional; analyzers skip checks whose facts are absent.
 */
export interface AnalyzerEnv {
  /**
   * Names of executables known to resolve on the caller's PATH (bare names,
   * no directories). Populates the `mcp-command-not-on-path` check.
   */
  pathCommands?: string[];
}

/** The read-only view every analyzer receives. */
export interface AnalyzerInput {
  manifest: Manifest;
  agents: DetectedAgent[];
  parsed: ParsedArtifacts;
  env?: AnalyzerEnv;
}

export interface Report {
  manifest: Manifest;
  agents: DetectedAgent[];
  parsed?: ParsedArtifacts;
  findings: Finding[];
}

/** Guide files parsed into `ParsedArtifacts.guides` when present at the root. */
const GUIDE_PATHS: readonly string[] = [
  'CLAUDE.md',
  'AGENTS.md',
  'GEMINI.md',
  '.cursorrules',
  '.github/copilot-instructions.md',
];

function parseAt<T>(
  manifest: Manifest,
  path: string,
  parse: (content: string) => ParseResult<T>,
): ParsedFile<T> | undefined {
  const content = findFile(manifest, path)?.content;
  if (typeof content !== 'string') return undefined;
  const result = parse(content);
  return result.ok ? { path, model: result.model } : undefined;
}

function parseUnder<T>(
  manifest: Manifest,
  prefix: string,
  matches: (path: string) => boolean,
  parse: (content: string) => ParseResult<T>,
): ParsedFile<T>[] {
  const out: ParsedFile<T>[] = [];
  for (const file of filesUnder(manifest, prefix)) {
    if (!matches(file.path)) continue;
    const entry = parseAt(manifest, file.path, parse);
    if (entry) out.push(entry);
  }
  return out;
}

/**
 * Build the analyzer input view from a manifest + detection result. Pure:
 * parses inlined manifest content only.
 */
export function buildAnalyzerInput(
  manifest: Manifest,
  agents: DetectedAgent[],
  env?: AnalyzerEnv,
): AnalyzerInput {
  const prefix = dirPrefix(manifest, '.claude');
  const isMd = (p: string) => p.endsWith('.md');

  const parsed: ParsedArtifacts = {
    subagents: parseUnder(manifest, `${prefix}agents/`, isMd, parseClaudeSubagent),
    skills: parseUnder(
      manifest,
      `${prefix}skills/`,
      (p) => p.endsWith('/SKILL.md'),
      parseClaudeSkill,
    ),
    commands: parseUnder(manifest, `${prefix}commands/`, isMd, parseClaudeCommand),
    rules: parseUnder(manifest, `${prefix}rules/`, isMd, parseClaudeRule),
    cursorRules: parseUnder(manifest, '.cursor/rules/', (p) => p.endsWith('.mdc'), parseCursorRule),
    guides: GUIDE_PATHS.map((p) => parseAt(manifest, p, parseGuide)).filter(
      (g): g is ParsedFile<Guide> => g !== undefined,
    ),
  };

  const claudeMd = parseAt(manifest, 'CLAUDE.md', parseClaudeMd);
  if (claudeMd) parsed.claudeMd = claudeMd;
  const settings = parseAt(manifest, `${prefix}settings.json`, parseClaudeSettings);
  if (settings) parsed.settings = settings;
  const localSettings = parseAt(manifest, `${prefix}settings.local.json`, parseClaudeSettings);
  if (localSettings) parsed.localSettings = localSettings;
  const mcp = parseAt(manifest, '.mcp.json', parseMcpJson);
  if (mcp) parsed.mcp = mcp;

  const input: AnalyzerInput = { manifest, agents, parsed };
  if (env) input.env = env;
  return input;
}

/**
 * Run every registered analyzer over the input. Pure, deterministic:
 * findings come back sorted (severity, then id) with stable slug ids,
 * uniquified so consumers can key on them (slugs CAN collide — e.g.
 * `docs/x.md` and `docs.x.md` both slug to `docs-x-md` — in which case
 * later findings get a `-2`, `-3`, ... suffix in emission order, which is
 * deterministic: analyzers run in id order and emit deterministically).
 */
export function runAnalyzers(input: AnalyzerInput): Finding[] {
  const raw = allAnalyzers().flatMap((a) => a.analyze(input));
  const seen = new Set<string>();
  const unique = raw.map((finding) => {
    let id = finding.id;
    for (let n = 2; seen.has(id); n += 1) id = `${finding.id}-${n}`;
    seen.add(id);
    return id === finding.id ? finding : { ...finding, id };
  });
  return sortFindings(unique);
}

/**
 * A finding as serialized for EXTERNAL output (CLI report JSON, server API).
 * `Finding.fix` carries complete replacement file content — which can embed
 * secrets (e.g. env values in settings.json) — and is NEVER serialized; it
 * is summarized as `hasFix` + `fixKind` so consumers keep the signal
 * without the file body. Shared by src/cli/report.ts and src/server so both
 * emitters use the identical fix-stripping path (agentconfig-gxo.2 moved it
 * here from src/cli/report.ts).
 */
export type ReportFinding = Omit<Finding, 'fix'> & { hasFix?: true; fixKind?: Fix['kind'] };

/** Strip the fix payload from a finding for serialization (see ReportFinding). */
export function toReportFinding(finding: Finding): ReportFinding {
  const { fix, ...rest } = finding;
  return fix ? { ...rest, hasFix: true, fixKind: fix.kind } : rest;
}

/** Compose input building + analysis into a full Report. */
export function buildReport(
  manifest: Manifest,
  agents: DetectedAgent[],
  env?: AnalyzerEnv,
): Report {
  const input = buildAnalyzerInput(manifest, agents, env);
  return { manifest, agents, parsed: input.parsed, findings: runAnalyzers(input) };
}
