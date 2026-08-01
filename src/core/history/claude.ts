/**
 * Claude Code history adapter: `~/.claude/history.jsonl` and
 * `~/.claude/projects/<slug>/<sessionId>.jsonl`.
 *
 * Format notes honored here (SPEC §4.1):
 * - Slug dirs are LOSSY (`/` and `.` both become `-`): cwd is read from
 *   in-file entries, never decoded from the directory name.
 * - The first line varies (summary, snapshot, message, …) and undocumented
 *   line types appear over time — anything unrecognized is skipped + counted.
 * - Sidechain (subagent) messages are marked `isSidechain: true` inline.
 * - Large tool results are spilled to `tool-results/` files and referenced by
 *   a `<persisted-output>` stub; the stub is kept verbatim and the referenced
 *   path is surfaced only after validation, but the spill file is never read.
 * - `ai-title` / `summary` lines carry session titles.
 * - A leading UTF-8 BOM is stripped before parsing (so a BOM'd first line
 *   still parses; it is not counted as malformed).
 *
 * All content is treated as opaque, adversarial text. Parsing never throws on
 * a malformed line, and everything retained from content is bounded (unknown
 * type names are truncated/capped, spill paths length-limited and validated).
 */

import { createReadStream, type Dirent } from 'node:fs';
import { readdir, readFile } from 'node:fs/promises';
import { createInterface } from 'node:readline';
import { basename, join } from 'node:path';
import type {
  ContentBlock,
  HistoryAdapter,
  PromptHistory,
  PromptHistoryEntry,
  ReadDiagnostics,
  Session,
  SessionFileRef,
  SessionMessage,
  TokenUsage,
} from './types.js';

/**
 * Internal filesystem seam so tests can observe or replace file access (e.g.
 * to prove spill files are never opened, or to simulate unreadable slug
 * dirs). Not part of the public API — not exported from the barrel.
 */
export const claudeFs: {
  readdir: (path: string, options: { withFileTypes: true }) => Promise<Dirent[]>;
  readFile: (path: string, encoding: 'utf8') => Promise<string>;
} = { readdir, readFile };

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function asString(value: unknown): string | undefined {
  return typeof value === 'string' ? value : undefined;
}

const USAGE_FIELDS = [
  'input_tokens',
  'output_tokens',
  'cache_creation_input_tokens',
  'cache_read_input_tokens',
] as const;
type UsageField = (typeof USAGE_FIELDS)[number];

const REQUIRED_USAGE_FIELDS = new Set<UsageField>(['input_tokens', 'output_tokens']);

interface ParsedTokenCount {
  value: number;
  invalid: boolean;
}

function hasOwn(obj: Record<string, unknown>, key: string): boolean {
  return Object.prototype.hasOwnProperty.call(obj, key);
}

/** Parse one finite non-negative integer token count. */
function tokenCount(raw: Record<string, unknown>, field: UsageField): ParsedTokenCount {
  if (!hasOwn(raw, field)) {
    return { value: 0, invalid: REQUIRED_USAGE_FIELDS.has(field) };
  }
  const value = raw[field];
  if (typeof value === 'number' && Number.isSafeInteger(value) && value >= 0) {
    return { value, invalid: false };
  }
  return { value: 0, invalid: true };
}

/**
 * Lift an assistant message's `message.usage` block into a {@link TokenUsage}.
 * Returns undefined when no usage block is present. Valid fields are retained,
 * but malformed required fields mark the usage as partial so downstream cost
 * accounting cannot present a fabricated known-zero estimate.
 */
function toTokenUsage(raw: unknown): TokenUsage | undefined {
  if (raw === undefined) return undefined;
  if (!isRecord(raw)) {
    return {
      status: 'partial',
      inputTokens: 0,
      outputTokens: 0,
      cacheCreationTokens: 0,
      cacheReadTokens: 0,
      invalidFields: ['usage'],
    };
  }
  const input = tokenCount(raw, 'input_tokens');
  const output = tokenCount(raw, 'output_tokens');
  const cacheCreation = tokenCount(raw, 'cache_creation_input_tokens');
  const cacheRead = tokenCount(raw, 'cache_read_input_tokens');
  const invalidFields = USAGE_FIELDS.filter((field) => tokenCount(raw, field).invalid);
  const status = invalidFields.length === 0 ? 'complete' : 'partial';
  return {
    status,
    inputTokens: input.value,
    outputTokens: output.value,
    cacheCreationTokens: cacheCreation.value,
    cacheReadTokens: cacheRead.value,
    ...(invalidFields.length > 0 ? { invalidFields } : {}),
  };
}

function stripBom(text: string): string {
  return text.charCodeAt(0) === 0xfeff ? text.slice(1) : text;
}

function nonEmptyLines(text: string): string[] {
  return stripBom(text)
    .split('\n')
    .filter((line) => line.trim() !== '');
}

function emptyDiagnostics(totalLines: number): ReadDiagnostics {
  return {
    totalLines,
    skipped: 0,
    malformed: 0,
    ignored: 0,
    unknownTypes: [],
    overflowCount: 0,
    rejectedSpillPaths: 0,
  };
}

/** Line types that are part of the known format but carry no message content. */
const KNOWN_IGNORED_TYPES = new Set(['file-history-snapshot', 'last-prompt']);

/** Caps on attacker-controlled data retained in diagnostics. */
const UNKNOWN_TYPE_MAX_LENGTH = 64;
const UNKNOWN_TYPES_MAX = 20;

const PERSISTED_MARKER = '<persisted-output>';
/** How far past the marker we look for the spill reference. */
const SPILL_WINDOW = 2048;
const SPILL_PATH_MAX_LENGTH = 1024;
/** Bounded, anchored: path chars only, applied to a small fixed-size slice. */
const SPILL_PATH_RE = /^[ \t]*([^\s"'<>]{1,1024})/;

/**
 * A content-derived spill path is only surfaced when it is normalized (no
 * empty/`.`/`..` segments) and matches the known
 * `<sessionId>/tool-results/<file>` shape; when the session id is known it
 * must match too.
 */
function isSessionSpillPath(path: string, sessionId: string | undefined): boolean {
  const parts = path.split('/');
  if (parts.length < 3) return false;
  const bad = parts.some(
    (segment, i) => (segment === '' && i !== 0) || segment === '.' || segment === '..',
  );
  if (bad) return false;
  const file = parts[parts.length - 1];
  const dir = parts[parts.length - 2];
  const owner = parts[parts.length - 3];
  if (file === undefined || file === '' || dir !== 'tool-results') return false;
  if (owner === undefined || owner === '') return false;
  return sessionId === undefined || owner === sessionId;
}

/**
 * Extract the spill-file path from a `<persisted-output>` stub without ever
 * rescanning the full text: one indexOf for the first marker, one indexOf for
 * `saved to:` inside a fixed-size window, one anchored bounded match. Hostile
 * texts made of repeated markers cost O(n) total, not O(n²).
 */
function extractSpillPath(text: string): string | undefined {
  const marker = text.indexOf(PERSISTED_MARKER);
  if (marker === -1) return undefined;
  const window = text.slice(marker, marker + SPILL_WINDOW);
  const saved = window.indexOf('saved to:');
  if (saved === -1) return undefined;
  const start = saved + 'saved to:'.length;
  const match = SPILL_PATH_RE.exec(window.slice(start, start + SPILL_PATH_MAX_LENGTH + 16));
  return match?.[1];
}

function toolResultText(content: unknown): string {
  if (typeof content === 'string') return content;
  if (Array.isArray(content)) {
    return content
      .map((block) => (isRecord(block) ? (asString(block.text) ?? '') : ''))
      .filter((text) => text !== '')
      .join('\n');
  }
  return '';
}

interface BlockContext {
  sessionId: string | undefined;
  diagnostics: ReadDiagnostics;
}

function toContentBlock(raw: unknown, ctx: BlockContext): ContentBlock {
  if (!isRecord(raw)) return { type: 'unknown', blockType: typeof raw };
  switch (raw.type) {
    case 'text':
      return { type: 'text', text: asString(raw.text) ?? '' };
    case 'thinking':
      return { type: 'thinking', thinking: asString(raw.thinking) ?? '' };
    case 'tool_use':
      return { type: 'tool_use', id: asString(raw.id), name: asString(raw.name), input: raw.input };
    case 'tool_result': {
      const text = toolResultText(raw.content);
      let persistedOutputPath: string | undefined;
      const candidate = extractSpillPath(text);
      if (candidate !== undefined) {
        if (isSessionSpillPath(candidate, ctx.sessionId)) {
          persistedOutputPath = candidate;
        } else {
          ctx.diagnostics.rejectedSpillPaths += 1;
        }
      }
      return {
        type: 'tool_result',
        toolUseId: asString(raw.tool_use_id),
        text,
        ...(persistedOutputPath !== undefined ? { persistedOutputPath } : {}),
      };
    }
    default:
      return { type: 'unknown', blockType: asString(raw.type) ?? typeof raw.type };
  }
}

function toContentBlocks(content: unknown, ctx: BlockContext): ContentBlock[] {
  if (typeof content === 'string') return [{ type: 'text', text: content }];
  if (Array.isArray(content)) return content.map((raw) => toContentBlock(raw, ctx));
  return [];
}

/**
 * Parse the text of one `projects/<slug>/<sessionId>.jsonl` file. Pure —
 * `filePath` is only recorded and used as a session-id fallback.
 */
export function parseClaudeSession(text: string, filePath = ''): Session {
  const lines = nonEmptyLines(text);
  const diagnostics = emptyDiagnostics(lines.length);
  const unknownTypes = new Set<string>();
  const messages: SessionMessage[] = [];
  const cwds: string[] = [];
  const fileSessionId = filePath === '' ? undefined : basename(filePath, '.jsonl');
  let sessionId: string | undefined;
  let gitBranch: string | undefined;
  let version: string | undefined;
  let title: string | undefined;
  let summary: string | undefined;
  let startedAt: string | undefined;
  let endedAt: string | undefined;
  let startMs: number | undefined;
  let endMs: number | undefined;

  for (const line of lines) {
    let record: unknown;
    try {
      record = JSON.parse(line);
    } catch {
      diagnostics.malformed += 1;
      continue;
    }
    if (!isRecord(record)) {
      diagnostics.malformed += 1;
      continue;
    }

    const type = asString(record.type);
    if (type === undefined) {
      diagnostics.malformed += 1;
      continue;
    }

    if (type === 'summary') {
      summary = asString(record.summary) ?? summary;
      diagnostics.ignored += 1;
      continue;
    }
    if (type === 'ai-title') {
      title = asString(record.aiTitle) ?? title;
      sessionId ??= asString(record.sessionId);
      diagnostics.ignored += 1;
      continue;
    }
    if (KNOWN_IGNORED_TYPES.has(type)) {
      diagnostics.ignored += 1;
      continue;
    }

    if (type === 'user' || type === 'assistant') {
      if (!isRecord(record.message)) {
        diagnostics.malformed += 1;
        continue;
      }
      sessionId ??= asString(record.sessionId);
      const ctx: BlockContext = {
        sessionId: asString(record.sessionId) ?? sessionId ?? fileSessionId,
        diagnostics,
      };
      const timestamp = asString(record.timestamp);
      const message: SessionMessage = {
        role: type,
        uuid: asString(record.uuid),
        parentUuid: record.parentUuid === null ? null : asString(record.parentUuid),
        timestamp,
        cwd: asString(record.cwd),
        isSidechain: record.isSidechain === true,
        isMeta: record.isMeta === true,
        model: asString(record.message.model),
        content: toContentBlocks(record.message.content, ctx),
      };
      const usage = type === 'assistant' ? toTokenUsage(record.message.usage) : undefined;
      if (usage !== undefined) message.usage = usage;
      messages.push(message);
      if (message.cwd !== undefined && !cwds.includes(message.cwd)) cwds.push(message.cwd);
      gitBranch ??= asString(record.gitBranch);
      version ??= asString(record.version);
      if (timestamp !== undefined) {
        const ms = Date.parse(timestamp);
        if (!Number.isNaN(ms)) {
          if (startMs === undefined || ms < startMs) {
            startMs = ms;
            startedAt = timestamp;
          }
          if (endMs === undefined || ms > endMs) {
            endMs = ms;
            endedAt = timestamp;
          }
        }
      }
      continue;
    }

    // Unrecognized line type: skip + count, retaining only bounded type names.
    const truncated = type.slice(0, UNKNOWN_TYPE_MAX_LENGTH);
    if (!unknownTypes.has(truncated)) {
      if (unknownTypes.size < UNKNOWN_TYPES_MAX) unknownTypes.add(truncated);
      else diagnostics.overflowCount += 1;
    }
    diagnostics.skipped += 1;
  }

  diagnostics.unknownTypes = [...unknownTypes];
  return {
    runtime: 'claude',
    sessionId: sessionId ?? fileSessionId,
    filePath,
    cwd: cwds[0],
    cwds,
    gitBranch,
    version,
    title,
    summary,
    startedAt,
    endedAt,
    messages,
    diagnostics,
  };
}

/** Parse the text of `history.jsonl`. Pure. */
export function parseClaudeHistory(text: string): PromptHistory {
  const lines = nonEmptyLines(text);
  const diagnostics = emptyDiagnostics(lines.length);
  const entries: PromptHistoryEntry[] = [];

  for (const line of lines) {
    let record: unknown;
    try {
      record = JSON.parse(line);
    } catch {
      diagnostics.malformed += 1;
      continue;
    }
    if (!isRecord(record) || typeof record.display !== 'string') {
      diagnostics.malformed += 1;
      continue;
    }
    entries.push({
      display: record.display,
      timestamp: typeof record.timestamp === 'number' ? record.timestamp : undefined,
      project: asString(record.project),
      pastedContentCount: isRecord(record.pastedContents)
        ? Object.keys(record.pastedContents).length
        : 0,
    });
  }

  return { entries, diagnostics };
}

/** Bounds for `readSessionCwd`: leading non-empty lines / bytes examined. */
const CWD_SCAN_MAX_LINES = 50;
const CWD_SCAN_MAX_BYTES = 256 * 1024;

/**
 * Bounded convenience reader: return the session's real cwd from its first
 * in-file entries (at most {@link CWD_SCAN_MAX_LINES} non-empty lines /
 * {@link CWD_SCAN_MAX_BYTES} bytes) without parsing the whole file. Exists so
 * consumers grouping sessions by project never feel pressure to decode the
 * lossy slug directory name.
 */
export async function readSessionCwd(path: string): Promise<string | undefined> {
  const stream = createReadStream(path, { encoding: 'utf8', start: 0, end: CWD_SCAN_MAX_BYTES });
  const rl = createInterface({ input: stream, crlfDelay: Infinity });
  let seen = 0;
  try {
    for await (const rawLine of rl) {
      const line = stripBom(rawLine);
      if (line.trim() === '') continue;
      seen += 1;
      try {
        const record: unknown = JSON.parse(line);
        if (isRecord(record)) {
          const cwd = asString(record.cwd);
          if (cwd !== undefined) return cwd;
        }
      } catch {
        // Malformed line — keep scanning within the bound.
      }
      if (seen >= CWD_SCAN_MAX_LINES) break;
    }
  } finally {
    rl.close();
    stream.destroy();
  }
  return undefined;
}

async function discoverSessions(home: string): Promise<SessionFileRef[]> {
  const projectsDir = join(home, 'projects');
  let slugEntries: Dirent[];
  try {
    slugEntries = await claudeFs.readdir(projectsDir, { withFileTypes: true });
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === 'ENOENT') return [];
    throw error;
  }

  const refs: SessionFileRef[] = [];
  for (const slugEntry of slugEntries) {
    if (!slugEntry.isDirectory()) continue;
    const slugDir = join(projectsDir, slugEntry.name);
    // Session files sit directly in the slug dir; subdirectories (e.g. the
    // <sessionId>/tool-results/ spill dirs) are not descended into.
    let files: Dirent[];
    try {
      files = await claudeFs.readdir(slugDir, { withFileTypes: true });
    } catch {
      // One unreadable/vanished slug dir must not abort discovery of the rest.
      continue;
    }
    for (const file of files) {
      if (!file.isFile() || !file.name.endsWith('.jsonl')) continue;
      refs.push({
        runtime: 'claude',
        path: join(slugDir, file.name),
        sessionId: basename(file.name, '.jsonl'),
        projectSlug: slugEntry.name,
      });
    }
  }
  return refs.sort((a, b) => a.path.localeCompare(b.path));
}

export const claudeAdapter: HistoryAdapter = {
  runtime: 'claude',
  discoverSessions,
  async readSession(path: string): Promise<Session> {
    return parseClaudeSession(await claudeFs.readFile(path, 'utf8'), path);
  },
  async readPromptHistory(home: string): Promise<PromptHistory> {
    let text: string;
    try {
      text = await claudeFs.readFile(join(home, 'history.jsonl'), 'utf8');
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code === 'ENOENT') return parseClaudeHistory('');
      throw error;
    }
    return parseClaudeHistory(text);
  },
};
