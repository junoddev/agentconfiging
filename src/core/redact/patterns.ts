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
 *   1. anthropic        (?<![A-Za-z0-9])sk-ant-[A-Za-z0-9_-]{20,}
 *   2. github           gh[pousr]_[A-Za-z0-9]{36,255} | github_pat_[A-Za-z0-9_]{22,255}
 *   3. slack            xox[baprs]-[A-Za-z0-9-]{10,250}
 *   4. aws_access_key   (AKIA|ASIA|AROA)[0-9A-Z]{16}
 *   5. google_api_key   AIza[0-9A-Za-z_-]{35}
 *   6. stripe           (sk|rk)_(live|test)_[0-9A-Za-z]{10,247}
 *   7. npm_token        npm_[A-Za-z0-9]{36}
 *   8. google_oauth     ya29\.[0-9A-Za-z_-]{10,}
 *   9. private_key      -----BEGIN … PRIVATE KEY----- … -----END … PRIVATE KEY-----
 *  10. slack_webhook    https://hooks.slack.com/services/[A-Za-z0-9/]{1,255}
 *  11. jwt              eyJ[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+
 *  12. bearer           Bearer\s+[A-Za-z0-9._+/=-]{20,}
 *  13. openai           (?<![A-Za-z0-9])sk-(?!ant-)[A-Za-z0-9_-]{20,}
 *  14. url_credentials  scheme://user:PASSWORD@ — redacts the password only
 *  15. kv_secret        (key)(sep)(value)  where key ∈ /token|secret|key|password/i
 *
 * The KV pattern is the catch-all and runs LAST so a value that already
 * matched a provider-specific pattern doesn't get re-mangled.
 * url_credentials sits just before it: when a secret-named key's value IS a
 * credentialed URL, the kv match starts earlier (at the key) and wins the
 * overlap watermark — redacting the whole value, which is strictly more; for
 * every other context (non-secret key names like ORBIT_BUS_URL, prose,
 * shell history) url_credentials is the only pattern that fires.
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
 *    eslint no-useless-escape. Identical semantics. (The kv_secret VALUE
 *    class divergence is item 8 below.)
 *
 * 6. openai / anthropic left boundary (redacts-LESS): `(?<![A-Za-z0-9])`
 *    before `sk-`. Upstream matched `sk-` mid-word, so prose like
 *    `risk-assessment-methodology` or `disk-encryption-standards` became
 *    `ri[REDACTED:openai]` / `di[REDACTED:openai]`, mangling rendered
 *    CLAUDE.md. Real keys follow `=`, `:`, quotes, whitespace, or start of
 *    text — none of which are alphanumeric — so `key=sk-…`, `"sk-…"` and
 *    ` sk-…` all still redact. `_` is deliberately NOT in the lookbehind
 *    (an underscore-glued `FOO_sk-…` still redacts — safe direction).
 *
 * 7. github pattern extended with fine-grained PATs (redacts-MORE):
 *    `github_pat_[A-Za-z0-9_]{22,255}`. Upstream's `gh[pousr]_` alternative
 *    cannot match the `github_pat_` prefix at all, so fine-grained tokens
 *    leaked entirely. Real fine-grained PATs are `github_pat_` + 22 base62
 *    chars + `_` + 59 more; requiring 22+ of `[A-Za-z0-9_]` catches both
 *    halves as one match while ignoring short prose like `github_pat_docs`.
 *
 * 8. kv_secret unquoted VALUE class widened (redacts-MORE):
 *    `[A-Za-z0-9_\-./+=]+` → `[^\s"'#]+` (run to whitespace/EOL, still
 *    excluding quotes and `#` comment starts like upstream's class did).
 *    Upstream stopped at the first char outside its narrow class, so
 *    `PASSWORD=p@ssw0rd!FAKE` redacted only `p` and PRINTED the rest —
 *    output that LOOKS redacted but leaks the tail (dangerous polarity).
 *    Side effect (accepted): unquoted values now swallow trailing
 *    punctuation up to whitespace (`token: abc,` consumes the comma).
 *
 * 9. url_credentials pattern (redacts-MORE, not in upstream): passwords
 *    embedded in URLs (`amqp://user:pass@host`, `postgres://…`,
 *    `https://user:token@…`) leaked entirely — the host key (e.g.
 *    ORBIT_BUS_URL) rarely matches the kv secret-key regex. Redacts ONLY
 *    the password segment — between the first `:` after `//`+userinfo and
 *    the `@` — keeping scheme/user/host visible. ReDoS hygiene: userinfo
 *    `{1,64}` and password `{1,256}` bounds, all classes exclude the chars
 *    that delimit them (userinfo can't contain `:`, password can't contain
 *    `@`), scheme bounded `{0,31}` — no nested quantifiers, no ambiguity,
 *    and an `@`-less scan fails after at most one bounded backtrack chain
 *    per `://` occurrence. Quotes are excluded from userinfo/password so a
 *    quoted URL value never swallows its closing quote.
 *
 * 10. kv_secret keybinding exemption (redacts-LESS, deliberately narrow):
 *    `/key/i` in SECRET_KEY makes keybindings.json entries like
 *    `"key": "ctrl+k"` redact (3 FP hits in the claude-rich fixture). Rule:
 *    when the key name is EXACTLY `key` (case-insensitive) the value is
 *    skipped only if it cannot plausibly be a secret — shorter than 8 chars
 *    OR shaped like a key chord (short alnum tokens joined by `+`/space,
 *    e.g. `ctrl+g ctrl+s`). Everything else about `key` still redacts
 *    (`"key": "aVeryLongSecret123"` stays covered), compound names
 *    (`api_key`, `KEY_ID`) are exempt from the exemption, and provider
 *    patterns still scan the value independently — safe-direction bias.
 *
 * 11. slack pattern (redacts-MORE, not in upstream):
 *    `xox[baprs]-[A-Za-z0-9-]{10,250}` — bot/user/app/refresh/session
 *    tokens. Single bounded character class, no ambiguity.
 *
 * 12. Additional provider formats (redacts-MORE, np6 coverage gaps). Every one
 *    is a single bounded character class after a fixed literal prefix — no
 *    nested quantifiers, no ambiguity, linear per start offset (same ReDoS
 *    hygiene as items 9/11). Fixed left/right boundaries where the token has an
 *    EXACT length so a longer alnum run is not sliced (partial-redaction leak):
 *      - google_api_key `AIza` + 35 base64url chars (exact; both boundaries).
 *      - stripe         `(sk|rk)_(live|test)_` + 10..247 base62.
 *      - npm_token      `npm_` + 36 base62 (exact; both boundaries).
 *      - google_oauth   `ya29.` + 10.. base64url run.
 *      - private_key    a PEM `-----BEGIN … PRIVATE KEY-----` … `-----END …
 *                       PRIVATE KEY-----` block; the body is a BOUNDED lazy
 *                       `[\s\S]{0,4096}?` so an unterminated BEGIN fails after a
 *                       bounded scan per occurrence (never unbounded backtracking).
 *      - slack_webhook  `https://hooks.slack.com/services/<path>` — the secret is
 *                       in the URL PATH, so url_credentials (which needs
 *                       `user:pass@`) never fires; a dedicated pattern is needed.
 *
 * 13. bearer value class WIDENED (redacts-MORE, tail-leak fix): the bearer token
 *    run was `[A-Za-z0-9_-]` — base64url only. A bearer holding a JWT
 *    (`Bearer eyJ….payload.sig`) or a STANDARD-base64 token (`+`, `/`, `=`
 *    padding) stopped at the first `.`/`+`/`/`, redacting only the head and
 *    PRINTING the tail (same dangerous polarity as item 8). Widened to
 *    `[A-Za-z0-9._+/=-]` — a single class, still linear. jwt and openai/anthropic
 *    are DELIBERATELY left narrow: JWTs are base64url (never `+`//), and the
 *    provider `sk-`/`sk-ant-` alphabets do not use `+`//= either, so widening
 *    them would only over-consume adjacent prose.
 */

export type RedactionPatternId =
  | 'anthropic'
  | 'github'
  | 'slack'
  | 'aws_access_key'
  | 'google_api_key'
  | 'stripe'
  | 'npm_token'
  | 'google_oauth'
  | 'private_key'
  | 'slack_webhook'
  | 'jwt'
  | 'bearer'
  | 'openai'
  | 'url_credentials'
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

// Divergence 10: values under the EXACT key name `key` that look like key
// chords (short alnum tokens joined by `+` or space) are keybindings, not
// secrets. Bounded tokens ({1,10}) and repeats ({1,7}) — real secrets with
// `+` (e.g. base64) have long runs that fail the token bound.
const KEYBINDING_SHAPE = /^[A-Za-z][A-Za-z0-9]{0,9}(?:[+ ][A-Za-z0-9]{1,10}){1,7}$/;

// URL-embedded credentials (divergence 9). Group 1 is the kept prefix
// `scheme://user:`; the password run up to `@` is what gets replaced. The
// trailing `@` is consumed by the match and re-emitted by build() so the
// host stays visible.
const URL_CRED_MARK = markFor('url_credentials');
const URL_CRED_ENTRY: RedactionPattern = {
  id: 'url_credentials',
  pattern: /([A-Za-z][A-Za-z0-9+.-]{0,31}:\/\/[^\s:@/"']{1,64}:)[^\s@/"']{1,256}@/g,
  mark: URL_CRED_MARK,
  build(match) {
    // match[1] = `scheme://user:` — kept verbatim, only the password is marked.
    const prefix = match[1] ?? '';
    const replacement = `${prefix}${URL_CRED_MARK}@`;
    return {
      replacement,
      redactStart: prefix.length,
      redactEnd: prefix.length + URL_CRED_MARK.length,
    };
  },
};

// KV catch-all. The visible-mark span here is the trailing `"[REDACTED:kv_secret]"`
// (the value substitution, including its quotes); the key/separator are kept
// verbatim so the user can see WHICH key was redacted.
//
// Deliberate divergences from upstream (see header): the leading
// `(?<![A-Za-z_])` boundary + the `{0,127}` key bound (quadratic-scan
// mitigation), the disjoint quoted-value alternatives
// `(?:\\.|(?!\4|\\).)*` (ReDoS fix — upstream's `(?!\4).` second branch
// could also consume a backslash), the widened unquoted value class
// `[^\s"'#]+` (partial-redaction leak fix, item 8), and the exact-`key`
// keybinding exemption in build() (item 10).
const KV_MARK = markFor('kv_secret');
const KV_ENTRY: RedactionPattern = {
  id: 'kv_secret',
  pattern:
    /(?<![A-Za-z_])(["']?)([A-Za-z_][A-Za-z0-9_-]{0,127})\1(\s*[:=]\s*)(?:(["'])((?:\\.|(?!\4|\\).)*)\4|([^\s"'#]+))/g,
  mark: KV_MARK,
  build(match) {
    // match[0] = whole; match[1]=kq, match[2]=key, match[3]=sep,
    // match[5]=quoted value (inner), match[6]=unquoted value
    const kq = match[1] ?? '';
    const key = match[2] ?? '';
    const sep = match[3] ?? '';
    if (!SECRET_KEY.test(key)) return null;
    // Divergence 10: bare `key` holding a short value or a key chord is a
    // keybinding entry, not a secret. Compound names (api_key, …) and
    // long/opaque values still redact; provider patterns still scan the
    // value independently.
    if (key.toLowerCase() === 'key') {
      const value = match[5] ?? match[6] ?? '';
      if (value.length < 8 || KEYBINDING_SHAPE.test(value)) return null;
    }
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
  // 1. Anthropic — must precede the OpenAI sk- pattern. Left boundary is
  //    divergence 6 (prose FP fix, shared with openai).
  whole('anthropic', /(?<![A-Za-z0-9])sk-ant-[A-Za-z0-9_-]{20,}/g),
  // 2. GitHub tokens: classic (ghp_, gho_, ghu_, ghs_, ghr_) plus
  //    fine-grained github_pat_ (divergence 7).
  whole('github', /gh[pousr]_[A-Za-z0-9]{36,255}|github_pat_[A-Za-z0-9_]{22,255}/g),
  // 3. Slack tokens (divergence 11, not in upstream).
  whole('slack', /xox[baprs]-[A-Za-z0-9-]{10,250}/g),
  // 4. AWS access keys (long-lived AKIA, temporary ASIA, role AROA).
  whole('aws_access_key', /\b(?:AKIA|ASIA|AROA)[0-9A-Z]{16}\b/g),
  // 5. Google API keys (divergence 12) — `AIza` + exactly 35 base64url chars.
  //    Both boundaries so a longer alnum run is never sliced to a partial hit.
  whole('google_api_key', /(?<![A-Za-z0-9_-])AIza[0-9A-Za-z_-]{35}(?![0-9A-Za-z_-])/g),
  // 6. Stripe secret/restricted keys (divergence 12) — live + test variants.
  whole('stripe', /(?<![A-Za-z0-9])(?:sk|rk)_(?:live|test)_[0-9A-Za-z]{10,247}/g),
  // 7. npm tokens (divergence 12) — `npm_` + exactly 36 base62 chars.
  whole('npm_token', /(?<![A-Za-z0-9])npm_[A-Za-z0-9]{36}(?![A-Za-z0-9])/g),
  // 8. Google OAuth access tokens (divergence 12) — `ya29.` + a base64url run.
  whole('google_oauth', /(?<![A-Za-z0-9_-])ya29\.[0-9A-Za-z_-]{10,}/g),
  // 9. PEM private-key blocks (divergence 12). The body is a BOUNDED lazy
  //    `[\s\S]{0,4096}?` — an unterminated BEGIN fails after a bounded scan per
  //    occurrence, never unbounded backtracking. Whole block → the mark.
  whole(
    'private_key',
    /-----BEGIN (?:RSA |EC |OPENSSH |PGP )?PRIVATE KEY-----[\s\S]{0,4096}?-----END (?:RSA |EC |OPENSSH |PGP )?PRIVATE KEY-----/g,
  ),
  // 10. Slack webhook URLs (divergence 12) — the token is in the URL PATH, so
  //    url_credentials (which needs `user:pass@`) never covers it.
  whole('slack_webhook', /https:\/\/hooks\.slack\.com\/services\/[A-Za-z0-9/]{1,255}/g),
  // 11. JWT-shaped tokens (header.payload.signature, base64url chunks).
  //    Divergence from upstream (see header): left boundary added so
  //    `eyJeyJ…` repeats don't rescan quadratically.
  whole('jwt', /(?<![A-Za-z0-9_-])eyJ[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+/g),
  // 12. Bearer tokens. Value class widened (divergence 13) to cover JWT dots +
  //    standard-base64 `+`/`/`/`=` so the tail is never left printed.
  prefixed('bearer', /Bearer\s+[A-Za-z0-9._+/=-]{20,}/g, 'Bearer '),
  // 13. OpenAI sk- — explicitly exclude sk-ant- via negative lookahead so
  //    Anthropic keys are tagged anthropic (and not silently downgraded).
  //    Left boundary is divergence 6 (risk-/disk- prose FP fix).
  whole('openai', /(?<![A-Za-z0-9])sk-(?!ant-)[A-Za-z0-9_-]{20,}/g),
  // 14. URL-embedded credentials (divergence 9) — before the KV catch-all;
  //    when a secret-named key's value is a credentialed URL the kv match
  //    starts earlier and wins the overlap watermark (redacts strictly more).
  URL_CRED_ENTRY,
  // 15. KV catch-all — runs last.
  KV_ENTRY,
];
