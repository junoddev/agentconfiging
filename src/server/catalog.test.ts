/**
 * Adversarial in-process tests for the CATALOG install/remove routes (bead
 * agentconfig-0zm.4). Requests go straight into `app.fetch` (no socket), so the
 * install trust boundary — PATH GUARD on every untrusted entry file path,
 * CHECKSUM verification before any write, all-or-nothing, provenance recording,
 * and remove-only-recorded-files — is pinned at the application layer, together
 * with the INHERITED token + Origin/CSRF gates. A registry entry is treated as
 * hostile: its file paths and its file bytes are no more trusted than a user
 * write.
 */

import { createHash } from 'node:crypto';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { afterAll, beforeEach, describe, expect, it } from 'vitest';
import type { Hono } from 'hono';
import { createApp } from './app.js';
import { InstanceRegistry } from './registry.js';
import { RegistryClient, sha256Hex, type RegistryEntry, type ResolvedFile } from '../core/index.js';
import type { CatalogSource } from './catalog.js';
import { stampProvenance } from './catalog.js';
import { parseManifest } from './provenance.js';
import type { WriteScope } from './pathguard.js';

const PORT = 8811;
const HOST = `127.0.0.1:${PORT}`;
const ORIGIN = `http://127.0.0.1:${PORT}`;
const TOKEN = 'catalog-session-token-catalog-session-token-1';
const tokenHash = createHash('sha256').update(TOKEN).digest();
const AUTH = { authorization: `Bearer ${TOKEN}` };

const base = fs.mkdtempSync(path.join(os.tmpdir(), 'agentconfig-catalog-'));
const projectRoot = path.join(base, 'project');
const trashDir = path.join(base, 'trash');

afterAll(() => fs.rmSync(base, { recursive: true, force: true }));

function seedProject() {
  fs.rmSync(base, { recursive: true, force: true });
  fs.mkdirSync(projectRoot, { recursive: true });
}

/** A single-file entry with a correct sha256 over its content. */
function entry(overrides: Partial<RegistryEntry> & { filePath: string; content: string }): {
  entry: RegistryEntry;
} {
  const { filePath, content, ...rest } = overrides;
  return {
    entry: {
      kind: 'skill',
      name: 'demo',
      description: 'a demo entry',
      version: '1.0.0',
      source: 'agentconfig-seed',
      tags: [],
      files: [{ path: filePath, content, sha256: sha256Hex(content) }],
      ...rest,
    },
  };
}

/**
 * A stub CatalogSource under full test control. getCatalog returns the given
 * entries; fetchEntryFiles mirrors the real client — it re-hashes every file and
 * THROWS on a mismatch (so a checksum-failing file can be fired at the install
 * route), otherwise returns the verified bytes.
 */
function stubClient(entries: RegistryEntry[]): CatalogSource {
  return {
    getCatalog: () => Promise.resolve(entries),
    fetchEntryFiles: (e: RegistryEntry): Promise<ResolvedFile[]> => {
      const out: ResolvedFile[] = [];
      for (const f of e.files) {
        if (typeof f.content !== 'string' || sha256Hex(f.content) !== f.sha256) {
          return Promise.reject(new Error(`checksum mismatch for ${f.path}`));
        }
        out.push({ path: f.path, content: f.content });
      }
      return Promise.resolve(out);
    },
  };
}

function appWith(entries: RegistryEntry[]): Hono {
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
    catalogClient: stubClient(entries),
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

const SKILL = '.claude/skills/demo/SKILL.md';
const SKILL_BODY = '---\nname: demo\ndescription: A demo skill.\n---\n\n# Demo\n\nDo the thing.\n';

beforeEach(seedProject);

describe('GET /api/catalog', () => {
  it('returns metadata only (no file content) and the installed record', async () => {
    const { entry: e } = entry({ filePath: SKILL, content: SKILL_BODY });
    const app = appWith([e]);
    const res = await get(app, '/api/catalog');
    expect(res.status).toBe(200);
    const body = (await res.json()) as {
      entries: { key: string; files: string[]; content?: unknown }[];
      installed: unknown[];
    };
    expect(body.entries).toHaveLength(1);
    expect(body.entries[0]?.key).toBe('skill/demo');
    expect(body.entries[0]?.files).toEqual([SKILL]);
    // No file body is ever serialized in the catalog metadata.
    expect(JSON.stringify(body.entries[0])).not.toContain('Do the thing');
    expect(body.installed).toEqual([]);
  });

  it('requires a token (inherited /api gate)', async () => {
    const { entry: e } = entry({ filePath: SKILL, content: SKILL_BODY });
    const app = appWith([e]);
    const res = await Promise.resolve(
      app.fetch(new Request(`http://${HOST}/api/catalog`, { headers: { host: HOST } })),
    );
    expect(res.status).toBe(401);
  });
});

describe('POST /api/catalog/install — happy path', () => {
  it('dry-run returns a per-file diff + provenance, touches no disk', async () => {
    const { entry: e } = entry({ filePath: SKILL, content: SKILL_BODY });
    const app = appWith([e]);
    const res = await post(app, '/api/catalog/install', { entryKey: 'skill/demo', dryRun: true });
    expect(res.status).toBe(200);
    const body = (await res.json()) as {
      dryRun: boolean;
      files: { path: string; willCreate: boolean; diff: string }[];
      provenance: { path: string; note: string };
    };
    expect(body.dryRun).toBe(true);
    expect(body.files[0]?.path).toBe(SKILL);
    expect(body.files[0]?.willCreate).toBe(true);
    // The stamped provenance is visible in the approved diff.
    expect(body.files[0]?.diff).toContain('installed-by: agentconfig from agentconfig-seed@1.0.0');
    expect(body.provenance.path).toBe('.agentconfig/provenance.json');
    expect(fs.existsSync(path.join(projectRoot, SKILL))).toBe(false);
  });

  it('commit writes the stamped file + records provenance in the manifest', async () => {
    const { entry: e } = entry({ filePath: SKILL, content: SKILL_BODY });
    const app = appWith([e]);
    const res = await post(app, '/api/catalog/install', { entryKey: 'skill/demo', dryRun: false });
    expect(res.status).toBe(200);
    const written = fs.readFileSync(path.join(projectRoot, SKILL), 'utf-8');
    expect(written).toContain('installed-by: agentconfig from agentconfig-seed@1.0.0');
    expect(written).toContain('# Demo');
    // Manifest records the entry + exactly the file written.
    const manifestPath = path.join(projectRoot, '.agentconfig', 'provenance.json');
    const manifest = parseManifest(fs.readFileSync(manifestPath, 'utf-8'));
    expect(manifest.installs['skill/demo']?.files).toEqual([SKILL]);
    expect(manifest.installs['skill/demo']?.source).toBe('agentconfig-seed');
    // The installed record now surfaces in the catalog listing.
    const listed = (await (await get(app, '/api/catalog')).json()) as { installed: unknown[] };
    expect(listed.installed).toHaveLength(1);
  });
});

describe('POST /api/catalog/install — attacks', () => {
  it('refuses a traversing entry file path (refused, nothing written)', async () => {
    const { entry: e } = entry({ filePath: '../../etc/evil.md', content: SKILL_BODY });
    const app = appWith([e]);
    const res = await post(app, '/api/catalog/install', { entryKey: 'skill/demo', dryRun: false });
    // A `..` segment is refused at input discipline (400); either way nothing lands.
    expect([400, 403]).toContain(res.status);
    expect(fs.existsSync(path.join(base, 'etc', 'evil.md'))).toBe(false);
    expect(fs.existsSync(path.join(projectRoot, '.agentconfig'))).toBe(false);
  });

  it('refuses an absolute out-of-scope entry file path (403)', async () => {
    const outside = path.join(base, 'outside.md');
    const { entry: e } = entry({ filePath: outside, content: SKILL_BODY });
    const app = appWith([e]);
    const res = await post(app, '/api/catalog/install', { entryKey: 'skill/demo', dryRun: false });
    expect(res.status).toBe(403);
    expect(fs.existsSync(outside)).toBe(false);
  });

  it('refuses an in-scope but non-config entry file path (403)', async () => {
    const { entry: e } = entry({ filePath: 'random/evil.sh', content: SKILL_BODY });
    const app = appWith([e]);
    const res = await post(app, '/api/catalog/install', { entryKey: 'skill/demo', dryRun: false });
    expect(res.status).toBe(403);
    expect(fs.existsSync(path.join(projectRoot, 'random'))).toBe(false);
  });

  it('refuses a checksum-mismatched file (422, nothing written)', async () => {
    const { entry: e } = entry({ filePath: SKILL, content: SKILL_BODY });
    // Corrupt the content so it no longer matches the declared sha256.
    e.files[0]!.content = SKILL_BODY + '\n; injected';
    const app = appWith([e]);
    const res = await post(app, '/api/catalog/install', { entryKey: 'skill/demo', dryRun: false });
    expect(res.status).toBe(422);
    expect(fs.existsSync(path.join(projectRoot, SKILL))).toBe(false);
  });

  it('is all-or-nothing: one bad file in a multi-file entry aborts the whole install', async () => {
    const good = '.claude/skills/demo/SKILL.md';
    const { entry: e } = entry({ filePath: good, content: SKILL_BODY });
    e.files.push({
      path: '../../escape.md',
      content: 'x',
      sha256: sha256Hex('x'),
    });
    const app = appWith([e]);
    const res = await post(app, '/api/catalog/install', { entryKey: 'skill/demo', dryRun: false });
    expect([400, 403]).toContain(res.status);
    // The good file must NOT have landed — no partial install.
    expect(fs.existsSync(path.join(projectRoot, good))).toBe(false);
  });

  it('refuses an entry file that targets the reserved provenance manifest (403)', async () => {
    // A hostile entry writing `.agentconfig/provenance.json` directly could forge
    // an install record. Its checksum is correct (sha of its own bytes), so the
    // path guard — not the checksum — must be what refuses it.
    const poison = JSON.stringify({ version: 1, installs: {} });
    const { entry: e } = entry({ filePath: '.agentconfig/provenance.json', content: poison });
    const app = appWith([e]);
    const res = await post(app, '/api/catalog/install', { entryKey: 'skill/demo', dryRun: false });
    expect(res.status).toBe(403);
    expect(fs.existsSync(path.join(projectRoot, '.agentconfig', 'provenance.json'))).toBe(false);
  });

  it('refuses an entry file anywhere under the reserved .agentconfig/ namespace (403)', async () => {
    const { entry: e } = entry({ filePath: '.agentconfig/notes.json', content: '{}' });
    const app = appWith([e]);
    const res = await post(app, '/api/catalog/install', { entryKey: 'skill/demo', dryRun: false });
    expect(res.status).toBe(403);
    expect(fs.existsSync(path.join(projectRoot, '.agentconfig'))).toBe(false);
  });

  // Incident agentconfig-0zm.4: reproduce the complete reserved-namespace
  // poisoning chain, then prove the victim file remains on disk.
  it('agentconfig-0zm.4 reserved .agentconfig poisoning chain is refused end-to-end', async () => {
    // The victim's own, never-installed file.
    const victimRel = '.claude/skills/victim/SKILL.md';
    fs.mkdirSync(path.join(projectRoot, '.claude', 'skills', 'victim'), { recursive: true });
    fs.writeFileSync(path.join(projectRoot, victimRel), 'the victim file');

    // Attacker entry: write a manifest claiming `skill/evil` installed the victim.
    const forged = JSON.stringify({
      version: 1,
      installs: {
        'skill/evil': {
          key: 'skill/evil',
          kind: 'skill',
          name: 'evil',
          source: 'attacker',
          version: '1.0.0',
          installedAt: new Date().toISOString(),
          files: [victimRel],
        },
      },
    });
    const { entry: e } = entry({
      kind: 'skill',
      name: 'evil',
      filePath: '.agentconfig/provenance.json',
      content: forged,
    });
    const app = appWith([e]);

    // 1) Installing the poison entry is refused; the manifest is never written.
    const install = await post(app, '/api/catalog/install', {
      entryKey: 'skill/evil',
      dryRun: false,
    });
    expect(install.status).toBe(403);
    expect(fs.existsSync(path.join(projectRoot, '.agentconfig', 'provenance.json'))).toBe(false);

    // 2) With no forged record, removing `skill/evil` is a 404 and the victim's
    //    file survives untouched — remove never trashes a non-installed file.
    const remove = await post(app, '/api/catalog/remove', {
      entryKey: 'skill/evil',
      dryRun: false,
    });
    expect(remove.status).toBe(404);
    expect(fs.readFileSync(path.join(projectRoot, victimRel), 'utf-8')).toBe('the victim file');
  });

  it('404s an unknown entry key and an unknown instance', async () => {
    const { entry: e } = entry({ filePath: SKILL, content: SKILL_BODY });
    const app = appWith([e]);
    expect((await post(app, '/api/catalog/install', { entryKey: 'skill/nope' })).status).toBe(404);
    expect(
      (await post(app, '/api/catalog/install', { entryKey: 'skill/demo', instance: 'ghost' }))
        .status,
    ).toBe(404);
  });

  it('rejects a state-changing install with no Origin and no same-origin proof (CSRF)', async () => {
    const { entry: e } = entry({ filePath: SKILL, content: SKILL_BODY });
    const app = appWith([e]);
    const res = await Promise.resolve(
      app.fetch(
        new Request(`http://${HOST}/api/catalog/install`, {
          method: 'POST',
          headers: { host: HOST, 'content-type': 'application/json', ...AUTH },
          body: JSON.stringify({ entryKey: 'skill/demo' }),
        }),
      ),
    );
    expect(res.status).toBe(403);
  });
});

describe('POST /api/catalog/remove', () => {
  async function install(app: Hono): Promise<void> {
    await post(app, '/api/catalog/install', { entryKey: 'skill/demo', dryRun: false });
  }

  it('dry-run lists the recorded files to trash without touching disk', async () => {
    const { entry: e } = entry({ filePath: SKILL, content: SKILL_BODY });
    const app = appWith([e]);
    await install(app);
    const res = await post(app, '/api/catalog/remove', { entryKey: 'skill/demo', dryRun: true });
    expect(res.status).toBe(200);
    const body = (await res.json()) as { files: { path: string; willTrash?: boolean }[] };
    expect(body.files[0]?.path).toBe(SKILL);
    expect(body.files[0]?.willTrash).toBe(true);
    // Still on disk after a dry-run.
    expect(fs.existsSync(path.join(projectRoot, SKILL))).toBe(true);
  });

  it('commit trashes the installed file (recoverable) and clears the manifest record', async () => {
    const { entry: e } = entry({ filePath: SKILL, content: SKILL_BODY });
    const app = appWith([e]);
    await install(app);
    const res = await post(app, '/api/catalog/remove', { entryKey: 'skill/demo', dryRun: false });
    expect(res.status).toBe(200);
    const body = (await res.json()) as { files: { trashedTo?: string }[] };
    expect(fs.existsSync(path.join(projectRoot, SKILL))).toBe(false);
    // Recoverable: the file exists at its trash destination.
    expect(fs.existsSync(body.files[0]!.trashedTo!)).toBe(true);
    // Manifest record is gone.
    const manifestPath = path.join(projectRoot, '.agentconfig', 'provenance.json');
    const manifest = parseManifest(fs.readFileSync(manifestPath, 'utf-8'));
    expect(manifest.installs['skill/demo']).toBeUndefined();
  });

  it('404s (never 500s) remove of a prototype-inherited entryKey', async () => {
    const { entry: e } = entry({ filePath: SKILL, content: SKILL_BODY });
    const app = appWith([e]);
    for (const key of ['__proto__', 'constructor', 'toString', 'hasOwnProperty']) {
      const res = await post(app, '/api/catalog/remove', { entryKey: key, dryRun: false });
      expect(res.status).toBe(404);
    }
  });

  it('404s remove of an entry that was never installed (never trashes a user file)', async () => {
    const { entry: e } = entry({ filePath: SKILL, content: SKILL_BODY });
    const app = appWith([e]);
    // A user-authored file at the same path — must survive a bogus remove.
    fs.mkdirSync(path.join(projectRoot, '.claude', 'skills', 'demo'), { recursive: true });
    fs.writeFileSync(path.join(projectRoot, SKILL), 'my own file');
    const res = await post(app, '/api/catalog/remove', { entryKey: 'skill/demo', dryRun: false });
    expect(res.status).toBe(404);
    expect(fs.readFileSync(path.join(projectRoot, SKILL), 'utf-8')).toBe('my own file');
  });
});

describe('live seed catalog (real RegistryClient, offline seed floor)', () => {
  // A RegistryClient whose fetch always rejects + a throwaway cache dir → it
  // resolves the in-package SEED with zero network, and fetchEntryFiles verifies
  // the REAL seed content against its REAL sha256 before install.
  function seedApp(): Hono {
    const client = new RegistryClient({
      fetch: () => Promise.reject(new Error('offline')),
      cacheDir: path.join(base, 'regcache'),
    });
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
      catalogClient: client,
    });
  }

  it('lists seed entries, installs one with verified content, then removes it', async () => {
    const app = seedApp();
    const list = (await (await get(app, '/api/catalog')).json()) as {
      entries: { key: string }[];
    };
    expect(list.entries.length).toBeGreaterThan(10);
    const key = 'skill/git-commit-helper';
    const seedFile = '.claude/skills/git-commit-helper/SKILL.md';
    expect(list.entries.some((e) => e.key === key)).toBe(true);

    const install = await post(app, '/api/catalog/install', { entryKey: key, dryRun: false });
    expect(install.status).toBe(200);
    const written = fs.readFileSync(path.join(projectRoot, seedFile), 'utf-8');
    expect(written).toContain('installed-by: agentconfig from');

    const remove = await post(app, '/api/catalog/remove', { entryKey: key, dryRun: false });
    expect(remove.status).toBe(200);
    expect(fs.existsSync(path.join(projectRoot, seedFile))).toBe(false);
  });
});

describe('stampProvenance', () => {
  it('injects the provenance key into an existing frontmatter block', () => {
    const out = stampProvenance('---\nname: x\n---\nbody\n', 'src', '2.0.0');
    expect(out).toContain('installed-by: agentconfig from src@2.0.0');
    expect(out).toContain('name: x');
    expect(out.indexOf('installed-by')).toBeLessThan(out.indexOf('body'));
  });

  it('leaves a file without frontmatter unchanged (provenance lives in the manifest)', () => {
    const json = '{\n  "mcpServers": {}\n}\n';
    expect(stampProvenance(json, 'src', '1.0.0')).toBe(json);
  });
});
