/**
 * Adversarial in-process tests for POST /api/apply-fix (bead agentconfig-wmc.1).
 * Requests go straight into `app.fetch` (no socket), so the path guard, the
 * dry-run/commit discipline, the fix-recompute, and the INHERITED token +
 * Origin/CSRF gates are all pinned at the application layer. Fix edit paths are
 * treated as hostile — an analyzer-emitted edit is no more trusted than a user
 * write and must clear the identical guard.
 */

import { createHash } from 'node:crypto';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { afterAll, beforeEach, describe, expect, it } from 'vitest';
import type { Hono } from 'hono';
import { createApp } from './app.js';
import { InstanceRegistry, type StoreFactory } from './registry.js';
import type { ReportStore } from './store.js';
import { resolveWriteTarget, type WriteScope } from './pathguard.js';

const PORT = 8799;
const HOST = `127.0.0.1:${PORT}`;
const ORIGIN = `http://127.0.0.1:${PORT}`;
const TOKEN = 'apply-fix-session-token-apply-fix-session-1';
const tokenHash = createHash('sha256').update(TOKEN).digest();
const AUTH = { authorization: `Bearer ${TOKEN}` };

// Layout: base/project is the launch/default instance root. It carries a real
// settings-local-committed finding (settings.local.json present, no .gitignore),
// whose machine fix creates `.gitignore` with the ignore line.
const base = fs.mkdtempSync(path.join(os.tmpdir(), 'agentconfig-applyfix-'));
const projectRoot = path.join(base, 'project');
const trashDir = path.join(base, 'trash');

afterAll(() => fs.rmSync(base, { recursive: true, force: true }));

function seedProject() {
  fs.rmSync(base, { recursive: true, force: true });
  fs.mkdirSync(path.join(projectRoot, '.claude'), { recursive: true });
  fs.writeFileSync(
    path.join(projectRoot, '.claude', 'settings.local.json'),
    JSON.stringify({ env: { OPT_IN: true } }, null, 2),
  );
}

/** One app over the REAL engine store (production StoreFactory) — the fix is
 *  recomputed from an actual scan of `projectRoot`. Built once per test so the
 *  store + its cache persist across the dry-run → commit → re-run sequence. */
function realApp(): Hono {
  const registry = new InstanceRegistry('1.0.0');
  registry.seed(projectRoot, { makeDefault: true });
  const scopes: WriteScope[] = [{ root: fs.realpathSync(projectRoot), kind: 'project' }];
  return createApp({
    tokenHash,
    port: () => PORT,
    distDir: path.join(base, 'nodist'),
    registry,
    version: '1.0.0',
    scopes,
    trashDir,
  });
}

/** One app whose store is a STUB returning a caller-chosen hostile fix, so the
 *  guard can be attacked with edit paths a real analyzer would never emit. */
function stubApp(fix: unknown): Hono {
  const makeStore: StoreFactory = () =>
    ({
      get: () => {
        throw new Error('report not used in this test');
      },
      fixFor: (_scope: string, id: string) => (id === 'evil' ? fix : undefined),
      invalidate: () => {},
    }) as unknown as ReportStore;
  const registry = new InstanceRegistry('1.0.0', makeStore);
  registry.seed(projectRoot, { makeDefault: true });
  const scopes: WriteScope[] = [{ root: fs.realpathSync(projectRoot), kind: 'project' }];
  return createApp({
    tokenHash,
    port: () => PORT,
    distDir: path.join(base, 'nodist'),
    registry,
    version: '1.0.0',
    scopes,
    trashDir,
  });
}

function post(
  app: Hono,
  pathname: string,
  body: unknown,
  headers: Record<string, string> = {},
): Promise<Response> {
  return Promise.resolve(
    app.fetch(
      new Request(`http://${HOST}${pathname}`, {
        method: 'POST',
        headers: {
          host: HOST,
          origin: ORIGIN,
          'content-type': 'application/json',
          ...AUTH,
          ...headers,
        },
        body: JSON.stringify(body),
      }),
    ),
  );
}

function get(app: Hono, pathname: string): Promise<Response> {
  return Promise.resolve(
    app.fetch(new Request(`http://${HOST}${pathname}`, { headers: { host: HOST, ...AUTH } })),
  );
}

const gitignore = path.join(projectRoot, '.gitignore');

beforeEach(seedProject);

describe('POST /api/apply-fix — dry-run', () => {
  it('returns the fix diff and touches nothing on disk', async () => {
    const app = realApp();
    const res = await post(app, '/api/apply-fix', {
      findingId: 'settings-local-committed',
      dryRun: true,
    });
    expect(res.status).toBe(200);
    const json = (await res.json()) as Record<string, unknown>;
    expect(json['dryRun']).toBe(true);
    expect(json['fixKind']).toBe('create-file');
    const edits = json['edits'] as Array<Record<string, unknown>>;
    expect(edits).toHaveLength(1);
    expect(edits[0]!['path']).toBe('.gitignore');
    expect(edits[0]!['willCreate']).toBe(true);
    expect(String(edits[0]!['diff'])).toContain('--- /dev/null');
    expect(String(edits[0]!['diff'])).toContain('+.claude/settings.local.json');
    // Dry-run created NOTHING.
    expect(fs.existsSync(gitignore)).toBe(false);
  });

  it('defaults to dry-run when dryRun is omitted (no write)', async () => {
    const res = await post(realApp(), '/api/apply-fix', { findingId: 'settings-local-committed' });
    expect(res.status).toBe(200);
    expect(((await res.json()) as Record<string, unknown>)['dryRun']).toBe(true);
    expect(fs.existsSync(gitignore)).toBe(false);
  });
});

describe('POST /api/apply-fix — commit', () => {
  it('applies the settings-local fix through the guarded write path', async () => {
    const commit = await post(realApp(), '/api/apply-fix', {
      findingId: 'settings-local-committed',
      dryRun: false,
    });
    expect(commit.status).toBe(200);
    const json = (await commit.json()) as Record<string, unknown>;
    expect(json['committed']).toBe(true);
    expect((json['edits'] as Array<Record<string, unknown>>)[0]!['committed']).toBe(true);
    // The fix landed: .gitignore now exists and lists the local settings file.
    expect(fs.readFileSync(gitignore, 'utf-8')).toBe('.claude/settings.local.json\n');
  });

  it('commit is re-runnable: the fix resolves the finding on the next report', async () => {
    // Uses missing-project-guide (fix creates CLAUDE.md, which the engine DOES
    // collect) so the resolution is observable. NB: the settings-local fix
    // targets `.gitignore`, which the scanner never collects (src/core), so THAT
    // finding cannot self-resolve on re-scan — an engine limitation, not an
    // apply-fix bug; the fix still writes correctly (previous test).
    const app = realApp();
    const guide = path.join(projectRoot, 'CLAUDE.md');
    expect(fs.existsSync(guide)).toBe(false);

    const commit = await post(app, '/api/apply-fix', {
      findingId: 'missing-project-guide-claude-md',
      dryRun: false,
    });
    expect(commit.status).toBe(200);
    expect(((await commit.json()) as Record<string, unknown>)['committed']).toBe(true);
    expect(fs.existsSync(guide)).toBe(true);

    // Re-runnable: a fresh report no longer carries the finding (apply-fix
    // invalidated the store cache → the re-scan sees the new CLAUDE.md).
    const report = await get(app, '/api/report');
    const body = (await report.json()) as { findings: Array<{ id: string }> };
    expect(body.findings.some((f) => f.id === 'missing-project-guide-claude-md')).toBe(false);

    // And a second apply-fix for the now-resolved finding is a 404 (no fix).
    const again = await post(app, '/api/apply-fix', {
      findingId: 'missing-project-guide-claude-md',
      dryRun: false,
    });
    expect(again.status).toBe(404);
  });
});

describe('POST /api/apply-fix — the fix edit path clears the SAME guard', () => {
  it('an absolute out-of-scope edit path refuses the whole fix (403), no write', async () => {
    const outside = path.join(base, 'outside.rc');
    const app = stubApp({ kind: 'replace-file', edits: [{ path: outside, patch: 'PWNED' }] });
    const res = await post(app, '/api/apply-fix', { findingId: 'evil', dryRun: false });
    expect(res.status).toBe(403);
    expect(fs.existsSync(outside)).toBe(false);
  });

  it('an in-scope but NON-config edit path is refused (403), no write', async () => {
    const app = stubApp({ kind: 'create-file', edits: [{ path: 'random/evil.sh', patch: 'x' }] });
    const res = await post(app, '/api/apply-fix', { findingId: 'evil', dryRun: false });
    expect(res.status).toBe(403);
    expect(fs.existsSync(path.join(projectRoot, 'random'))).toBe(false);
  });

  it('a traversal edit path (../..) is refused (400/403), no escape', async () => {
    const app = stubApp({
      kind: 'replace-file',
      edits: [{ path: '../../etc/agentconfig-pwn', patch: 'x' }],
    });
    const res = await post(app, '/api/apply-fix', { findingId: 'evil', dryRun: false });
    expect([400, 403]).toContain(res.status);
    expect(fs.existsSync(path.join(base, '..', '..', 'etc', 'agentconfig-pwn'))).toBe(false);
  });

  it('a multi-edit fix with one bad edit writes NEITHER (all-or-nothing pre-check)', async () => {
    const good = path.join(projectRoot, '.gitignore');
    const app = stubApp({
      kind: 'create-file',
      edits: [
        { path: '.gitignore', patch: 'ok\n' },
        { path: path.join(base, 'outside.rc'), patch: 'PWNED' },
      ],
    });
    const res = await post(app, '/api/apply-fix', { findingId: 'evil', dryRun: false });
    expect(res.status).toBe(403);
    // The GOOD edit must not have landed either — the guard failure on the bad
    // edit refuses the whole fix before any write.
    expect(fs.existsSync(good)).toBe(false);
    expect(fs.existsSync(path.join(base, 'outside.rc'))).toBe(false);
  });
});

describe('POST /api/apply-fix — Fix.kind precondition (no clobber)', () => {
  it('a create-file fix whose target already EXISTS → 409, existing file untouched', async () => {
    // The real-world .gitignore trap: the scanner never collects .gitignore, so
    // the analyzer emits a create-file fix even when one is present on disk —
    // applying it would overwrite real content. Honor the create-file
    // precondition and refuse.
    const existing = path.join(projectRoot, '.gitignore');
    fs.writeFileSync(existing, 'node_modules/\ndist/\n');
    const app = stubApp({ kind: 'create-file', edits: [{ path: '.gitignore', patch: 'wiped\n' }] });
    const res = await post(app, '/api/apply-fix', { findingId: 'evil', dryRun: false });
    expect(res.status).toBe(409);
    expect(fs.readFileSync(existing, 'utf-8')).toBe('node_modules/\ndist/\n');
  });

  it('the 409 fires on dry-run too (no destructive diff shown)', async () => {
    fs.writeFileSync(path.join(projectRoot, '.gitignore'), 'keep\n');
    const app = stubApp({ kind: 'create-file', edits: [{ path: '.gitignore', patch: 'x\n' }] });
    const res = await post(app, '/api/apply-fix', { findingId: 'evil', dryRun: true });
    expect(res.status).toBe(409);
  });

  it('a replace-file fix whose target is ABSENT → 409, nothing created', async () => {
    const app = stubApp({
      kind: 'replace-file',
      edits: [{ path: 'CLAUDE.md', patch: '# hi\n' }],
    });
    const res = await post(app, '/api/apply-fix', { findingId: 'evil', dryRun: false });
    expect(res.status).toBe(409);
    expect(fs.existsSync(path.join(projectRoot, 'CLAUDE.md'))).toBe(false);
  });
});

describe('POST /api/apply-fix — validation + no oracle', () => {
  it('unknown findingId → 404', async () => {
    const res = await post(realApp(), '/api/apply-fix', { findingId: 'no-such-finding' });
    expect(res.status).toBe(404);
  });

  it('unknown instance → 404', async () => {
    const res = await post(realApp(), '/api/apply-fix', {
      instance: 'deadbeefdeadbeef',
      findingId: 'settings-local-committed',
    });
    expect(res.status).toBe(404);
  });

  it('missing / non-string findingId → 400', async () => {
    expect((await post(realApp(), '/api/apply-fix', {})).status).toBe(400);
    expect((await post(realApp(), '/api/apply-fix', { findingId: 42 })).status).toBe(400);
    expect((await post(realApp(), '/api/apply-fix', { findingId: '' })).status).toBe(400);
  });

  it('non-JSON body → 400', async () => {
    const res = await realApp().fetch(
      new Request(`http://${HOST}/api/apply-fix`, {
        method: 'POST',
        headers: { host: HOST, origin: ORIGIN, 'content-type': 'application/json', ...AUTH },
        body: 'not json{',
      }),
    );
    expect(res.status).toBe(400);
  });
});

describe('pathguard fix-target allowlist extension (.gitignore only)', () => {
  it('permits `.gitignore` at the project root, refuses other dotfiles', () => {
    seedProject();
    const scopes: WriteScope[] = [{ root: fs.realpathSync(projectRoot), kind: 'project' }];
    // `.gitignore` (a fix target with no allowed extension) is now writable.
    expect(resolveWriteTarget('.gitignore', scopes).ok).toBe(true);
    // The extension is narrow: it does NOT open other extensionless dotfiles.
    expect(resolveWriteTarget('.npmrc', scopes).ok).toBe(false);
    expect(resolveWriteTarget('.env', scopes).ok).toBe(false);
    // And it is root-only — a nested `.gitignore` is not a known config path.
    expect(resolveWriteTarget('sub/.gitignore', scopes).ok).toBe(false);
  });
});

describe('POST /api/apply-fix — inherited token + CSRF gates', () => {
  it('no token → 401, no write', async () => {
    const res = await realApp().fetch(
      new Request(`http://${HOST}/api/apply-fix`, {
        method: 'POST',
        headers: { host: HOST, origin: ORIGIN, 'content-type': 'application/json' },
        body: JSON.stringify({ findingId: 'settings-local-committed', dryRun: false }),
      }),
    );
    expect(res.status).toBe(401);
    expect(fs.existsSync(gitignore)).toBe(false);
  });

  it('no Origin / Sec-Fetch-Site → 403 (CSRF), no write', async () => {
    const res = await realApp().fetch(
      new Request(`http://${HOST}/api/apply-fix`, {
        method: 'POST',
        headers: { host: HOST, 'content-type': 'application/json', ...AUTH },
        body: JSON.stringify({ findingId: 'settings-local-committed', dryRun: false }),
      }),
    );
    expect(res.status).toBe(403);
    expect(fs.existsSync(gitignore)).toBe(false);
  });

  it('cross-site Origin → 403', async () => {
    const res = await realApp().fetch(
      new Request(`http://${HOST}/api/apply-fix`, {
        method: 'POST',
        headers: {
          host: HOST,
          origin: 'http://evil.com',
          'content-type': 'application/json',
          ...AUTH,
        },
        body: JSON.stringify({ findingId: 'settings-local-committed', dryRun: false }),
      }),
    );
    expect(res.status).toBe(403);
  });
});
