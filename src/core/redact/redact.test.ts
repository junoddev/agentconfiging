import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';
import { containsSecrets, markFor, redact, REDACTION_PATTERNS } from './index.js';

const fixture = (rel: string): string =>
  readFileSync(fileURLToPath(new URL(`../../../fixtures/${rel}`, import.meta.url)), 'utf-8');

/** Every span must slice out exactly the visible mark for its pattern id. */
function expectSpansCoverMarks(result: ReturnType<typeof redact>): void {
  for (const span of result.spans) {
    const sliced = result.text.slice(span.start, span.end);
    if (span.id === 'kv_secret') {
      expect(sliced).toBe(`"${markFor('kv_secret')}"`);
    } else {
      expect(sliced).toBe(markFor(span.id));
    }
  }
}

describe('REDACTION_PATTERNS ordering', () => {
  it('lists anthropic before the generic openai sk- pattern', () => {
    const ids = REDACTION_PATTERNS.map((p) => p.id);
    expect(ids.indexOf('anthropic')).toBeLessThan(ids.indexOf('openai'));
    expect(ids[ids.length - 1]).toBe('kv_secret');
    // url_credentials sits just before the kv catch-all (np8.10).
    expect(ids[ids.length - 2]).toBe('url_credentials');
  });
});

describe('provider patterns', () => {
  it('tags Anthropic sk-ant- keys as anthropic, not openai', () => {
    const FAKE = 'sk-ant-api03-AbCdEfGhIjKlMnOpQrStUvWxYz0123456789';
    const { text, spans } = redact(`x ${FAKE} y`);
    expect(text).toBe(`x ${markFor('anthropic')} y`);
    expect(spans).toHaveLength(1);
    expect(spans[0]?.id).toBe('anthropic');
  });

  it('tags bare sk- keys as openai via the (?!ant-) lookahead', () => {
    const FAKE = 'sk-abcdefghijklmnopqrst1234567890';
    const { text, spans } = redact(FAKE);
    expect(text).toBe(markFor('openai'));
    expect(spans).toEqual([{ start: 0, end: markFor('openai').length, id: 'openai' }]);
  });

  it('redacts GitHub tokens for all five prefixes', () => {
    for (const prefix of ['ghp_', 'gho_', 'ghu_', 'ghs_', 'ghr_']) {
      const FAKE = prefix + 'a'.repeat(40);
      const { text, spans } = redact(`gh ${FAKE}\n`);
      expect(text, prefix).toBe(`gh ${markFor('github')}\n`);
      expect(spans[0]?.id, prefix).toBe('github');
    }
  });

  it('redacts AWS access keys (AKIA, ASIA, AROA) at word boundaries', () => {
    for (const FAKE of ['AKIAIOSFODNN7EXAMPLE', 'ASIAQQQQQQQQQQQQQQQQ', 'AROAEXAMPLEEXAMPLE12']) {
      const { text, spans } = redact(`aws ${FAKE}\n`);
      expect(text, FAKE).not.toContain(FAKE);
      expect(spans[0]?.id, FAKE).toBe('aws_access_key');
    }
    // Word boundary: embedded in a longer identifier it is not a key.
    expect(redact('XAKIAIOSFODNN7EXAMPLE').spans).toEqual([]);
  });

  it('redacts JWT-shaped tokens', () => {
    const FAKE =
      'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9' +
      '.eyJzdWIiOiIxMjM0NTY3ODkwIiwibmFtZSI6IkpvaG4ifQ' +
      '.SflKxwRJSMeKKF2QT4fwpMeJf36POk6yJV_adQssw5c';
    const { text, spans } = redact(`auth ${FAKE}`);
    expect(text).toBe(`auth ${markFor('jwt')}`);
    expect(spans[0]?.id).toBe('jwt');
  });

  it('keeps the Bearer prefix and marks only the token', () => {
    const result = redact('Authorization: Bearer abcdefghijklmnopqrstuvwxyz123');
    expect(result.text).toBe(`Authorization: Bearer ${markFor('bearer')}`);
    expect(result.spans).toHaveLength(1);
    const span = result.spans[0];
    expect(span?.id).toBe('bearer');
    // Span excludes the kept "Bearer " prefix.
    expect(result.text.slice(span!.start, span!.end)).toBe(markFor('bearer'));
    expect(result.text.slice(0, span!.start)).toBe('Authorization: Bearer ');
  });
});

describe('kv_secret catch-all', () => {
  it('redacts JSON key-value pairs whose key matches the secret regex', () => {
    const input = '{"api_key": "sk-live-abcdef", "description": "not a secret"}';
    const { text, spans } = redact(input);
    expect(text).toContain(`"api_key": "${markFor('kv_secret')}"`);
    expect(text).toContain('"description": "not a secret"');
    expect(spans).toHaveLength(1);
  });

  it('redacts YAML- and TOML-style key-value pairs', () => {
    const y = redact('token: mysupersecret123\nnormal: hello');
    expect(y.text).toBe(`token: "${markFor('kv_secret')}"\nnormal: hello`);

    const t = redact('password = "hunter2hunter2hunter2"\ntitle = "project"');
    expect(t.text).toBe(`password = "${markFor('kv_secret')}"\ntitle = "project"`);
  });

  it('does NOT redact innocuous keys with secret words only in the VALUE', () => {
    const input = '{"description": "not a secret", "title": "my token idea"}';
    const result = redact(input);
    expect(result.text).toBe(input);
    expect(result.spans).toEqual([]);
  });

  it('wins over a provider pattern when the whole KV pair is the earlier match', () => {
    // The KV match starts at the key (before the sk- value), so overlap
    // filtering keeps kv_secret and drops the inner openai sub.
    const { text, spans } = redact('"OPENAI_API_KEY": "sk-FAKE00000000000000000000"');
    expect(text).toBe(`"OPENAI_API_KEY": "${markFor('kv_secret')}"`);
    expect(spans.map((s) => s.id)).toEqual(['kv_secret']);
  });
});

describe('redact span semantics (offsets in OUTPUT text)', () => {
  it('tracks correct offsets for multiple hits in one string', () => {
    const input =
      'a=AKIAIOSFODNN7EXAMPLE b Bearer abcdefghijklmnopqrstuv c ' +
      'sk-ant-00000000000000000000 d sk-11111111111111111111 e';
    const result = redact(input);
    expect(result.spans.map((s) => s.id)).toEqual([
      'aws_access_key',
      'bearer',
      'anthropic',
      'openai',
    ]);
    // Spans are sorted ascending and index into the redacted output.
    for (let i = 1; i < result.spans.length; i += 1) {
      expect(result.spans[i]!.start).toBeGreaterThanOrEqual(result.spans[i - 1]!.end);
    }
    expectSpansCoverMarks(result);
    expect(result.text).toBe(
      `a=${markFor('aws_access_key')} b Bearer ${markFor('bearer')} c ` +
        `${markFor('anthropic')} d ${markFor('openai')} e`,
    );
  });

  it('passes clean text through untouched', () => {
    const input = 'Just a plain sentence about configuration files.\nNothing to see.';
    expect(redact(input)).toEqual({ text: input, spans: [] });
  });

  it('handles empty input', () => {
    expect(redact('')).toEqual({ text: '', spans: [] });
  });

  it('passes non-string input through gracefully (untyped JS consumers)', () => {
    expect(redact(null as unknown as string)).toEqual({ text: '', spans: [] });
    expect(redact(undefined as unknown as string)).toEqual({ text: '', spans: [] });
    expect(redact(42 as unknown as string)).toEqual({ text: 42, spans: [] });
    expect(containsSecrets(null as unknown as string)).toBe(false);
    expect(containsSecrets(undefined as unknown as string)).toBe(false);
  });
});

describe('documented divergences from upstream (see patterns.ts header)', () => {
  it('still redacts hyphen-prefixed and dotted keys (lookbehind excludes -)', () => {
    expect(redact('--api-key=abc123xyz').text).toBe(`--api-key="${markFor('kv_secret')}"`);
    expect(redact('config.token: abc123').text).toBe(`config.token: "${markFor('kv_secret')}"`);
  });

  it('still redacts digit-led key names (lookbehind excludes digits)', () => {
    // Matched as key `fa_token`/`fa_secret` with the digit kept verbatim —
    // exactly what upstream did (keys cannot start with a digit).
    expect(redact('2fa_token: hunter2FAKE').text).toBe(`2fa_token: "${markFor('kv_secret')}"`);
    expect(redact('2fa_secret=abc123').text).toBe(`2fa_secret="${markFor('kv_secret')}"`);
  });

  it('still redacts terminated quoted values containing escaped quotes', () => {
    const { text } = redact('password = "a \\"b\\" c"');
    expect(text).toBe(`password = "${markFor('kv_secret')}"`);
  });

  it('key lookbehind: fused unquoted keys still match, fused quote does not', () => {
    // Unquoted compound matches as the longer key `xsecret` (contains
    // "secret") — identical to upstream.
    expect(redact('xsecret: somevalue').text).toBe(`xsecret: "${markFor('kv_secret')}"`);
    // A quoted key whose opening quote is glued to a word char is the
    // deliberate redacts-less divergence (upstream matched `"token": bar`).
    const input = 'foo"token": bar';
    expect(redact(input)).toEqual({ text: input, spans: [] });
  });

  it('does not redact JWTs glued to a preceding word char (jwt lookbehind)', () => {
    // Deliberate redacts-less divergence (header item 4); real JWTs follow
    // `=`, `:`, whitespace, quotes, or `Bearer `.
    const glued = 'secreteyJhbGciOi.eyJzdWIiOiIx.SflKxwRJSMeKKF2';
    expect(redact(glued).spans).toEqual([]);
    const normal = 'jwt=eyJhbGciOi.eyJzdWIiOiIx.SflKxwRJSMeKKF2';
    expect(redact(normal).spans.map((s) => s.id)).toContain('jwt');
  });

  it('does not let quoted values span newlines (upstream parity)', () => {
    const input = 'token: "abc\ndef"';
    expect(redact(input)).toEqual({ text: input, spans: [] });
  });

  it('leaves unterminated backslash-tailed quoted values untouched', () => {
    // Upstream's ambiguous quoted-value branch reinterpreted the trailing
    // backslash to close on the escaped quote (and was exponential getting
    // there); the disjoint rewrite deliberately does not match.
    const input = 'password: "abc\\"';
    expect(redact(input)).toEqual({ text: input, spans: [] });
  });
});

describe('url_credentials (np8.10)', () => {
  it('redacts only the password segment, keeping scheme/user/host visible', () => {
    const result = redact('bus: amqp://guest:FAKEFAKE@localhost:5672 up');
    expect(result.text).toBe(`bus: amqp://guest:${markFor('url_credentials')}@localhost:5672 up`);
    expect(result.spans.map((s) => s.id)).toEqual(['url_credentials']);
    expectSpansCoverMarks(result);
  });

  it('covers postgres and https credentialed URLs', () => {
    const pg = redact('postgres://app:s3cr3t!@db.internal:5432/prod');
    expect(pg.text).toBe(`postgres://app:${markFor('url_credentials')}@db.internal:5432/prod`);

    const https = redact('git clone https://ci-bot:tokenvalue123@example.com/org/repo.git');
    expect(https.text).toBe(
      `git clone https://ci-bot:${markFor('url_credentials')}@example.com/org/repo.git`,
    );
  });

  it('password segment ends at the FIRST @ (unencoded @ tails stay visible)', () => {
    // RFC userinfo requires percent-encoding `@`; this pins the documented
    // "first ':' after '//'+userinfo up to the first '@'" semantics.
    const { text } = redact('amqp://u:pa@ss@host');
    expect(text).toBe(`amqp://u:${markFor('url_credentials')}@ss@host`);
  });

  it('leaves credential-free URLs untouched (ports, paths, bare userinfo)', () => {
    for (const input of [
      'https://example.com/path',
      'https://example.com:8080/path', // port is not a password (@ never follows)
      'https://user@example.com', // userinfo without password has no ':'
      'https://example.com/a:b@c', // ':' only appears in the path (blocked by '/')
      'see a:b@c for details', // no scheme://
    ]) {
      expect(redact(input), input).toEqual({ text: input, spans: [] });
    }
  });

  it('loses the overlap watermark to kv_secret when the key itself is secret-named', () => {
    // kv starts earlier (at the key) and redacts the WHOLE value — strictly
    // more than the password-only substitution. Ordering comment in
    // patterns.ts documents this.
    const { text, spans } = redact('DB_PASSWORD=postgres://app:hunter2@db/prod');
    expect(text).toBe(`DB_PASSWORD="${markFor('kv_secret')}"`);
    expect(spans.map((s) => s.id)).toEqual(['kv_secret']);
  });
});

describe('catalogue upgrades (np8.11)', () => {
  it('redacts fine-grained github_pat_ tokens', () => {
    const FAKE = 'github_pat_11AAAAAAAAAAAAAAAAAAAA_' + 'B'.repeat(59);
    const { text, spans } = redact(`pat ${FAKE} end`);
    expect(text).toBe(`pat ${markFor('github')} end`);
    expect(spans.map((s) => s.id)).toEqual(['github']);
    expectSpansCoverMarks(redact(FAKE));
  });

  it('ignores short github_pat_ prose (below the 22-char run)', () => {
    const input = 'see github_pat_docs for details';
    expect(redact(input)).toEqual({ text: input, spans: [] });
  });

  it('kv_secret unquoted values run to whitespace/EOL — no partial-redaction leak', () => {
    // Upstream redacted only `p` and printed `@ssw0rd!FAKE` after the mark
    // (output looked redacted but leaked the tail — dangerous polarity).
    const result = redact('PASSWORD=p@ssw0rd!FAKE');
    expect(result.text).toBe(`PASSWORD="${markFor('kv_secret')}"`);
    expect(result.text).not.toContain('ssw0rd');
    expectSpansCoverMarks(result);

    const env = redact('export DB_PASSWORD=p@ss:w0rd/x\nHOST=db\n');
    expect(env.text).toBe(`export DB_PASSWORD="${markFor('kv_secret')}"\nHOST=db\n`);
  });

  it('sk- left boundary kills mid-word prose false positives', () => {
    // Previously: 'ri[REDACTED:openai]' / 'di[REDACTED:openai]'.
    const input = 'risk-assessment-methodology and disk-encryption-standards';
    expect(redact(input)).toEqual({ text: input, spans: [] });
    // Same boundary on the anthropic pattern.
    const glued = 'disk-ant-00000000000000000000';
    expect(redact(glued)).toEqual({ text: glued, spans: [] });
  });

  it('sk- keys after =, :, quotes, whitespace, and start-of-string still redact', () => {
    const KEY = 'sk-abcdefghijklmnopqrst1234';
    // Non-secret key names so the kv catch-all stays out of the way.
    expect(redact(KEY).text).toBe(markFor('openai'));
    expect(redact(`use ${KEY} here`).text).toBe(`use ${markFor('openai')} here`);
    expect(redact(`"${KEY}"`).text).toBe(`"${markFor('openai')}"`);
    expect(redact(`foo: ${KEY}`).spans.map((s) => s.id)).toContain('openai');
    expect(redact(`x=${KEY}`).spans.map((s) => s.id)).toContain('openai');
  });

  it('exempts keybinding entries under the exact key name "key"', () => {
    // The 3 FP shapes from the claude-rich keybindings fixture.
    for (const input of ['"key": "ctrl+j"', '"key": "ctrl+g ctrl+s"', '"key": "ctrl+t"']) {
      expect(redact(input), input).toEqual({ text: input, spans: [] });
      expect(containsSecrets(input), input).toBe(false);
    }
  });

  it('keeps the safe-direction bias around the "key" exemption', () => {
    // Long opaque value under bare `key` still redacts.
    expect(redact('"key": "aVeryLongSecretValue123"').text).toBe(
      `"key": "${markFor('kv_secret')}"`,
    );
    expect(redact('KEY=abcdef1234opaque').text).toBe(`KEY="${markFor('kv_secret')}"`);
    // Compound key names are exempt from the exemption.
    expect(redact('"api_key": "ctrl+k"').text).toBe(`"api_key": "${markFor('kv_secret')}"`);
    // A provider-shaped secret under bare `key` is long and not
    // chord-shaped, so the exemption never applies — kv still redacts it
    // (and provider patterns scan the value independently regardless).
    const withProvider = redact('"key": "sk-abcdefghijklmnopqrst1234"');
    expect(withProvider.spans.map((s) => s.id)).toEqual(['kv_secret']);
  });

  it('leaves the claude-rich keybindings fixture entirely untouched', () => {
    const raw = fixture('trees/claude-rich/.claude/keybindings.json');
    expect(containsSecrets(raw)).toBe(false);
    expect(redact(raw)).toEqual({ text: raw, spans: [] });
  });

  it('redacts Slack xox tokens', () => {
    for (const FAKE of ['xoxb-1234567890-FAKEFAKE1234', 'xoxp-9876543210-FAKEFAKE5678']) {
      const { text, spans } = redact(`slack ${FAKE}\n`);
      expect(text, FAKE).toBe(`slack ${markFor('slack')}\n`);
      expect(spans.map((s) => s.id), FAKE).toEqual(['slack']);
    }
    // Below the 10-char run bound: not a token.
    expect(redact('xoxb-short').spans).toEqual([]);
  });
});

describe('pathological input timing (regression guards, generous CI margins)', () => {
  const elapsed = (fn: () => void): number => {
    const t0 = performance.now();
    fn();
    return performance.now() - t0;
  };

  it('45-byte unterminated backslash run is not exponential', () => {
    // Upstream: ~800ms at 34 backslashes, x2.6 per +2 chars.
    const input = 'password: "' + '\\'.repeat(34);
    expect(elapsed(() => redact(input))).toBeLessThan(50);
    expect(elapsed(() => containsSecrets(input))).toBeLessThan(50);
  });

  it('32KB adversarial runs stay bounded', () => {
    const n = 32 * 1024;
    const cases = [
      'a'.repeat(n), // single unbroken token run
      'sk-'.repeat(n / 3), // sk- repeats
      'eyJ' + 'a'.repeat(n), // jwt prefix + long run
      'eyJ'.repeat(n / 3), // jwt prefix repeats
      'Bearer ' + 'a'.repeat(n), // bearer + long run
      'token:"' + 'a'.repeat(n), // unterminated quoted value
      // np8.10/np8.11 adversarial shapes:
      'a://u:' + ':'.repeat(n), // url_credentials: long ':' run, no '@'
      'a://u:p' + '@'.repeat(n), // url_credentials: '@' flood after one match
      '@'.repeat(n), // pure '@' flood (no scheme anywhere)
      'x://a:b@'.repeat(n / 8), // dense url_credentials matches
      'github_pat_'.repeat(Math.ceil(n / 11)), // github_pat_ prefix spam
      'xoxb-'.repeat(Math.ceil(n / 5)), // slack prefix spam
      'PASSWORD=' + '!'.repeat(n), // widened unquoted kv value long run
      'key: ' + 'a+'.repeat(n / 2), // chord-shape check on a huge bare-`key` value
    ];
    for (const input of cases) {
      expect(elapsed(() => redact(input)), input.slice(0, 16)).toBeLessThan(500);
      expect(elapsed(() => containsSecrets(input)), input.slice(0, 16)).toBeLessThan(500);
    }
  });
});

describe('containsSecrets', () => {
  it('is true for provider secrets and secret-named keys', () => {
    expect(containsSecrets('sk-ant-00000000000000000000')).toBe(true);
    expect(containsSecrets('ghp_' + 'a'.repeat(40))).toBe(true);
    expect(containsSecrets('token: mysupersecret123')).toBe(true);
  });

  it('is false for clean text, innocuous KV pairs, and empty input', () => {
    expect(containsSecrets('plain text')).toBe(false);
    expect(containsSecrets('{"description": "not a secret"}')).toBe(false);
    expect(containsSecrets('')).toBe(false);
  });
});

describe('claude-rich fixtures', () => {
  it('redacts the FAKE secrets in the settings.local.json tree fixture', () => {
    const raw = fixture('trees/claude-rich/.claude/settings.local.json');
    expect(containsSecrets(raw)).toBe(true);

    const result = redact(raw);
    expect(result.text).not.toContain('sk-FAKE');
    expect(result.text).not.toContain('ghp_FAKE');
    // Both env keys match the KV catch-all (which starts at the key, so it
    // wins the overlap against the provider patterns on the value).
    expect(result.text).toContain(`"OPENAI_API_KEY": "${markFor('kv_secret')}"`);
    expect(result.text).toContain(`"GITHUB_TOKEN": "${markFor('kv_secret')}"`);
    expectSpansCoverMarks(result);

    // np8.10: URL-embedded credentials are now covered — the amqp password
    // is redacted while scheme/user/host stay visible (ORBIT_BUS_URL still
    // does not match the kv secret-key regex, so url_credentials is the
    // pattern that fires). Previously pinned as an unredacted gap.
    expect(result.text).not.toContain('FAKEFAKE');
    expect(result.text).toContain(
      `"ORBIT_BUS_URL": "amqp://guest:${markFor('url_credentials')}@localhost:5672"`,
    );
  });

  it('redacts the same content embedded in the claude-rich manifest fixture', () => {
    const manifest = JSON.parse(fixture('manifests/claude-rich.json')) as {
      files: { path: string; content: string }[];
    };
    const settings = manifest.files.find((f) => f.path === '.claude/settings.local.json');
    expect(settings).toBeDefined();

    const result = redact(settings!.content);
    expect(result.text).not.toContain('sk-FAKE');
    expect(result.text).not.toContain('ghp_FAKE');
    // np8.10: the amqp URL password is the third redaction.
    expect(result.text).not.toContain('FAKEFAKE');
    expect(result.spans.length).toBeGreaterThanOrEqual(3);
    expectSpansCoverMarks(result);
  });
});
