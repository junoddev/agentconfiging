/**
 * Adversarial in-process tests for the WRITE API (bead agentconfig-gxo.3).
 * Requests go straight into `app.fetch` (no socket), so the path guard, trash,
 * dry-run discipline, and the INHERITED token + Origin/CSRF gates are all
 * pinned at the application layer. Every input is treated as hostile.
 */

import { createHash } from 'node:crypto';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { afterAll, beforeEach, describe, expect, it } from 'vitest';
import { createApp } from './app.js';
import { InstanceRegistry } from './registry.js';
import type { WriteScope } from './pathguard.js';

const PORT = 8788;
const HOST = `127.0.0.1:${PORT}`;
const ORIGIN = `http://127.0.0.1:${PORT}`;
const TOKEN = 'write-session-token-write-session-token-wr1';
const tokenHash = createHash('sha256').update(TOKEN).digest();
const AUTH = { authorization: `Bearer ${TOKEN}` };

// Layout:
//   base/
//     project/                 (project scope root)
//       CLAUDE.md
//       .claude/               (known dir)
//     home/.claude/            (global scope root)
//     outside-existing.md      (out of scope, exists)
//     escape/target.md         (out of scope, symlink dest)
//     trash/                   (trash dir)
const base = fs.mkdtempSync(path.join(os.tmpdir(), 'agentconfig-write-'));
const projectRoot = path.join(base, 'project');
const globalRoot = path.join(base, 'home', '.claude');
const trashDir = path.join(base, 'trash');
const escapeDir = path.join(base, 'escape');

afterAll(() => fs.rmSync(base, { recursive: true, force: true }));

let scopes: WriteScope[];

function build() {
  fs.rmSync(base, { recursive: true, force: true });
  fs.mkdirSync(path.join(projectRoot, '.claude'), { recursive: true });
  fs.mkdirSync(globalRoot, { recursive: true });
  fs.mkdirSync(escapeDir, { recursive: true });
  fs.writeFileSync(path.join(projectRoot, 'CLAUDE.md'), 'line one\nline two\nline three\n');
  fs.writeFileSync(path.join(base, 'outside-existing.md'), 'SECRET-OUTSIDE');
  fs.writeFileSync(path.join(escapeDir, 'target.md'), 'SECRET-VIA-SYMLINK');
  scopes = [
    { root: fs.realpathSync(projectRoot), kind: 'project' },
    { root: fs.realpathSync(globalRoot), kind: 'global' },
  ];
}

function app() {
  const registry = new InstanceRegistry('1.0.0');
  registry.seed(projectRoot, { makeDefault: true });
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

function post(pathname: string, body: unknown, headers: Record<string, string> = {}): Promise<Response> {
  return Promise.resolve(
    app().fetch(
      new Request(`http://${HOST}${pathname}`, {
        method: 'POST',
        headers: { host: HOST, origin: ORIGIN, 'content-type': 'application/json', ...AUTH, ...headers },
        body: JSON.stringify(body),
      }),
    ),
  );
}

function get(pathname: string, headers: Record<string, string> = {}): Promise<Response> {
  return Promise.resolve(
    app().fetch(new Request(`http://${HOST}${pathname}`, { headers: { host: HOST, ...AUTH, ...headers } })),
  );
}

beforeEach(build);

describe('POST /api/write — dry-run', () => {
  it('create: diff against empty, willCreate, no disk touch', async () => {
    const target = path.join(projectRoot, '.claude', 'settings.json');
    const res = await post('/api/write', { path: '.claude/settings.json', content: '{"a":1}\n', dryRun: true });
    expect(res.status).toBe(200);
    const json = (await res.json()) as Record<string, unknown>;
    expect(json['willCreate']).toBe(true);
    expect(json['willModify']).toBe(false);
    expect(json['pathScope']).toBe('project');
    expect(String(json['diff'])).toContain('--- /dev/null');
    expect(String(json['diff'])).toContain('+{"a":1}');
    expect(fs.existsSync(target)).toBe(false); // dry-run created nothing
  });

  it('modify: diff against current, mtime + content unchanged after dry-run', async () => {
    const target = path.join(projectRoot, 'CLAUDE.md');
    const before = fs.readFileSync(target, 'utf-8');
    const mtimeBefore = fs.statSync(target).mtimeMs;
    await new Promise((r) => setTimeout(r, 5));
    const res = await post('/api/write', {
      path: 'CLAUDE.md',
      content: 'line one\nCHANGED\nline three\n',
      dryRun: true,
    });
    expect(res.status).toBe(200);
    const json = (await res.json()) as Record<string, unknown>;
    expect(json['willModify']).toBe(true);
    expect(String(json['diff'])).toContain('-line two');
    expect(String(json['diff'])).toContain('+CHANGED');
    expect(fs.readFileSync(target, 'utf-8')).toBe(before);
    expect(fs.statSync(target).mtimeMs).toBe(mtimeBefore);
  });
});

describe('POST /api/write — commit', () => {
  it('create: writes the file, reports created', async () => {
    const res = await post('/api/write', { path: '.claude/settings.json', content: '{"x":true}\n', dryRun: false });
    expect(res.status).toBe(200);
    const json = (await res.json()) as Record<string, unknown>;
    expect(json['committed']).toBe(true);
    expect(json['created']).toBe(true);
    expect(fs.readFileSync(path.join(projectRoot, '.claude', 'settings.json'), 'utf-8')).toBe('{"x":true}\n');
  });

  it('modify: overwrites existing content', async () => {
    const res = await post('/api/write', { path: 'CLAUDE.md', content: 'new body\n', dryRun: false });
    expect(res.status).toBe(200);
    expect((await res.json()) as Record<string, unknown>).toMatchObject({ committed: true, modified: true });
    expect(fs.readFileSync(path.join(projectRoot, 'CLAUDE.md'), 'utf-8')).toBe('new body\n');
  });

  it('writes into a global (agent home) scope', async () => {
    const res = await post('/api/write', { path: path.join(globalRoot, 'CLAUDE.md'), content: 'hi\n', dryRun: false });
    expect(res.status).toBe(200);
    expect((await res.json()) as Record<string, unknown>).toMatchObject({ pathScope: 'global' });
    expect(fs.readFileSync(path.join(globalRoot, 'CLAUDE.md'), 'utf-8')).toBe('hi\n');
  });
});

describe('path guard — traversal + scope', () => {
  it.each([
    '../../etc/passwd',
    '../outside-existing.md',
    '.claude/../../outside-existing.md',
    '%2e%2e/outside-existing.md',
    '%2e%2e%2f%2e%2e%2fetc%2fpasswd',
    '.claude\\..\\..\\outside-existing.md',
    'CLAUDE.md\0.png',
    'foo/ ',
    'foo/bar.',
  ])('rejects hostile path %s (400/403), never writes', async (p) => {
    const res = await post('/api/write', { path: p, content: 'x', dryRun: false });
    expect([400, 403]).toContain(res.status);
    expect(fs.readFileSync(path.join(base, 'outside-existing.md'), 'utf-8')).toBe('SECRET-OUTSIDE');
  });

  it('absolute out-of-scope path → 403', async () => {
    const res = await post('/api/write', { path: path.join(base, 'outside-existing.md'), content: 'x', dryRun: false });
    expect(res.status).toBe(403);
    expect(fs.readFileSync(path.join(base, 'outside-existing.md'), 'utf-8')).toBe('SECRET-OUTSIDE');
  });

  it('in-scope but NON-config path (random/evil.sh at root) → 403', async () => {
    // .sh is an allowed ext but only under a KNOWN_DIRS subtree; at the project
    // root it is not a known config path shape.
    const res = await post('/api/write', { path: 'random/evil.sh', content: 'rm -rf /', dryRun: false });
    expect(res.status).toBe(403);
    expect(fs.existsSync(path.join(projectRoot, 'random'))).toBe(false);
  });

  it('in-scope known dir but disallowed extension → 403', async () => {
    const res = await post('/api/write', { path: '.claude/evil.exe', content: 'x', dryRun: false });
    expect(res.status).toBe(403);
  });

  it('symlink in scope pointing OUT of scope is not followed → 403, dest untouched', async () => {
    const link = path.join(projectRoot, '.claude', 'link.md');
    fs.symlinkSync(path.join(escapeDir, 'target.md'), link);
    scopes = [{ root: fs.realpathSync(projectRoot), kind: 'project' }];
    const res = await post('/api/write', { path: '.claude/link.md', content: 'PWNED', dryRun: false });
    expect(res.status).toBe(403);
    expect(fs.readFileSync(path.join(escapeDir, 'target.md'), 'utf-8')).toBe('SECRET-VIA-SYMLINK');
  });

  it('symlinked DIR in scope pointing OUT is not traversed → 403', async () => {
    const link = path.join(projectRoot, '.claude', 'escaped');
    fs.symlinkSync(escapeDir, link);
    scopes = [{ root: fs.realpathSync(projectRoot), kind: 'project' }];
    const res = await post('/api/write', { path: '.claude/escaped/new.md', content: 'x', dryRun: false });
    expect(res.status).toBe(403);
    expect(fs.existsSync(path.join(escapeDir, 'new.md'))).toBe(false);
  });
});

// Regression suite for the CRITICAL dangling-symlink write-through escape
// (realpathSync throws ENOENT on a dangling link, so the leaf/segment was
// misfiled as a to-be-created tail and followed out of scope on write).
describe('path guard — DANGLING symlink escapes (write-through)', () => {
  it('(a) dangling symlink LEAF → out-of-scope path: 403, target NOT created', async () => {
    fs.mkdirSync(path.join(base, 'evil-outside'), { recursive: true });
    const target = path.join(base, 'evil-outside', 'PWNED.md');
    fs.symlinkSync(target, path.join(projectRoot, '.claude', 'pwn.md'));
    const res = await post('/api/write', { path: '.claude/pwn.md', content: 'PWNED', dryRun: false });
    expect(res.status).toBe(403);
    expect(fs.existsSync(target)).toBe(false);
  });

  it('(b) .git/hooks/pre-commit RCE via symlink → 403, hook NOT created', async () => {
    fs.mkdirSync(path.join(projectRoot, '.git', 'hooks'), { recursive: true });
    const hook = path.join(projectRoot, '.git', 'hooks', 'pre-commit');
    fs.symlinkSync(hook, path.join(projectRoot, '.claude', 'hook.md'));
    const res = await post('/api/write', {
      path: '.claude/hook.md',
      content: '#!/bin/sh\ntouch /tmp/pwned\n',
      dryRun: false,
    });
    expect(res.status).toBe(403);
    expect(fs.existsSync(hook)).toBe(false);
  });

  it('(c) intermediate dangling symlink → 403 (not 500)', async () => {
    fs.symlinkSync(path.join(base, 'nonexistent-dir'), path.join(projectRoot, '.claude', 'dlink'));
    const res = await post('/api/write', { path: '.claude/dlink/x.md', content: 'x', dryRun: false });
    expect(res.status).toBe(403);
    expect(fs.existsSync(path.join(base, 'nonexistent-dir'))).toBe(false);
  });

  it('(d) symlinked delete target → 403, out-of-scope file untouched', async () => {
    fs.symlinkSync(path.join(base, 'outside-existing.md'), path.join(projectRoot, '.claude', 'dellink.md'));
    const res = await post('/api/delete', { path: '.claude/dellink.md', dryRun: false });
    expect(res.status).toBe(403);
    expect(fs.readFileSync(path.join(base, 'outside-existing.md'), 'utf-8')).toBe('SECRET-OUTSIDE');
  });

  it('(d2) DANGLING symlinked delete target → 403', async () => {
    fs.symlinkSync(path.join(base, 'evil-outside', 'gone.md'), path.join(projectRoot, '.claude', 'delgone.md'));
    const res = await post('/api/delete', { path: '.claude/delgone.md', dryRun: false });
    expect(res.status).toBe(403);
  });

  it('(e) symlinked read (GET /api/file) → 403, no content leaked', async () => {
    fs.symlinkSync(path.join(base, 'outside-existing.md'), path.join(projectRoot, '.claude', 'readlink.md'));
    const res = await get('/api/file?path=.claude/readlink.md');
    expect(res.status).toBe(403);
    expect(await res.text()).not.toContain('SECRET-OUTSIDE');
  });

  it('(e2) DANGLING symlinked read → 403', async () => {
    fs.symlinkSync(path.join(base, 'evil-outside', 'nope.md'), path.join(projectRoot, '.claude', 'readgone.md'));
    const res = await get('/api/file?path=.claude/readgone.md');
    expect(res.status).toBe(403);
  });
});

describe('no-existence oracle', () => {
  it('out-of-scope EXISTING vs NONEXISTENT → byte-identical 403', async () => {
    const existing = await post('/api/write', { path: path.join(base, 'outside-existing.md'), content: 'x', dryRun: true });
    const missing = await post('/api/write', { path: path.join(base, 'outside-missing.md'), content: 'x', dryRun: true });
    expect(existing.status).toBe(403);
    expect(missing.status).toBe(403);
    expect(await existing.text()).toBe(await missing.text());
  });
});

describe('POST /api/delete — trash, never unlink', () => {
  it('dry-run: reports without moving', async () => {
    const res = await post('/api/delete', { path: 'CLAUDE.md', dryRun: true });
    expect(res.status).toBe(200);
    expect((await res.json()) as Record<string, unknown>).toMatchObject({ willTrash: true, path: 'CLAUDE.md' });
    expect(fs.existsSync(path.join(projectRoot, 'CLAUDE.md'))).toBe(true);
  });

  it('commit: original gone, file recoverable from trash', async () => {
    const original = path.join(projectRoot, 'CLAUDE.md');
    const originalContent = fs.readFileSync(original, 'utf-8');
    const res = await post('/api/delete', { path: 'CLAUDE.md', dryRun: false });
    expect(res.status).toBe(200);
    const json = (await res.json()) as Record<string, unknown>;
    expect(json['trashed']).toBe(true);
    expect(fs.existsSync(original)).toBe(false); // NOT hard-deleted from view
    const trashedTo = String(json['trashedTo']);
    expect(fs.existsSync(trashedTo)).toBe(true); // recoverable
    expect(fs.readFileSync(trashedTo, 'utf-8')).toBe(originalContent);
    // METADATA.json records the original absolute path.
    const meta = JSON.parse(fs.readFileSync(path.join(path.dirname(trashedTo), 'METADATA.json'), 'utf-8'));
    expect(meta.originalPath).toBe(fs.realpathSync(projectRoot) + path.sep + 'CLAUDE.md');
  });

  it('delete of in-scope but absent file → 404', async () => {
    const res = await post('/api/delete', { path: '.claude/nope.json', dryRun: false });
    expect(res.status).toBe(404);
  });

  it('delete out-of-scope → 403 (no unlink)', async () => {
    const res = await post('/api/delete', { path: path.join(base, 'outside-existing.md'), dryRun: false });
    expect(res.status).toBe(403);
    expect(fs.existsSync(path.join(base, 'outside-existing.md'))).toBe(true);
  });
});

describe('GET /api/file', () => {
  it('returns raw content for an in-scope known path', async () => {
    const res = await get('/api/file?path=CLAUDE.md');
    expect(res.status).toBe(200);
    const json = (await res.json()) as Record<string, unknown>;
    expect(json['content']).toBe('line one\nline two\nline three\n');
    expect(json['pathScope']).toBe('project');
  });

  it('out-of-scope read → 403; in-scope absent → 404; traversal → 400/403', async () => {
    expect((await get(`/api/file?path=${encodeURIComponent(path.join(base, 'outside-existing.md'))}`)).status).toBe(403);
    expect((await get('/api/file?path=.claude/nope.json')).status).toBe(404);
    expect([400, 403]).toContain((await get('/api/file?path=..%2f..%2fetc%2fpasswd')).status);
  });
});

describe('inherited gates (token + CSRF) still cover write routes', () => {
  it('POST /api/write with NO token → 401', async () => {
    const res = await app().fetch(
      new Request(`http://${HOST}/api/write`, {
        method: 'POST',
        headers: { host: HOST, origin: ORIGIN, 'content-type': 'application/json' },
        body: JSON.stringify({ path: 'CLAUDE.md', content: 'x' }),
      }),
    );
    expect(res.status).toBe(401);
  });

  it('POST /api/write with NO Origin / Sec-Fetch-Site → 403 (CSRF), no write', async () => {
    const res = await app().fetch(
      new Request(`http://${HOST}/api/write`, {
        method: 'POST',
        headers: { host: HOST, 'content-type': 'application/json', ...AUTH },
        body: JSON.stringify({ path: 'CLAUDE.md', content: 'PWNED' }),
      }),
    );
    expect(res.status).toBe(403);
    expect(fs.readFileSync(path.join(projectRoot, 'CLAUDE.md'), 'utf-8')).not.toBe('PWNED');
  });

  it('POST /api/delete with cross-site Origin → 403', async () => {
    const res = await app().fetch(
      new Request(`http://${HOST}/api/delete`, {
        method: 'POST',
        headers: { host: HOST, origin: 'http://evil.com', 'content-type': 'application/json', ...AUTH },
        body: JSON.stringify({ path: 'CLAUDE.md' }),
      }),
    );
    expect(res.status).toBe(403);
    expect(fs.existsSync(path.join(projectRoot, 'CLAUDE.md'))).toBe(true);
  });
});

describe('malformed request bodies', () => {
  it('non-JSON body → 400', async () => {
    const res = await app().fetch(
      new Request(`http://${HOST}/api/write`, {
        method: 'POST',
        headers: { host: HOST, origin: ORIGIN, 'content-type': 'application/json', ...AUTH },
        body: 'not json{',
      }),
    );
    expect(res.status).toBe(400);
  });

  it('missing/non-string content → 400', async () => {
    expect((await post('/api/write', { path: 'CLAUDE.md' })).status).toBe(400);
    expect((await post('/api/write', { path: 'CLAUDE.md', content: 42 })).status).toBe(400);
  });

  it('oversized content → 400', async () => {
    const huge = 'x'.repeat(64 * 1024 + 1);
    expect((await post('/api/write', { path: 'CLAUDE.md', content: huge, dryRun: true })).status).toBe(400);
  });
});
