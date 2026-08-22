/**
 * Typed models for Claude Code artifacts (SPEC §4.1): subagents, skills,
 * commands, rules, memory files, settings.json, keybindings.json, and
 * `@import` references in CLAUDE.md.
 *
 * All content is adversarial data: shell snippets (`!`cmd``), tool names,
 * and commands are surfaced as inert strings for analyzers to inspect —
 * never interpreted or executed. Wrong-typed present fields always produce
 * a problem; absent optional fields stay silent.
 */

import { parseFrontmatter } from './frontmatter.js';
import { CLAUDE_CATALOG } from '../profiles/claude.js';
import { parseJsonRecord } from './json.js';
import { failed, parsed, problem, type ParseProblem, type ParseResult } from './result.js';
import {
  createFenceFilter,
  inputSizeProblem,
  isRecord,
  optionalBoolean,
  optionalNumber,
  optionalString,
  ownEntries,
  toEnvEntries,
  toStringList,
  type EnvEntry,
} from './values.js';

// ---------------------------------------------------------------------------
// Subagents (.claude/agents/*.md)

export interface ClaudeSubagent {
  name?: string;
  description?: string;
  /**
   * Tool names referenced in frontmatter, verbatim — analyzers use these to
   * flag references to nonexistent tools (e.g. `SchemaDiff`).
   */
  tools: string[];
  model?: string;
  body: string;
}

export function parseClaudeSubagent(content: string): ParseResult<ClaudeSubagent> {
  const sizeProblem = inputSizeProblem(content);
  if (sizeProblem) return failed([sizeProblem]);
  const fm = parseFrontmatter(content);
  const problems = [...fm.problems];
  if (!fm.hasFrontmatter) {
    problems.push(problem('frontmatter', 'missing frontmatter block'));
  }
  const model: ClaudeSubagent = {
    tools: toStringList(fm.data['tools'], 'frontmatter.tools', problems),
    body: fm.body,
  };
  const name = optionalString(fm.data['name'], 'frontmatter.name', problems);
  const description = optionalString(fm.data['description'], 'frontmatter.description', problems);
  const modelName = optionalString(fm.data['model'], 'frontmatter.model', problems);
  if (name !== undefined) model.name = name;
  else if (fm.hasFrontmatter && fm.data['name'] === undefined) {
    problems.push(problem('frontmatter.name', 'missing'));
  }
  if (description !== undefined) model.description = description;
  if (modelName !== undefined) model.model = modelName;
  return parsed(model, problems);
}

// ---------------------------------------------------------------------------
// Skills (.claude/skills/*/SKILL.md)

export interface ClaudeSkill {
  name?: string;
  description?: string;
  allowedTools: string[];
  body: string;
}

export function parseClaudeSkill(content: string): ParseResult<ClaudeSkill> {
  const sizeProblem = inputSizeProblem(content);
  if (sizeProblem) return failed([sizeProblem]);
  const fm = parseFrontmatter(content);
  const problems = [...fm.problems];
  if (!fm.hasFrontmatter) {
    problems.push(problem('frontmatter', 'missing frontmatter block'));
  }
  const model: ClaudeSkill = {
    allowedTools: toStringList(fm.data['allowed-tools'], 'frontmatter.allowed-tools', problems),
    body: fm.body,
  };
  const name = optionalString(fm.data['name'], 'frontmatter.name', problems);
  const description = optionalString(fm.data['description'], 'frontmatter.description', problems);
  if (name !== undefined) model.name = name;
  else if (fm.hasFrontmatter && fm.data['name'] === undefined) {
    problems.push(problem('frontmatter.name', 'missing'));
  }
  if (description !== undefined) model.description = description;
  return parsed(model, problems);
}

// ---------------------------------------------------------------------------
// Commands (.claude/commands/**/*.md)

export interface ClaudeCommand {
  description?: string;
  argumentHint?: string;
  allowedTools: string[];
  model?: string;
  /** True when the body references `$ARGUMENTS` (or `$1`-style positionals). */
  usesArguments: boolean;
  /** Inert text of `!`cmd`` context lines — surfaced for analyzers, never run. */
  shellCommands: string[];
  body: string;
}

const SHELL_LINE_PATTERN = /!`([^`\n]*)`/g;
const ARGUMENTS_PATTERN = /\$(?:ARGUMENTS\b|[1-9]\b)/;

export function parseClaudeCommand(content: string): ParseResult<ClaudeCommand> {
  const sizeProblem = inputSizeProblem(content);
  if (sizeProblem) return failed([sizeProblem]);
  const fm = parseFrontmatter(content);
  const problems = [...fm.problems];
  const shellCommands: string[] = [];
  for (const match of fm.body.matchAll(SHELL_LINE_PATTERN)) {
    if (match[1] !== undefined) shellCommands.push(match[1]);
  }
  const model: ClaudeCommand = {
    allowedTools: toStringList(fm.data['allowed-tools'], 'frontmatter.allowed-tools', problems),
    // Body only: an argument-hint mentioning $ARGUMENTS is not a usage.
    usesArguments: ARGUMENTS_PATTERN.test(fm.body),
    shellCommands,
    body: fm.body,
  };
  const description = optionalString(fm.data['description'], 'frontmatter.description', problems);
  const argumentHint = optionalString(
    fm.data['argument-hint'],
    'frontmatter.argument-hint',
    problems,
  );
  const modelName = optionalString(fm.data['model'], 'frontmatter.model', problems);
  if (description !== undefined) model.description = description;
  if (argumentHint !== undefined) model.argumentHint = argumentHint;
  if (modelName !== undefined) model.model = modelName;
  return parsed(model, problems);
}

// ---------------------------------------------------------------------------
// Rules (.claude/rules/*.md) — plain markdown

export interface ClaudeRule {
  /** Text of the first `#` heading, if any. */
  title?: string;
  body: string;
}

export function parseClaudeRule(content: string): ParseResult<ClaudeRule> {
  const sizeProblem = inputSizeProblem(content);
  if (sizeProblem) return failed([sizeProblem]);
  const problems: ParseProblem[] = [];
  if (content.trim().length === 0) problems.push(problem('$', 'empty content'));
  const model: ClaudeRule = { body: content };
  const title = firstHeading(content);
  if (title !== undefined) model.title = title;
  return parsed(model, problems);
}

// ---------------------------------------------------------------------------
// Memory files (.claude/memory/*.md)

export interface ClaudeMemory {
  type?: string;
  name?: string;
  description?: string;
  body: string;
}

export function parseClaudeMemory(content: string): ParseResult<ClaudeMemory> {
  const sizeProblem = inputSizeProblem(content);
  if (sizeProblem) return failed([sizeProblem]);
  const fm = parseFrontmatter(content);
  const problems = [...fm.problems];
  if (!fm.hasFrontmatter) {
    problems.push(problem('frontmatter', 'missing frontmatter block'));
  }
  const model: ClaudeMemory = { body: fm.body };
  const type = optionalString(fm.data['type'], 'frontmatter.type', problems);
  const name = optionalString(fm.data['name'], 'frontmatter.name', problems);
  const description = optionalString(fm.data['description'], 'frontmatter.description', problems);
  if (type !== undefined) model.type = type;
  if (name !== undefined) model.name = name;
  if (description !== undefined) model.description = description;
  return parsed(model, problems);
}

// ---------------------------------------------------------------------------
// settings.json / settings.local.json

export interface StatusLineConfig {
  type?: string;
  /** Inert command string — surfaced, never executed. */
  command?: string;
}

export interface PermissionsConfig {
  defaultMode?: string;
  allow: string[];
  deny: string[];
  ask: string[];
  additionalDirectories: string[];
}

export interface HookCommand {
  type?: string;
  /** Inert command string — surfaced, never executed. */
  command?: string;
  timeout?: number;
}

export interface HookGroup {
  /** Hook event name (PreToolUse, PostToolUse, SessionStart, Stop, ...). */
  event: string;
  matcher?: string;
  hooks: HookCommand[];
}

export interface ClaudeSettings {
  model?: string;
  env: EnvEntry[];
  statusLine?: StatusLineConfig;
  permissions?: PermissionsConfig;
  hooks: HookGroup[];
  enableAllProjectMcpServers?: boolean;
  /** Top-level keys this parser does not model (kept for round-trip awareness). */
  unknownKeys: string[];
}

/** Legacy parser metadata, projected from the canonical Claude Code profile. */
export const KNOWN_SETTINGS_KEYS: ReadonlySet<string> = new Set(
  CLAUDE_CATALOG.settings.map((setting) => setting.key),
);

export function parseClaudeSettings(content: string): ParseResult<ClaudeSettings> {
  const root = parseJsonRecord(content);
  if (!root.ok) return failed(root.problems);
  const problems = [...root.problems];
  const data = root.model;

  const model: ClaudeSettings = {
    env: toEnvEntries(data['env'], '$.env', problems),
    hooks: parseHooks(data['hooks'], problems),
    unknownKeys: Object.keys(data).filter((k) => !KNOWN_SETTINGS_KEYS.has(k)),
  };

  const modelName = optionalString(data['model'], '$.model', problems);
  if (modelName !== undefined) model.model = modelName;

  if (data['statusLine'] !== undefined) {
    if (isRecord(data['statusLine'])) {
      const statusLine: StatusLineConfig = {};
      const type = optionalString(data['statusLine']['type'], '$.statusLine.type', problems);
      const command = optionalString(
        data['statusLine']['command'],
        '$.statusLine.command',
        problems,
      );
      if (type !== undefined) statusLine.type = type;
      if (command !== undefined) statusLine.command = command;
      model.statusLine = statusLine;
    } else {
      problems.push(problem('$.statusLine', 'expected an object'));
    }
  }

  if (data['permissions'] !== undefined) {
    if (isRecord(data['permissions'])) {
      const p = data['permissions'];
      const permissions: PermissionsConfig = {
        allow: toStringList(p['allow'], '$.permissions.allow', problems),
        deny: toStringList(p['deny'], '$.permissions.deny', problems),
        ask: toStringList(p['ask'], '$.permissions.ask', problems),
        additionalDirectories: toStringList(
          p['additionalDirectories'],
          '$.permissions.additionalDirectories',
          problems,
        ),
      };
      const defaultMode = optionalString(p['defaultMode'], '$.permissions.defaultMode', problems);
      if (defaultMode !== undefined) permissions.defaultMode = defaultMode;
      model.permissions = permissions;
    } else {
      problems.push(problem('$.permissions', 'expected an object'));
    }
  }

  const enableAll = optionalBoolean(
    data['enableAllProjectMcpServers'],
    '$.enableAllProjectMcpServers',
    problems,
  );
  if (enableAll !== undefined) model.enableAllProjectMcpServers = enableAll;

  return parsed(model, problems);
}

function parseHooks(value: unknown, problems: ParseProblem[]): HookGroup[] {
  if (value === undefined) return [];
  if (!isRecord(value)) {
    problems.push(problem('$.hooks', 'expected an object keyed by event name'));
    return [];
  }
  const groups: HookGroup[] = [];
  for (const [event, groupList] of ownEntries(value)) {
    if (!Array.isArray(groupList)) {
      problems.push(problem(`$.hooks.${event}`, 'expected an array of matcher groups'));
      continue;
    }
    groupList.forEach((entry, i) => {
      if (!isRecord(entry)) {
        problems.push(problem(`$.hooks.${event}[${i}]`, 'expected an object'));
        return;
      }
      const group: HookGroup = { event, hooks: [] };
      const matcher = optionalString(entry['matcher'], `$.hooks.${event}[${i}].matcher`, problems);
      if (matcher !== undefined) group.matcher = matcher;
      const hookList = entry['hooks'];
      if (Array.isArray(hookList)) {
        hookList.forEach((hook, j) => {
          const hookPath = `$.hooks.${event}[${i}].hooks[${j}]`;
          if (!isRecord(hook)) {
            problems.push(problem(hookPath, 'expected an object'));
            return;
          }
          const cmd: HookCommand = {};
          const type = optionalString(hook['type'], `${hookPath}.type`, problems);
          const command = optionalString(hook['command'], `${hookPath}.command`, problems);
          const timeout = optionalNumber(hook['timeout'], `${hookPath}.timeout`, problems);
          if (type !== undefined) cmd.type = type;
          if (command !== undefined) cmd.command = command;
          if (timeout !== undefined) cmd.timeout = timeout;
          group.hooks.push(cmd);
        });
      } else if (hookList !== undefined) {
        problems.push(problem(`$.hooks.${event}[${i}].hooks`, 'expected an array'));
      }
      groups.push(group);
    });
  }
  return groups;
}

// ---------------------------------------------------------------------------
// keybindings.json — deliberately opaque (shape is plausible-but-unofficial;
// fixtures/README says: treat as opaque JSON with a `bindings` array).

export interface Keybindings {
  /** Raw binding entries, not schema-validated. */
  bindings: unknown[];
}

export function parseKeybindings(content: string): ParseResult<Keybindings> {
  const root = parseJsonRecord(content);
  if (!root.ok) return failed(root.problems);
  const problems = [...root.problems];
  const raw = root.model['bindings'];
  let bindings: unknown[] = [];
  if (Array.isArray(raw)) bindings = raw;
  else if (raw !== undefined) problems.push(problem('$.bindings', 'expected an array'));
  else problems.push(problem('$.bindings', 'missing bindings array'));
  return parsed({ bindings }, problems);
}

// ---------------------------------------------------------------------------
// CLAUDE.md — @import references

export interface ClaudeMdImport {
  /** The referenced path, verbatim (may be `~/`-prefixed or relative). */
  path: string;
  /** 1-based line number in the source file. */
  line: number;
}

export interface ClaudeMd {
  title?: string;
  imports: ClaudeMdImport[];
  body: string;
}

// `@` at start-of-line/after whitespace or '(' followed by a path-looking
// token. Requires a '.' or '/' inside so prose like "@import" or decorators
// like "@Component" don't match; emails don't match because the char before
// '@' is not whitespace.
const IMPORT_PATTERN = /(^|[\s(])@((?:~\/|\.{1,2}\/)?[A-Za-z0-9_.~-][A-Za-z0-9_.~/-]*)/g;

export function parseClaudeMd(content: string): ParseResult<ClaudeMd> {
  const sizeProblem = inputSizeProblem(content);
  if (sizeProblem) return failed([sizeProblem]);
  const problems: ParseProblem[] = [];
  if (content.trim().length === 0) problems.push(problem('$', 'empty content'));
  const imports: ClaudeMdImport[] = [];
  const skipLine = createFenceFilter();
  content.split('\n').forEach((line, index) => {
    if (skipLine(line)) return;
    for (const match of line.matchAll(IMPORT_PATTERN)) {
      const path = match[2];
      if (path === undefined) continue;
      // Strip sentence punctuation, then require a path-looking token
      // (contains '/' or '.') so prose like "@import" doesn't match.
      const trimmed = path.replace(/[.,;:)]+$/, '');
      if (trimmed.length === 0) continue;
      if (!/[/.]/.test(trimmed)) continue;
      imports.push({ path: trimmed, line: index + 1 });
    }
  });
  const model: ClaudeMd = { imports, body: content };
  const title = firstHeading(content);
  if (title !== undefined) model.title = title;
  return parsed(model, problems);
}

// ---------------------------------------------------------------------------

function firstHeading(content: string): string | undefined {
  const skipLine = createFenceFilter();
  for (const line of content.split('\n')) {
    if (skipLine(line)) continue;
    const match = /^#\s+(.+?)\s*$/.exec(line);
    if (match && match[1] !== undefined) return match[1];
  }
  return undefined;
}
