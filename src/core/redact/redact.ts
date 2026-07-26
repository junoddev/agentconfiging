/**
 * Render-time redactor. Applies the ordered catalogue from `patterns.ts` to
 * a string and returns the redacted text plus the spans of the visible
 * `[REDACTED:*]` marks.
 *
 * Span semantics: `spans` are `[start, end)` character offsets into the
 * REDACTED OUTPUT text (`result.text`), not the input. Each span covers the
 * visible mark portion of a replacement — for `bearer` the kept literal
 * `Bearer ` prefix is excluded; for `kv_secret` the span includes the quotes
 * around the substituted value. Output offsets are what a renderer needs to
 * highlight the marks; the original offsets are useless once the secret is
 * gone (and would leak its length).
 *
 * Pure module: no I/O.
 */

import { REDACTION_PATTERNS, type RedactionPatternId } from './patterns.js';

export interface RedactionSpan {
  /** Start offset of the visible mark within the redacted output text. */
  start: number;
  /** End offset (exclusive) within the redacted output text. */
  end: number;
  /** Catalogue pattern that produced this redaction. */
  id: RedactionPatternId;
}

export interface RedactResult {
  /** Input text with every detected secret replaced by a visible mark. */
  text: string;
  /** Mark spans over `text`, sorted ascending by `start`. */
  spans: RedactionSpan[];
}

interface Substitution {
  sourceStart: number;
  sourceEnd: number;
  replacement: string;
  redactStartInReplacement: number;
  redactEndInReplacement: number;
  id: RedactionPatternId;
}

function collectSubstitutions(text: string): Substitution[] {
  // Each pass collects source-range substitutions; they are later spliced
  // in left-to-right and offsets translated to the output text.
  const subs: Substitution[] = [];

  for (const entry of REDACTION_PATTERNS) {
    // Re-clone the regex — exec mutates `lastIndex` and the shared module's
    // pattern must stay untouched for concurrent callers.
    const re = new RegExp(entry.pattern.source, entry.pattern.flags);
    let m: RegExpExecArray | null;
    while ((m = re.exec(text)) !== null) {
      const built = entry.build(m);
      if (!built) continue;
      subs.push({
        sourceStart: m.index,
        sourceEnd: m.index + m[0].length,
        replacement: built.replacement,
        redactStartInReplacement: built.redactStart,
        redactEndInReplacement: built.redactEnd,
        id: entry.id,
      });
    }
  }

  return subs;
}

export function redact(text: string): RedactResult {
  // Graceful passthrough for untyped JS consumers of dist/ (mirrors
  // upstream): nullish becomes '', other non-strings are returned as-is.
  if (typeof text !== 'string') {
    return { text: (text ?? '') as string, spans: [] };
  }
  if (text.length === 0) {
    return { text: '', spans: [] };
  }

  const subs = collectSubstitutions(text);
  if (subs.length === 0) {
    return { text, spans: [] };
  }

  // Sort by sourceStart (stable, so catalogue order breaks ties); drop
  // overlaps conservatively — discard the LATER sub when it begins before
  // the previous one ends.
  subs.sort((a, b) => a.sourceStart - b.sourceStart);
  const filtered: Substitution[] = [];
  let watermark = -1;
  for (const s of subs) {
    if (s.sourceStart < watermark) continue;
    filtered.push(s);
    watermark = s.sourceEnd;
  }

  // Splice: walk source left-to-right, copying verbatim spans and appending
  // replacements. Track the resulting [start, end) of each visible mark
  // within the output buffer.
  const outParts: string[] = [];
  const spans: RedactionSpan[] = [];
  let cursor = 0;
  let outLen = 0;
  for (const s of filtered) {
    if (s.sourceStart > cursor) {
      const verbatim = text.slice(cursor, s.sourceStart);
      outParts.push(verbatim);
      outLen += verbatim.length;
    }
    outParts.push(s.replacement);
    spans.push({
      start: outLen + s.redactStartInReplacement,
      end: outLen + s.redactEndInReplacement,
      id: s.id,
    });
    outLen += s.replacement.length;
    cursor = s.sourceEnd;
  }
  if (cursor < text.length) {
    outParts.push(text.slice(cursor));
  }

  return { text: outParts.join(''), spans };
}

/** True when `text` contains at least one secret the catalogue would redact. */
export function containsSecrets(text: string): boolean {
  // Same graceful non-string handling as redact().
  if (typeof text !== 'string' || text.length === 0) return false;
  for (const entry of REDACTION_PATTERNS) {
    const re = new RegExp(entry.pattern.source, entry.pattern.flags);
    let m: RegExpExecArray | null;
    while ((m = re.exec(text)) !== null) {
      if (entry.build(m) !== null) return true;
    }
  }
  return false;
}
