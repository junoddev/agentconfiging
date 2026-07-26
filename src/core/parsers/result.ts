/**
 * Shared result shape for every parser in src/core/parsers.
 *
 * SPEC §4.1: parsers take file CONTENT (strings from Manifest entries) and
 * return typed models — pure functions, zero I/O. A parse NEVER throws on
 * malformed input: it returns whatever was salvageable plus a structured
 * problems list. Config content is adversarial data (other people's prompts);
 * parse structure only, never interpret it.
 */

export interface ParseProblem {
  /** JSONPath-ish location: '$', '$.permissions.allow[2]', 'frontmatter.globs'. */
  path: string;
  message: string;
}

/**
 * `ok: true` means a model was salvaged — `problems` may still be non-empty
 * (recoverable issues). `ok: false` means nothing usable was recovered and
 * `problems` explains why.
 */
export type ParseResult<T> =
  | { ok: true; model: T; problems: ParseProblem[] }
  | { ok: false; model?: undefined; problems: ParseProblem[] };

/** Maximum problems carried by one result; the rest collapse into a marker. */
export const MAX_PROBLEMS = 100;

/**
 * Bound a problems list: adversarial input can generate one problem per
 * malformed element, amplifying output size. Keep the first MAX_PROBLEMS and
 * append an overflow marker.
 */
export function capProblems(problems: ParseProblem[]): ParseProblem[] {
  if (problems.length <= MAX_PROBLEMS) return problems;
  return [
    ...problems.slice(0, MAX_PROBLEMS),
    problem('$', `problem list truncated: ${problems.length - MAX_PROBLEMS} more omitted`),
  ];
}

export function parsed<T>(model: T, problems: ParseProblem[] = []): ParseResult<T> {
  return { ok: true, model, problems: capProblems(problems) };
}

export function failed<T>(problems: ParseProblem[]): ParseResult<T> {
  return { ok: false, problems: capProblems(problems) };
}

export function problem(path: string, message: string): ParseProblem {
  return { path, message };
}

const MAX_MESSAGE_LENGTH = 200;

/**
 * Bound a diagnostic message that may quote adversarial file content:
 * control characters (ANSI escapes, NUL, BEL, ...) become spaces so they can
 * never reach a terminal or log intact, and length is capped. Every problem
 * message built from library errors or source text must pass through here.
 */
export function scrubMessage(raw: string): string {
  let clean = '';
  for (let i = 0; i < raw.length; i += 1) {
    const c = raw.charCodeAt(i);
    clean += c < 0x20 || c === 0x7f ? ' ' : raw.charAt(i);
  }
  return clean.length > MAX_MESSAGE_LENGTH ? `${clean.slice(0, MAX_MESSAGE_LENGTH)}…` : clean;
}

/** Turn a caught exception into a bounded, scrubbed problem. */
export function problemFromError(path: string, error: unknown): ParseProblem {
  const raw = error instanceof Error ? error.message : String(error);
  const message = scrubMessage(raw);
  return { path, message: message || 'unknown parse error' };
}
