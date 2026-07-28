/**
 * Adversarial in-process tests for POST /api/hooks/edit (bead agentconfig-71h.9).
 * Requests go straight into `app.fetch` (no socket), mirroring write.test.ts:
 * the path guard, precondition (409) discipline, redacted-diff wire property,
 * and the INHERITED token + Origin/CSRF gates are all pinned at the application
 * layer. Every input is treated as hostile.
 *
 * The CORE security property: a REDACTED-when-served settings.json (secrets in
 * `env`) is edited STRUCTURALLY on the server — the on-disk secret bytes
 * survive the edit untouched, and the wire (the diff preview) never carries
 * them.
 */

import { createHash } from 'node:crypto';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { afterAll, beforeEach, describe, expect, it } from 'vitest';
import { createApp } from './app.js';
import { InstanceRegistry } from './registry.js';
import type { WriteScope } from './pathguard.js';

const PORT = 8791;
const HOST = `127.0.0.1:${PORT}`;
const ORIGIN = `http://127.0.0.1:${PORT}`;
const TOKEN = 'hooks-edit-session-token-hooks-edit-token-1';
const tokenHash = createHash('sha256').update(TOKEN).digest();
const AUTH = { authorization: `Bearer ${TOKEN}` };

// Layout:
//   base/
//     project/.claude/settings.json   (project scope root; hooks fixture)
//     home/.claude/settings.json      (global scope root; SECRET env + hooks)
//     escape/target.md                (out of scope, symlink dest)
//     trash/
const base = fs.mkdtempSync(path.join(os.tmpdir(), 'agentconfig-hooks-edit-'));
const projectRoot = path.join(base, 'project');
const globalRoot = path.join(base, 'home', '.claude');
const trashDir = path.join(base, 'trash');
const escapeDir = path.join(base, 'escape');
const projectSettings = path.join(projectRoot, '.claude', 'settings.json');
const globalSettings = path.join(globalRoot, 'settings.json');

// A FAKE secret planted in the global fixture's env — the bytes that must
// survive a structured edit and never appear on the wire.
const SECRET = 'sk-FAKE00000000000000000000000000000000FAKE';

/** The project fixture: hooks alongside unrelated keys that must round-trip. */
const PROJECT_FIXTURE = {
  model: 'opus',
  hooks: {
    PostToolUse: [
      { matcher: 'Bash', hooks: [{ type: 'command', command: 'echo post' }] },
      {
        hooks: [
          { type: 'command', command: 'echo second' },
          { type: 'command', command: 'echo third' },
        ],
      },
    ],
    Stop: [{ hooks: [{ type: 'command', command: 'echo stop' }] }],
  },
};

/** The global fixture: the secret env sits ADJACENT to the hooks block so the
 *  removal diff's context lines include it — proving redaction fires. */
const GLOBAL_FIXTURE = {
  env: { OPENAI_API_KEY: SECRET },
  hooks: {
    Stop: [{ hooks: [{ type: 'command', command: 'echo bye' }] }],
  },
};

const serialize = (obj: unknown) => JSON.stringify(obj, null, 2) + '\n';

afterAll(() => fs.rmSync(base, { recursive: true, force: true }));

let scopes: WriteScope[];

function build() {
  fs.rmSync(base, { recursive: true, force: true });
  fs.mkdirSync(path.join(projectRoot, '.claude'), { recursive: true });
  fs.mkdirSync(globalRoot, { recursive: true });
  fs.mkdirSync(escapeDir, { recursive: true });
  fs.writeFileSync(projectSettings, serialize(PROJECT_FIXTURE));
  fs.writeFileSync(globalSettings, serialize(GLOBAL_FIXTURE));
  fs.writeFileSync(path.join(base, 'outside-existing.json'), '{"secret":"SECRET-OUTSIDE"}');
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

function post(body: unknown, headers: Record<string, string> = {}): Promise<Response> {
  return Promise.resolve(
    app().fetch(
      new Request(`http://${HOST}/api/hooks/edit`, {
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

const readProject = () => fs.readFileSync(projectSettings, 'utf-8');
const parseProject = () => JSON.parse(readProject()) as Record<string, unknown>;

beforeEach(build);

describe('POST /api/hooks/edit — dry-run (default)', () => {
  it('remove: returns redacted diff + WriteResponse preview shape, no disk touch', async () => {
    const before = readProject();
    const mtimeBefore = fs.statSync(projectSettings).mtimeMs;
    await new Promise((r) => setTimeout(r, 5));
    const res = await post({
      path: '.claude/settings.json',
      op: 'remove',
      address: { event: 'Stop', groupIndex: 0, hookIndex: 0 },
      expected: { command: 'echo stop' },
      dryRun: true,
    });
    expect(res.status).toBe(200);
    const json = (await res.json()) as Record<string, unknown>;
    expect(json['willModify']).toBe(true);
    expect(json['willCreate']).toBe(false);
    expect(json['pathScope']).toBe('project');
    expect(json['committed']).toBeUndefined();
    expect(String(json['diff'])).toContain('"command": "echo stop"');
    expect(readProject()).toBe(before);
    expect(fs.statSync(projectSettings).mtimeMs).toBe(mtimeBefore);
  });

  it('add: diff previews the new hook, no disk touch; dryRun defaults to true', async () => {
    const before = readProject();
    const res = await post({
      path: '.claude/settings.json',
      op: 'add',
      event: 'PreToolUse',
      matcher: 'Bash',
      hook: { type: 'command', command: 'echo guard' },
      // dryRun omitted → preview
    });
    expect(res.status).toBe(200);
    const json = (await res.json()) as Record<string, unknown>;
    expect(json['willModify']).toBe(true);
    expect(String(json['diff'])).toContain('"command": "echo guard"');
    expect(readProject()).toBe(before);
  });
});

describe('POST /api/hooks/edit — add commit', () => {
  it('appends a new matcher group under an existing event; other keys round-trip', async () => {
    const res = await post({
      path: '.claude/settings.json',
      op: 'add',
      event: 'Stop',
      hook: { type: 'command', command: 'echo added' },
      dryRun: false,
    });
    expect(res.status).toBe(200);
    const json = (await res.json()) as Record<string, unknown>;
    expect(json).toMatchObject({
      committed: true,
      created: false,
      modified: true,
      path: '.claude/settings.json',
      pathScope: 'project',
    });
    const root = parseProject();
    expect(root['model']).toBe('opus');
    const stop = (root['hooks'] as Record<string, unknown>)['Stop'] as unknown[];
    expect(stop).toHaveLength(2);
    expect(stop[1]).toEqual({ hooks: [{ type: 'command', command: 'echo added' }] });
    // Documented normalization: 2-space indent + trailing newline.
    expect(readProject()).toBe(serialize(root));
  });

  it('creates the event array when the event is absent (client addHookToSettings parity)', async () => {
    const res = await post({
      path: '.claude/settings.json',
      op: 'add',
      event: 'PreToolUse',
      matcher: 'Bash',
      hook: { type: 'command', command: 'echo guard' },
      dryRun: false,
    });
    expect(res.status).toBe(200);
    const hooks = parseProject()['hooks'] as Record<string, unknown>;
    expect(hooks['PreToolUse']).toEqual([
      { matcher: 'Bash', hooks: [{ type: 'command', command: 'echo guard' }] },
    ]);
  });

  it('creates the hooks block when absent; blank matcher is omitted', async () => {
    fs.writeFileSync(projectSettings, serialize({ model: 'opus' }));
    const res = await post({
      path: '.claude/settings.json',
      op: 'add',
      event: 'Stop',
      matcher: '   ',
      hook: { type: 'command', command: 'echo new' },
      dryRun: false,
    });
    expect(res.status).toBe(200);
    expect(parseProject()).toEqual({
      model: 'opus',
      hooks: { Stop: [{ hooks: [{ type: 'command', command: 'echo new' }] }] },
    });
  });
});

describe('prototype-named events are data, never prototype mutation', () => {
  it("add with event '__proto__' writes an OWN key; Object.prototype untouched", async () => {
    const res = await post({
      path: '.claude/settings.json',
      op: 'add',
      event: '__proto__',
      hook: { type: 'command', command: 'echo proto' },
      dryRun: false,
    });
    expect(res.status).toBe(200);
    const hooks = parseProject()['hooks'] as Record<string, unknown>;
    // JSON.parse creates own keys for "__proto__"; the endpoint must have used
    // define-semantics too, or the group would have vanished into the setter.
    const desc = Object.getOwnPropertyDescriptor(hooks, '__proto__');
    expect(desc?.value).toEqual([{ hooks: [{ type: 'command', command: 'echo proto' }] }]);
    expect({} as Record<string, unknown>).not.toHaveProperty('hooks');
    expect(Object.prototype).not.toHaveProperty('hooks');
  });

  it("hook.type other than 'command' → 400, file untouched", async () => {
    const before = readProject();
    const res = await post({
      path: '.claude/settings.json',
      op: 'add',
      event: 'Stop',
      hook: { type: 'script', command: 'echo x' },
      dryRun: false,
    });
    expect(res.status).toBe(400);
    expect(readProject()).toBe(before);
  });
});

describe('POST /api/hooks/edit — remove commit', () => {
  it('removes one hook, keeps its group sibling (indexes match parseHooksBlock)', async () => {
    const res = await post({
      path: '.claude/settings.json',
      op: 'remove',
      address: { event: 'PostToolUse', groupIndex: 1, hookIndex: 0 },
      expected: { command: 'echo second' },
      dryRun: false,
    });
    expect(res.status).toBe(200);
    const post_ = (parseProject()['hooks'] as Record<string, unknown>)['PostToolUse'] as unknown[];
    expect(post_).toHaveLength(2);
    expect(post_[1]).toEqual({ hooks: [{ type: 'command', command: 'echo third' }] });
  });

  it('removes at hookIndex > 0: splices the ADDRESSED hook, not index 0', async () => {
    const res = await post({
      path: '.claude/settings.json',
      op: 'remove',
      address: { event: 'PostToolUse', groupIndex: 1, hookIndex: 1 },
      expected: { command: 'echo third' },
      dryRun: false,
    });
    expect(res.status).toBe(200);
    const post_ = (parseProject()['hooks'] as Record<string, unknown>)['PostToolUse'] as unknown[];
    expect(post_).toHaveLength(2);
    // Group 0 untouched; group 1 keeps its FIRST hook — a bug that verifies the
    // precondition at hookIndex but splices at 0 fails here.
    expect(post_[0]).toEqual({
      matcher: 'Bash',
      hooks: [{ type: 'command', command: 'echo post' }],
    });
    expect(post_[1]).toEqual({ hooks: [{ type: 'command', command: 'echo second' }] });
  });

  it('prunes an emptied group, event, and hooks block (removeHookFromSettings parity)', async () => {
    fs.writeFileSync(
      projectSettings,
      serialize({ hooks: { Stop: [{ hooks: [{ type: 'command', command: 'echo stop' }] }] } }),
    );
    const res = await post({
      path: '.claude/settings.json',
      op: 'remove',
      address: { event: 'Stop', groupIndex: 0, hookIndex: 0 },
      expected: { command: 'echo stop' },
      dryRun: false,
    });
    expect(res.status).toBe(200);
    expect(readProject()).toBe('{}\n');
  });
});

describe('SECURITY: redacted global settings.json edited without secret loss', () => {
  it('remove via the GLOBAL path: on-disk secret bytes intact, hook gone, wire diff redacted', async () => {
    const res = await post({
      path: globalSettings, // absolute path into the global scope
      op: 'remove',
      address: { event: 'Stop', groupIndex: 0, hookIndex: 0 },
      expected: { command: 'echo bye' },
      dryRun: false,
    });
    expect(res.status).toBe(200);
    const json = (await res.json()) as Record<string, unknown>;
    expect(json['committed']).toBe(true);
    expect(json['pathScope']).toBe('global'); // drives the client's ALL-AGENTS warning

    // The whole point: the REAL secret bytes survived the structured edit.
    const onDisk = fs.readFileSync(globalSettings, 'utf-8');
    expect(onDisk).toContain(SECRET);
    const root = JSON.parse(onDisk) as Record<string, unknown>;
    expect(root['env']).toEqual({ OPENAI_API_KEY: SECRET });
    expect(root['hooks']).toBeUndefined(); // sole hook removed → block pruned

    // And the WIRE never carried them: the diff's context lines covered the env
    // block (it sits right above the removed hooks), yet the secret is absent —
    // replaced by a visible [REDACTED:*] mark.
    const wire = JSON.stringify(json);
    expect(wire).not.toContain(SECRET);
    expect(wire).not.toContain('FAKE');
    expect(String(json['diff'])).toContain('[REDACTED:');
    expect(String(json['diff'])).toContain('"command": "echo bye"'); // real preview
  });

  it('dry-run on the global file: redacted diff, secret + file untouched', async () => {
    const before = fs.readFileSync(globalSettings, 'utf-8');
    const res = await post({
      path: globalSettings,
      op: 'remove',
      address: { event: 'Stop', groupIndex: 0, hookIndex: 0 },
      expected: { command: 'echo bye' },
      dryRun: true,
    });
    expect(res.status).toBe(200);
    expect(JSON.stringify(await res.json())).not.toContain(SECRET);
    expect(fs.readFileSync(globalSettings, 'utf-8')).toBe(before);
  });
});

describe('preconditions → 409, file untouched', () => {
  const expect409Untouched = async (body: Record<string, unknown>) => {
    const before = readProject();
    const res = await post({ path: '.claude/settings.json', dryRun: false, ...body });
    expect(res.status).toBe(409);
    expect((await res.json()) as Record<string, unknown>).toEqual({ error: 'conflict' });
    expect(readProject()).toBe(before);
  };

  it('remove: expected.command mismatch (stale client view)', () =>
    expect409Untouched({
      op: 'remove',
      address: { event: 'Stop', groupIndex: 0, hookIndex: 0 },
      expected: { command: 'echo SOMETHING-ELSE' },
    }));

  it('remove: address gone — unknown event / group OOR / hook OOR', async () => {
    await expect409Untouched({
      op: 'remove',
      address: { event: 'Nope', groupIndex: 0, hookIndex: 0 },
      expected: { command: 'echo stop' },
    });
    await expect409Untouched({
      op: 'remove',
      address: { event: 'Stop', groupIndex: 5, hookIndex: 0 },
      expected: { command: 'echo stop' },
    });
    await expect409Untouched({
      op: 'remove',
      address: { event: 'Stop', groupIndex: 0, hookIndex: 5 },
      expected: { command: 'echo stop' },
    });
  });

  it('remove: no hooks block at all', async () => {
    fs.writeFileSync(projectSettings, serialize({ model: 'opus' }));
    await expect409Untouched({
      op: 'remove',
      address: { event: 'Stop', groupIndex: 0, hookIndex: 0 },
      expected: { command: 'echo stop' },
    });
  });

  it('malformed JSON file → 409 clean error, file untouched (add AND remove)', async () => {
    fs.writeFileSync(projectSettings, '{ not json !!!');
    await expect409Untouched({
      op: 'remove',
      address: { event: 'Stop', groupIndex: 0, hookIndex: 0 },
      expected: { command: 'echo stop' },
    });
    await expect409Untouched({
      op: 'add',
      event: 'Stop',
      hook: { type: 'command', command: 'echo x' },
    });
  });

  it('add refuses to clobber a non-object hooks block / non-array event entry', async () => {
    fs.writeFileSync(projectSettings, serialize({ hooks: 'weird' }));
    await expect409Untouched({
      op: 'add',
      event: 'Stop',
      hook: { type: 'command', command: 'echo x' },
    });
    fs.writeFileSync(projectSettings, serialize({ hooks: { Stop: 'weird' } }));
    await expect409Untouched({
      op: 'add',
      event: 'Stop',
      hook: { type: 'command', command: 'echo x' },
    });
  });

  it('file whose root is not an object (JSON array) → 409', async () => {
    fs.writeFileSync(projectSettings, '[]\n');
    await expect409Untouched({
      op: 'add',
      event: 'Stop',
      hook: { type: 'command', command: 'echo x' },
    });
  });
});

describe('path guard + auth discipline', () => {
  const removeBody = {
    op: 'remove',
    address: { event: 'Stop', groupIndex: 0, hookIndex: 0 },
    expected: { command: 'echo stop' },
    dryRun: false,
  };

  it('out-of-scope EXISTING vs NONEXISTENT → byte-identical 403, nothing touched', async () => {
    const existing = await post({ ...removeBody, path: path.join(base, 'outside-existing.json') });
    const missing = await post({ ...removeBody, path: path.join(base, 'outside-missing.json') });
    expect(existing.status).toBe(403);
    expect(missing.status).toBe(403);
    expect(await existing.text()).toBe(await missing.text());
    expect(fs.readFileSync(path.join(base, 'outside-existing.json'), 'utf-8')).toBe(
      '{"secret":"SECRET-OUTSIDE"}',
    );
  });

  it('in-scope but NON-config path → 403; traversal → 400/403', async () => {
    expect((await post({ ...removeBody, path: 'random/evil.json' })).status).toBe(403);
    expect([400, 403]).toContain(
      (await post({ ...removeBody, path: '../outside-existing.json' })).status,
    );
  });

  it('symlinked leaf pointing OUT of scope → 403, dest untouched', async () => {
    const link = path.join(projectRoot, '.claude', 'link.json');
    fs.symlinkSync(path.join(escapeDir, 'target.md'), link);
    scopes = [{ root: fs.realpathSync(projectRoot), kind: 'project' }];
    const res = await post({ ...removeBody, path: '.claude/link.json' });
    expect(res.status).toBe(403);
    expect(fs.readFileSync(path.join(escapeDir, 'target.md'), 'utf-8')).toBe('SECRET-VIA-SYMLINK');
  });

  it('in-scope absent file → 404 (a structured edit needs a file to edit)', async () => {
    expect((await post({ ...removeBody, path: '.claude/nope.json' })).status).toBe(404);
  });

  it('oversized on-disk file → 413 (read-cap parity with GET /api/file)', async () => {
    fs.writeFileSync(projectSettings, '{"pad":"' + 'x'.repeat(64 * 1024) + '"}');
    expect((await post({ ...removeBody, path: '.claude/settings.json' })).status).toBe(413);
  });

  it('NO token → 401; no Origin / Sec-Fetch-Site → 403 (CSRF); nothing written', async () => {
    const noToken = await app().fetch(
      new Request(`http://${HOST}/api/hooks/edit`, {
        method: 'POST',
        headers: { host: HOST, origin: ORIGIN, 'content-type': 'application/json' },
        body: JSON.stringify({ ...removeBody, path: '.claude/settings.json' }),
      }),
    );
    expect(noToken.status).toBe(401);

    const noOrigin = await app().fetch(
      new Request(`http://${HOST}/api/hooks/edit`, {
        method: 'POST',
        headers: { host: HOST, 'content-type': 'application/json', ...AUTH },
        body: JSON.stringify({ ...removeBody, path: '.claude/settings.json' }),
      }),
    );
    expect(noOrigin.status).toBe(403);
    expect(readProject()).toBe(serialize(PROJECT_FIXTURE));
  });
});

describe('malformed request bodies → 400', () => {
  it('non-JSON body → 400', async () => {
    const res = await app().fetch(
      new Request(`http://${HOST}/api/hooks/edit`, {
        method: 'POST',
        headers: { host: HOST, origin: ORIGIN, 'content-type': 'application/json', ...AUTH },
        body: 'not json{',
      }),
    );
    expect(res.status).toBe(400);
  });

  it.each([
    { path: '.claude/settings.json' }, // no op
    { path: '.claude/settings.json', op: 'rename' }, // unknown op
    { path: '.claude/settings.json', op: 'add', event: 'Stop' }, // no hook
    {
      path: '.claude/settings.json',
      op: 'add',
      event: '  ',
      hook: { type: 'command', command: 'x' },
    },
    {
      path: '.claude/settings.json',
      op: 'add',
      event: 'Stop',
      hook: { type: 'command', command: '  ' },
    },
    {
      path: '.claude/settings.json',
      op: 'add',
      event: 'Stop',
      matcher: 5,
      hook: { type: 'command', command: 'x' },
    },
    { path: '.claude/settings.json', op: 'remove', expected: { command: 'x' } }, // no address
    {
      path: '.claude/settings.json',
      op: 'remove',
      address: { event: 'Stop', groupIndex: 0, hookIndex: 0 },
    }, // no expected
    {
      path: '.claude/settings.json',
      op: 'remove',
      address: { event: 'Stop', groupIndex: 0.5, hookIndex: 0 },
      expected: { command: 'x' },
    },
    {
      path: '.claude/settings.json',
      op: 'remove',
      address: { event: 'Stop', groupIndex: -1, hookIndex: 0 },
      expected: { command: 'x' },
    },
    {
      path: '.claude/settings.json',
      op: 'remove',
      address: { event: 'Stop', groupIndex: 0, hookIndex: 0 },
      expected: { command: 7 },
    },
    {
      path: '.claude/settings.json',
      op: 'remove',
      address: { event: 'Stop', groupIndex: 0, hookIndex: 0 },
      expected: { command: 'x' },
      dryRun: 'yes',
    },
  ])('rejects bad body %#, file untouched', async (body) => {
    const before = readProject();
    expect((await post(body)).status).toBe(400);
    expect(readProject()).toBe(before);
  });
});
