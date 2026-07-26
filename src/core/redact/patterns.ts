/**
 * Redaction pattern catalogue — single source of truth for the redactor's
 * regex set. Ported (semantics-preserving) from our own
 * `../markdowning/cli/src/verticals/agentconfig/redact_patterns.js`.
 *
 * Pure module: no Node I/O, no React.
 *
 * Pattern shape:
 *   { id, pattern: RegExp (global), mark, build(match) -> RedactionReplacement | null }
 *
 * `build()` returns the literal replacement string AND the span within that
 * replacement that should be marked visibly. Keeping span metadata adjacent
 * to the regex prevents redactor variants from drifting.
 *
 * --- Pattern catalogue (ordered) ---
 *
 * Ordering matters: more-specific provider keys MUST come before the generic
 * OpenAI `sk-…` catch-all so e.g. an Anthropic `sk-ant-…` key is tagged as
 * anthropic (and not double-matched).
 *
 *   1. anthropic          sk-ant-[A-Za-z0-9_-]{20,}
 *   2. github             gh[pousr]_[A-Za-z0-9]{36,255}
 *   3. aws_access_key     (AKIA|ASIA|AROA)[0-9A-Z]{16}
 *   4. jwt                eyJ[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+
 *   5. bearer             Bearer\s+[A-Za-z0-9_-]{20,}
 *   6. openai             sk-(?!ant-)[A-Za-z0-9_-]{20,}    ← excludes sk-ant-…
 *   7. kv_secret          (key)(sep)(value)  where key ∈ /token|secret|key|password/i
 *
 * The KV pattern is the catch-all and runs LAST so a value that already
 * matched a provider-specific pattern doesn't get re-mangled.
 *
 * --- Deliberate divergences from upstream ---
 *
 * 1. kv_secret quoted-value branch: upstream's `(?:\\.|(?!\4).)*` is
 *    ambiguous (both alternatives can consume a backslash), which explodes
 *    exponentially on UNTERMINATED quoted values made of backslashes
 *    (~45 bytes ≈ 1s, doubling every +2 chars). Rewritten with disjoint
 *    alternatives: `(?:\\.|(?!\4|\\).)*` — a backslash can only be consumed
 *    by the escape branch, so failure is linear. (`(?!\4|\\).` rather than
 *    `[^\\]` so `.`'s no-line-terminator semantics are preserved exactly.)
 *    Only observable behavior difference: pathological unterminated values
 *    whose tail is backslash-quote (e.g. `key: "a\"` with no real closing
 *    quote — upstream reinterpreted the `\` as a literal to close on the
 *    escaped quote) no longer match; properly terminated values are handled
 *    identically. Cousin case: sloppy Windows-path values whose final
 *    backslash swallows the closing quote (`key: "C:\dir\"`) also no longer
 *    match — same reinterpretation upstream relied on.
 *
 * 2. kv_secret left boundary: `(?<![A-Za-z_])` requires the key (or its
 *    opening quote) not to be glued to a preceding letter/underscore.
 *    Upstream retried the key scan at every offset inside long unbroken
 *    token runs, making a 32KB single-token input quadratic (~1.8s).
 *    Behavior difference: an opening key QUOTE fused to a preceding
 *    letter/underscore (`foo"token": x`) no longer starts a key — upstream
 *    matched the quoted suffix. Unquoted keys are unaffected: a fused
 *    compound like `xsecret: x` matches as the key `xsecret`, which still
 *    contains the secret word — the same match upstream produced. Digits
 *    and `-` are deliberately NOT in the lookbehind class, so digit-led
 *    names (`2fa_token: …` — matched as key `fa_token`, exactly as
 *    upstream), hyphen-prefixed keys (`--api-key=…`) and dotted keys
 *    (`config.token: x`) still redact; the `{0,127}` key bound (item 3) is
 *    what keeps per-offset work bounded despite those extra start offsets. Second-order effect (safe direction): a glued
 *    NON-secret key no longer consumes its value during the scan, so a real
 *    secret pair upstream's scan had swallowed as a value can now be seen
 *    and redacted.
 *
 * 3. kv_secret key length bounded to 128 chars (`{0,127}` after the first).
 *    Because `-` stays out of the lookbehind, `-`-separated runs (`sk-sk-…`)
 *    still offer many key-scan start offsets; the bound caps per-offset
 *    backtracking so those runs stay linear. Real key names are far below
 *    128 chars; upstream matched unbounded keys.
 *
 * 4. jwt left boundary: `(?<![A-Za-z0-9_-])eyJ…`. Upstream re-scanned the
 *    base64url run from every `eyJ` occurrence, making `eyJeyJeyJ…` inputs
 *    quadratic. Behavior difference — stated plainly: a JWT glued directly
 *    to a preceding `[A-Za-z0-9_-]` char (`xeyJ…`, `secreteyJ…`,
 *    `KEYgithub_pat_eyJ…`) is NOT redacted. This is a deliberate
 *    redacts-LESS divergence; it is unrealistic in real configs, where JWTs
 *    follow `=`, `:`, whitespace, quotes, or `Bearer `.
 *
 * 5. Cosmetic: `\-` at the end of character classes written as a plain `-`
 *    (`[A-Za-z0-9_-]` instead of upstream's `[A-Za-z0-9_\-]`) to satisfy
 *    eslint no-useless-escape. Identical semantics. The kv_secret VALUE
 *    class keeps the escaped form (`[A-Za-z0-9_\-./+=]`) because a bare `-`
 *    before `.` would be an invalid descending range.
 */

export type RedactionPatternId =
  | 'anthropic'
  | 'github'
  | 'aws_access_key'
  | 'jwt'
  | 'bearer'
  | 'openai'
  | 'kv_secret';

export interface RedactionReplacement {
  /** Literal text substituted for the matched secret. */
  replacement: string;
  /** Start of the visible mark within `replacement`. */
  redactStart: number;
  /** End (exclusive) of the visible mark within `replacement`. */
  redactEnd: number;
}

export interface RedactionPattern {
  readonly id: RedactionPatternId;
  /**
   * Global regex. Callers must clone (`new RegExp(source, flags)`) before
   * `exec` loops — the shared instance's `lastIndex` must stay untouched.
   */
  readonly pattern: RegExp;
  /** The visible mark for this pattern, e.g. `[REDACTED:anthropic]`. */
  readonly mark: string;
  /**
   * Build the replacement for one match, or null when the match turns out
   * not to be a secret (only the KV catch-all ever returns null).
   */
  readonly build: (match: readonly (string | undefined)[]) => RedactionReplacement | null;
}

/** Visible mark rendered in place of a secret, e.g. `[REDACTED:github]`. */
export function markFor(id: RedactionPatternId): string {
  return `[REDACTED:${id}]`;
}

// Helper: simple "replace whole match with the mark" pattern entry.
// The visible-mark span covers the whole replacement.
function whole(id: RedactionPatternId, pattern: RegExp): RedactionPattern {
  const mark = markFor(id);
  return {
    id,
    pattern,
    mark,
    build() {
      return { replacement: mark, redactStart: 0, redactEnd: mark.length };
    },
  };
}

// Helper: "Bearer [REDACTED:bearer]" — keep the literal prefix, redact the rest.
function prefixed(id: RedactionPatternId, pattern: RegExp, prefix: string): RedactionPattern {
  const mark = markFor(id);
  return {
    id,
    pattern,
    mark,
    build() {
      const replacement = `${prefix}${mark}`;
      return { replacement, redactStart: prefix.length, redactEnd: replacement.length };
    },
  };
}

const SECRET_KEY = /(token|secret|key|password)/i;

// KV catch-all. The visible-mark span here is the trailing `"[REDACTED:kv_secret]"`
// (the value substitution, including its quotes); the key/separator are kept
// verbatim so the user can see WHICH key was redacted.
//
// Deliberate divergences from upstream (see header): the leading
// `(?<![A-Za-z_])` boundary + the `{0,127}` key bound (quadratic-scan
// mitigation) and the disjoint quoted-value alternatives
// `(?:\\.|(?!\4|\\).)*` (ReDoS fix — upstream's `(?!\4).` second branch
// could also consume a backslash).
const KV_MARK = markFor('kv_secret');
const KV_ENTRY: RedactionPattern = {
  id: 'kv_secret',
  pattern:
    /(?<![A-Za-z_])(["']?)([A-Za-z_][A-Za-z0-9_-]{0,127})\1(\s*[:=]\s*)(?:(["'])((?:\\.|(?!\4|\\).)*)\4|([A-Za-z0-9_\-./+=]+))/g,
  mark: KV_MARK,
  build(match) {
    // match[0] = whole; match[1]=kq, match[2]=key, match[3]=sep
    const kq = match[1] ?? '';
    const key = match[2] ?? '';
    const sep = match[3] ?? '';
    if (!SECRET_KEY.test(key)) return null;
    const replacement = `${kq}${key}${kq}${sep}"${KV_MARK}"`;
    // Span covers the trailing "[REDACTED:kv_secret]" portion (with surrounding quotes).
    return {
      replacement,
      redactStart: replacement.length - (KV_MARK.length + 2),
      redactEnd: replacement.length,
    };
  },
};

export const REDACTION_PATTERNS: readonly RedactionPattern[] = [
  // 1. Anthropic — must precede the OpenAI sk- pattern.
  whole('anthropic', /sk-ant-[A-Za-z0-9_-]{20,}/g),
  // 2. GitHub tokens (ghp_, gho_, ghu_, ghs_, ghr_).
  whole('github', /gh[pousr]_[A-Za-z0-9]{36,255}/g),
  // 3. AWS access keys (long-lived AKIA, temporary ASIA, role AROA).
  whole('aws_access_key', /\b(?:AKIA|ASIA|AROA)[0-9A-Z]{16}\b/g),
  // 4. JWT-shaped tokens (header.payload.signature, base64url chunks).
  //    Divergence from upstream (see header): left boundary added so
  //    `eyJeyJ…` repeats don't rescan quadratically.
  whole('jwt', /(?<![A-Za-z0-9_-])eyJ[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+/g),
  // 5. Bearer tokens.
  prefixed('bearer', /Bearer\s+[A-Za-z0-9_-]{20,}/g, 'Bearer '),
  // 6. OpenAI sk- — explicitly exclude sk-ant- via negative lookahead so
  //    Anthropic keys are tagged anthropic (and not silently downgraded).
  whole('openai', /sk-(?!ant-)[A-Za-z0-9_-]{20,}/g),
  // 7. KV catch-all — runs last.
  KV_ENTRY,
];
