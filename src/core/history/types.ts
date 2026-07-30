/**
 * Typed models for runtime session history (SPEC §3 / §4.1 "History readers").
 *
 * Read-only. Session log content is ADVERSARIAL DATA: readers parse and type
 * it, but every piece of content stays an opaque string — nothing found in a
 * log is ever interpreted or executed. Readers never throw on malformed lines;
 * they skip them and count them in {@link ReadDiagnostics}.
 */

export const RUNTIMES = ['claude', 'codex', 'gemini', 'opencode'] as const;
export type Runtime = (typeof RUNTIMES)[number];

/**
 * Per-file read health. Skipped lines are counted, never fatal. The counters
 * reconcile: `totalLines === <entries produced> + skipped + malformed + ignored`.
 */
export interface ReadDiagnostics {
  /** Non-empty lines seen in the file (after stripping a leading BOM). */
  totalLines: number;
  /** Lines with an unrecognized `type`, dropped. */
  skipped: number;
  /** Lines that failed to parse or had an unusable shape, dropped. */
  malformed: number;
  /** Recognized non-message lines consumed as metadata or known noise. */
  ignored: number;
  /**
   * Distinct unrecognized `type` values. Each value is truncated to 64 chars
   * and at most 20 are retained — log content is adversarial, so this list is
   * bounded.
   */
  unknownTypes: string[];
  /** Unknown-type lines whose type was NOT retained in `unknownTypes` (over the cap). */
  overflowCount: number;
  /** `<persisted-output>` references dropped because the path failed validation. */
  rejectedSpillPaths: number;
}

/** One prompt from a runtime-wide prompt history (claude's `~/.claude/history.jsonl`). */
export interface PromptHistoryEntry {
  /** The typed prompt, verbatim (opaque text). */
  display: string;
  /** Epoch milliseconds, when present. */
  timestamp?: number;
  /** The project path the prompt was typed in, when present. */
  project?: string;
  /** Number of pasted attachments; the pasted content itself is not retained. */
  pastedContentCount: number;
}

export interface PromptHistory {
  entries: PromptHistoryEntry[];
  diagnostics: ReadDiagnostics;
}

/** A typed content block inside a session message. All payloads are opaque. */
export type ContentBlock =
  | { type: 'text'; text: string }
  | { type: 'thinking'; thinking: string }
  | { type: 'tool_use'; id?: string; name?: string; input?: unknown }
  | {
      type: 'tool_result';
      toolUseId?: string;
      /** Inline result text (may be a `<persisted-output>` stub, kept verbatim). */
      text: string;
      /**
       * When the runtime spilled a large tool result to disk and left a
       * `<persisted-output>` stub, the referenced file path. Only present when
       * the content-derived path passes validation (normalized, no traversal,
       * `<sessionId>/tool-results/<file>` shape); rejected references are
       * counted in {@link ReadDiagnostics.rejectedSpillPaths}. The spill file
       * is never read by these readers.
       */
      persistedOutputPath?: string;
    }
  | { type: 'unknown'; blockType: string };

/**
 * Per-message token accounting, lifted verbatim from an assistant message's
 * `message.usage` block. Pure token COUNTS (never content). Absent fields
 * default to 0; the whole struct is absent when the message carried no usage
 * block (user messages, older logs).
 */
export interface TokenUsage {
  /** Fresh (uncached) input tokens billed at the input rate. */
  inputTokens: number;
  /** Generated output tokens. */
  outputTokens: number;
  /** Tokens written INTO the prompt cache (billed at the cache-write rate). */
  cacheCreationTokens: number;
  /** Tokens served FROM the prompt cache (billed at the cheap cache-read rate). */
  cacheReadTokens: number;
}

export interface SessionMessage {
  role: 'user' | 'assistant';
  uuid?: string;
  parentUuid?: string | null;
  /** ISO timestamp string as recorded, when present. */
  timestamp?: string;
  cwd?: string;
  /** Subagent traffic recorded inline in the parent session file. */
  isSidechain: boolean;
  /** Runtime-injected meta lines (e.g. local-command caveats), not typed by the user. */
  isMeta: boolean;
  /** Model id for assistant messages, when present. */
  model?: string;
  /** Token usage from the assistant `message.usage` block, when present. */
  usage?: TokenUsage;
  content: ContentBlock[];
}

export interface Session {
  runtime: Runtime;
  /** From in-file entries when present, else derived from the file name (if any). */
  sessionId?: string;
  filePath: string;
  /**
   * The FIRST working directory read from in-file entries — NEVER decoded
   * from the project slug directory name, which is lossy (`/` and `.` both
   * map to `-`, so distinct cwds can collide into one slug dir). Equals
   * `cwds[0]`; see {@link Session.cwds} for every distinct cwd seen.
   */
  cwd?: string;
  /** All distinct cwds seen in message entries, in first-seen order. */
  cwds: string[];
  gitBranch?: string;
  /** Runtime version string as recorded. */
  version?: string;
  /** ai-title line, when present. */
  title?: string;
  /** summary line, when present. */
  summary?: string;
  /** Earliest / latest parseable message timestamp (not file order). */
  startedAt?: string;
  endedAt?: string;
  messages: SessionMessage[];
  diagnostics: ReadDiagnostics;
}

/** A discovered session file, prior to reading it. */
export interface SessionFileRef {
  runtime: Runtime;
  path: string;
  /** Derived from the file name. */
  sessionId: string;
  /**
   * The on-disk project slug directory name, informational only. LOSSY: it
   * must never be decoded back into a path — read `cwd` from the parsed
   * {@link Session} instead.
   */
  projectSlug?: string;
}

/**
 * One adapter per runtime. Only the claude adapter exists today; codex,
 * gemini and opencode adapters plug in later behind the same interface.
 */
export interface HistoryAdapter {
  readonly runtime: Runtime;
  /** Locate session files under the runtime's home dir (e.g. `~/.claude`). */
  discoverSessions(home: string): Promise<SessionFileRef[]>;
  /** Read and type one session file. Never throws on malformed content. */
  readSession(path: string): Promise<Session>;
  /** Runtime-wide prompt history, for runtimes that keep one. */
  readPromptHistory?(home: string): Promise<PromptHistory>;
}
