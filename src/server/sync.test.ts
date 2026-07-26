/**
 * Adversarial in-process tests for POST /api/sync (bead agentconfig-wmc.10).
 * Requests go straight into `app.fetch` (no socket), pinning the path guard, the
 * dry-run/commit discipline, the source read, the long-tail allowlist extension,
 * and the INHERITED token + Origin/CSRF gates. A sync TARGET is treated as
 * untrusted: it must clear the same guard as a user write, and a target that
 * cannot be written safely is reported, never written.
 */

import { createHash } from 'node:crypto';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { afterAll, beforeEach, describe, expect, it } from 'vitest';
import type { Hono } from 'hono';
import { createApp } from './app.js';
import { InstanceRegistry } from './registry.js';
import type { WriteScope } from './pathguard.js';

const PORT = 8797;
const HOST = `127.0.0.1:${PORT}`;
const ORIGIN = `http://127.0.0.1:${PORT}`;
const TOKEN = 'sync-session-token-sync-session-token-sync-1';
const tokenHash = createHash('sha256').update(TOKEN).digest();
const AUTH = { authorization: `Bearer ${TOKEN}` };

const base = fs.mkdtempSync(path.join(os.tmpdir(), 'agentconfig-sync-'));
const projectRoot = path.join(base, 'project');
const trashDir = path.join(base, 'trash');

const CLAUDE_MD = '# Project rules\n\n- Run `npm test` before committing.\n- Keep PRs small.\n';

afterAll(() => fs.rmSync(base, { recursive: true, force: true }));

function seedProject() {
  fs.rmSync(base, { recursive: true, force: true });
  fs.mkdirSync(projectRoot, { recursive: true });
  fs.writeFileSync(path.join(projectRoot, 'CLAUDE.md'), CLAUDE_MD);
}

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

interface SyncRow {
  runtimeIds: string[];
  path: string;
  status: string;
  diff: string;
  committed?: boolean;
  lossy: boolean;
}
interface SyncBody {
  dryRun?: true;
  committed?: boolean;
  source: string;
  targets: SyncRow[];
}

beforeEach(seedProject);

describe('POST /api/sync — dry-run', () => {
  it('plans targets from CLAUDE.md without touching disk', async () => {
    const app = realApp();
    const res = await post(app, '/api/sync', {
      sourcePath: 'CLAUDE.md',
      targets: ['codex', 'cursor'],
      dryRun: true,
    });
    expect(res.status).toBe(200);
    const body = (await res.json()) as SyncBody;
    expect(body.dryRun).toBe(true);
    const agents = body.targets.find((t) => t.path === 'AGENTS.md');
    const cursor = body.targets.find((t) => t.path === '.cursor/rules/project.mdc');
    expect(agents?.status).toBe('new');
    expect(cursor?.status).toBe('new');
    expect(cursor?.lossy).toBe(true);
    expect(agents?.diff).toContain('Run `npm test`');
    // Nothing was written.
    expect(fs.existsSync(path.join(projectRoot, 'AGENTS.md'))).toBe(false);
  });

  it('reports in-sync when the target already matches', async () => {
    const app = realApp();
    // First commit AGENTS.md, then dry-run again → in-sync.
    await post(app, '/api/sync', { sourcePath: 'CLAUDE.md', targets: ['codex'], dryRun: false });
    const res = await post(app, '/api/sync', {
      sourcePath: 'CLAUDE.md',
      targets: ['codex'],
      dryRun: true,
    });
    const body = (await res.json()) as SyncBody;
    expect(body.targets[0]!.status).toBe('in-sync');
    expect(body.targets[0]!.diff).toBe('');
  });
});

describe('POST /api/sync — commit', () => {
  it('writes long-tail targets through the guarded path (allowlist extension)', async () => {
    const app = realApp();
    const res = await post(app, '/api/sync', {
      sourcePath: 'CLAUDE.md',
      targets: ['cline', 'windsurf', 'zed', 'amazon-q'],
      dryRun: false,
    });
    expect(res.status).toBe(200);
    const body = (await res.json()) as SyncBody;
    expect(body.committed).toBe(true);
    // Files land at the long-tail paths that the scanner allowlist does NOT cover.
    expect(fs.readFileSync(path.join(projectRoot, '.clinerules'), 'utf-8')).toBe(CLAUDE_MD);
    expect(fs.readFileSync(path.join(projectRoot, '.windsurfrules'), 'utf-8')).toBe(CLAUDE_MD);
    expect(fs.readFileSync(path.join(projectRoot, '.rules'), 'utf-8')).toBe(CLAUDE_MD);
    expect(fs.readFileSync(path.join(projectRoot, '.amazonq/rules/project.md'), 'utf-8')).toBe(
      CLAUDE_MD,
    );
  });

  it('writes a cursor rule with synthesized frontmatter', async () => {
    const app = realApp();
    await post(app, '/api/sync', { sourcePath: 'CLAUDE.md', targets: ['cursor'], dryRun: false });
    const written = fs.readFileSync(path.join(projectRoot, '.cursor/rules/project.mdc'), 'utf-8');
    expect(written).toBe(`---\ndescription: Project rules\nalwaysApply: true\n---\n\n${CLAUDE_MD}`);
  });
});

describe('POST /api/sync — guard + validation', () => {
  it('404s an absent source', async () => {
    const app = realApp();
    const res = await post(app, '/api/sync', { sourcePath: 'AGENTS.md', dryRun: true });
    expect(res.status).toBe(404);
  });

  it('403s a source that traverses out of scope', async () => {
    const app = realApp();
    const res = await post(app, '/api/sync', { sourcePath: '../../etc/passwd', dryRun: true });
    // `..` is stripped by input discipline → 400; an absolute escape → 403.
    expect([400, 403]).toContain(res.status);
  });

  it('403s an absolute out-of-scope source', async () => {
    const app = realApp();
    const res = await post(app, '/api/sync', { sourcePath: '/etc/hosts', dryRun: true });
    expect(res.status).toBe(403);
  });

  it('400s an empty target list', async () => {
    const app = realApp();
    const res = await post(app, '/api/sync', {
      sourcePath: 'CLAUDE.md',
      targets: ['not-a-runtime'],
      dryRun: true,
    });
    expect(res.status).toBe(400);
  });

  it('400s a malformed targets field', async () => {
    const app = realApp();
    const res = await post(app, '/api/sync', {
      sourcePath: 'CLAUDE.md',
      targets: 'codex',
      dryRun: true,
    });
    expect(res.status).toBe(400);
  });

  it('401s without a bearer token (inherited gate)', async () => {
    const app = realApp();
    const res = await Promise.resolve(
      app.fetch(
        new Request(`http://${HOST}/api/sync`, {
          method: 'POST',
          headers: { host: HOST, origin: ORIGIN, 'content-type': 'application/json' },
          body: JSON.stringify({ sourcePath: 'CLAUDE.md', dryRun: true }),
        }),
      ),
    );
    expect(res.status).toBe(401);
  });

  it('403s a state-changing request with no same-origin proof (inherited CSRF gate)', async () => {
    const app = realApp();
    const res = await Promise.resolve(
      app.fetch(
        new Request(`http://${HOST}/api/sync`, {
          method: 'POST',
          headers: { host: HOST, 'content-type': 'application/json', ...AUTH },
          body: JSON.stringify({ sourcePath: 'CLAUDE.md', dryRun: true }),
        }),
      ),
    );
    expect(res.status).toBe(403);
  });

  it('excludes the source runtime from its own targets', async () => {
    const app = realApp();
    const res = await post(app, '/api/sync', {
      sourcePath: 'CLAUDE.md',
      targets: ['claude-code', 'codex'],
      dryRun: true,
    });
    const body = (await res.json()) as SyncBody;
    // claude-code → CLAUDE.md == source → skipped; only AGENTS.md remains.
    expect(body.targets.map((t) => t.path)).toEqual(['AGENTS.md']);
  });
});
