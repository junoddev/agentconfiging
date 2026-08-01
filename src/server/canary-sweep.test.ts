/**
 * Canary secret leak sweep (agentconfig-6dt.6).
 *
 * This is intentionally route-table driven: every concrete `/api` Hono route is
 * requested over a real node:http server, then the serialized response body is
 * scanned for fixture canaries. WebSocket frames and log sinks are swept too.
 * New API routes are picked up automatically by `app.routes`; route-specific
 * recipes only make known routes reach their richer success paths.
 */

import { createHash } from 'node:crypto';
import { createServer, type Server } from 'node:http';
import fs from 'node:fs';
import net from 'node:net';
import os from 'node:os';
import path from 'node:path';
import type { Duplex } from 'node:stream';
import { fileURLToPath } from 'node:url';
import { afterAll, describe, expect, it } from 'vitest';
import { createApp } from './app.js';
import { handleRequest } from './bridge.js';
import type { CatalogSource } from './catalog.js';
import type { ExtensionProviderAdapter } from './extensions.js';
import type { GitExec } from './git.js';
import type { WriteScope } from './pathguard.js';
import { InstanceRegistry } from './registry.js';
import { GlobalStore } from './store.js';
import { WsHub, decodeFrames, handleUpgrade } from './ws.js';
import { createFileLogger } from '../cli/logs.js';
import { redact, sha256Hex, type RegistryEntry, type ResolvedFile } from '../core/index.js';
import type { SqliteDatabaseCtor, SqliteLoader } from './search.js';

const TOKEN = 'canary-sweep-session-token-canary-sweep-1';
const tokenHash = createHash('sha256').update(TOKEN).digest();
const FIXTURE = fileURLToPath(new URL('../../fixtures/trees/canary-secrets', import.meta.url));

const CANARIES = {
  openai: 'sk-canaryopenaiagentconfig6dt6AAAAAAAAAAAA',
  anthropic: 'sk-ant-canaryAnthropic6dt6BBBBBBBBBBBB',
  aws: 'AKIA6DT6CANARY000000',
  github: 'ghp_CANARY6DT6CANARY6DT6CANARY6DT6CANARY6D',
  npm: 'npm_CANARY6DT6CANARY6DT6CANARY6DT6',
  continueModel: 'sk-canarycontinuemodel6dt6CCCCCCCCCCCC',
  opencodeAnthropic: 'sk-ant-opencodeCanary6dt6DDDDDDDDDDDD',
  opencodeOpenai: 'sk-opencodecanary6dt6EEEEEEEEEEEEEEEE',
  partialEnv: 'PARTIAL_DOTENV_CANARY_7yb7_TAIL',
  boundary: '7yb.7-CANARY-TAIL',
} as const;

const FORBIDDEN = [
  ...Object.values(CANARIES),
  'opencodeCanary6dt6',
  'opencodecanary6dt6',
  'canarycontinuemodel6dt6',
  'CANARY6DT6CANARY',
  '7yb7_TAIL',
];

const SESSION_ID = '66666666-6666-4666-8666-666666666666';
const RUN_ID = '77777777-7777-4777-8777-777777777777';
const PIPELINE_ID = 'demo';
const PIPELINE_SAVE_ID = 'save-me';
const PIPELINE_DELETE_ID = 'delete-me';
const DISPOSABLE_WRITE_PATH = '.claude/canary-disposable.json';

type EnvKey = 'HOME' | 'XDG_STATE_HOME' | 'AGENTCONFIGING_LOG_DIR';
type EnvSnapshot = Record<EnvKey, string | undefined>;

function restoreEnv(snapshot: EnvSnapshot): void {
  for (const [key, value] of Object.entries(snapshot) as [EnvKey, string | undefined][]) {
    if (value === undefined) delete process.env[key];
    else process.env[key] = value;
  }
}

interface Observation {
  label: string;
  route?: string;
  status?: number;
  text: string;
}

interface CannedRow {
  sessionId: string;
  messageIndex: number;
  role: string;
  snip: string;
  rawText?: string;
  timestamp: string;
}

class FakeDb {
  turns: unknown[][] = [];
  files = new Map<string, number>();
  meta = new Map<string, string>();
  searchSql: string[] = [];

  constructor(readonly searchRows: CannedRow[]) {}

  exec(): unknown {
    return undefined;
  }

  prepare(sql: string) {
    const s = sql.trim();
    return {
      run: (...p: unknown[]) => {
        if (s.startsWith('INSERT INTO turns')) this.turns.push(p);
        else if (s.startsWith('DELETE FROM turns'))
          this.turns = this.turns.filter((r) => r[0] !== p[0]);
        else if (s.startsWith('INSERT INTO indexed_files'))
          this.files.set(String(p[0]), Number(p[1]));
        else if (s.startsWith('DELETE FROM indexed_files')) this.files.delete(String(p[0]));
        else if (s.startsWith('INSERT INTO meta')) this.meta.set('lastIndexedAt', String(p[0]));
        return {};
      },
      get: () => {
        if (s.includes('COUNT(*)') && s.includes('indexed_files')) return { n: this.files.size };
        if (s.includes('COUNT(*)') && s.includes('turns')) return { n: this.turns.length };
        if (s.includes("FROM meta WHERE key = 'lastIndexedAt'"))
          return this.meta.has('lastIndexedAt')
            ? { value: this.meta.get('lastIndexedAt') }
            : undefined;
        return undefined;
      },
      all: (...p: unknown[]) => {
        if (s.includes('FROM indexed_files'))
          return [...this.files.entries()].map(([id, mtime]) => ({ id, mtime }));
        if (s.includes('turns MATCH')) {
          this.searchSql.push(s);
          const selectsRawText = /\btext\s+AS\s+rawText\b/i.test(s);
          return this.searchRows.slice(0, Number(p[1] ?? 10)).map((row) => {
            if (selectsRawText) return row;
            const withoutRawText = { ...row };
            delete withoutRawText.rawText;
            return withoutRawText;
          });
        }
        return [];
      },
    };
  }

  close(): unknown {
    return undefined;
  }
}

function fakeSearchLoader(db: FakeDb): SqliteLoader {
  const Ctor = function () {
    return db;
  };
  return async () => Ctor as unknown as SqliteDatabaseCtor;
}

function copyFixtureRoot(base: string): string {
  const root = path.join(base, 'project');
  fs.cpSync(FIXTURE, root, { recursive: true });
  fs.mkdirSync(path.join(root, '.claude', 'logs'), { recursive: true });
  fs.writeFileSync(path.join(root, '.claude', 'logs', 'old.log'), 'discardable\n');
  fs.writeFileSync(path.join(root, DISPOSABLE_WRITE_PATH), '{"safe":true}\n');
  seedCatalogInstall(root);
  return fs.realpathSync(root);
}

function seedCatalogInstall(projectRoot: string): void {
  const skillPath = path.join(projectRoot, '.claude', 'skills', 'canary', 'SKILL.md');
  fs.mkdirSync(path.dirname(skillPath), { recursive: true });
  fs.writeFileSync(skillPath, '---\nname: canary\ndescription: Installed canary.\n---\n');
  fs.mkdirSync(path.join(projectRoot, '.agentconfig'), { recursive: true });
  fs.writeFileSync(
    path.join(projectRoot, '.agentconfig', 'provenance.json'),
    JSON.stringify(
      {
        version: 1,
        installs: {
          'skill/canary': {
            key: 'skill/canary',
            kind: 'skill',
            name: 'canary',
            source: 'canary-test',
            version: '1.0.0',
            installedAt: '2026-07-31T12:00:00.000Z',
            files: ['.claude/skills/canary/SKILL.md'],
          },
        },
      },
      null,
      2,
    ) + '\n',
  );
}

function seedHome(base: string, projectRoot: string): string {
  const home = path.join(base, 'home');
  const claudeHome = path.join(home, '.claude');
  const sessionDir = path.join(claudeHome, 'projects', '-tmp-canary');
  fs.mkdirSync(sessionDir, { recursive: true });
  fs.writeFileSync(
    path.join(claudeHome, 'settings.json'),
    JSON.stringify({ env: { OPENAI_API_KEY: CANARIES.openai } }, null, 2),
  );
  fs.writeFileSync(
    path.join(claudeHome, 'history.jsonl'),
    JSON.stringify({
      display: `search needle ${CANARIES.boundary}`,
      timestamp: Date.now(),
      project: projectRoot,
    }) + '\n',
  );
  fs.writeFileSync(
    path.join(sessionDir, `${SESSION_ID}.jsonl`),
    [
      JSON.stringify({ type: 'summary', summary: `Deploy ${CANARIES.openai}` }),
      JSON.stringify({
        parentUuid: null,
        isSidechain: false,
        type: 'user',
        message: {
          role: 'user',
          content: `needle PARTIAL_ENV_TOKEN=${CANARIES.partialEnv} ${CANARIES.aws}`,
        },
        uuid: '60000000-0000-4000-8000-000000000001',
        timestamp: '2026-07-31T12:00:00.000Z',
        cwd: projectRoot,
        sessionId: SESSION_ID,
      }),
      JSON.stringify({
        type: 'ai-title',
        aiTitle: `Deploy with ${CANARIES.anthropic}`,
        sessionId: SESSION_ID,
      }),
    ].join('\n') + '\n',
  );
  fs.mkdirSync(path.join(home, '.opencode'), { recursive: true });
  fs.writeFileSync(
    path.join(home, '.opencode', 'opencode.json'),
    JSON.stringify({
      provider: {
        anthropic: { options: { apiKey: CANARIES.opencodeAnthropic } },
        openai: { options: { token: CANARIES.opencodeOpenai } },
      },
    }),
  );
  return fs.realpathSync(home);
}

function seedPipelineState(base: string, projectRoot: string): string {
  const stateDir = path.join(base, 'state');
  const pipelineDir = path.join(stateDir, 'pipelines');
  fs.mkdirSync(path.join(pipelineDir, 'runs'), { recursive: true });
  fs.writeFileSync(
    path.join(pipelineDir, `${PIPELINE_ID}.json`),
    JSON.stringify(
      {
        id: PIPELINE_ID,
        name: 'Demo',
        nodes: [
          { id: 'a', name: 'in', type: 'input' },
          { id: 'b', name: 'sh', type: 'bash', script: 'echo hi' },
        ],
        edges: [{ from: 'a', to: 'b' }],
      },
      null,
      2,
    ),
  );
  fs.writeFileSync(
    path.join(pipelineDir, `${PIPELINE_DELETE_ID}.json`),
    JSON.stringify(
      {
        id: PIPELINE_DELETE_ID,
        name: 'Delete me',
        nodes: [
          { id: 'a', name: 'in', type: 'input' },
          { id: 'b', name: 'out', type: 'output' },
        ],
        edges: [{ from: 'a', to: 'b' }],
      },
      null,
      2,
    ),
  );
  fs.writeFileSync(
    path.join(pipelineDir, 'runs', `${RUN_ID}.json`),
    JSON.stringify(
      {
        runId: RUN_ID,
        pipelineId: PIPELINE_ID,
        status: 'ok',
        startedAt: 1,
        finishedAt: 2,
        nodes: {
          b: {
            nodeName: 'sh',
            status: 'ok',
            output: { stdout: `printed ${CANARIES.aws}` },
            error: `err ${CANARIES.openai}`,
          },
        },
      },
      null,
      2,
    ),
  );
  fs.writeFileSync(
    path.join(pipelineDir, 'schedules.json'),
    JSON.stringify({
      [PIPELINE_ID]: {
        pipelineId: PIPELINE_ID,
        cron: '@hourly',
        enabled: true,
        instanceRoot: projectRoot,
      },
    }),
  );
  return stateDir;
}

function catalogSource(): CatalogSource {
  const content =
    '---\nname: canary\ndescription: Canary skill.\n---\n\n' +
    `CATALOG_PASSWORD=${CANARIES.partialEnv}\n`;
  const entry: RegistryEntry = {
    kind: 'skill',
    name: 'canary',
    description: 'Canary fixture entry',
    version: '1.0.0',
    source: 'canary-test',
    tags: [],
    files: [
      {
        path: '.claude/skills/canary/SKILL.md',
        content,
        sha256: sha256Hex(content),
      },
    ],
  };
  return {
    getCatalog: async () => [entry],
    fetchEntryFiles: async (e) =>
      e.files.map((file) => ({ path: file.path, content: file.content }) as ResolvedFile),
  };
}

function marketplaceExec(): Promise<{ stdout: string; stderr: string }> {
  return Promise.resolve({
    stdout: JSON.stringify({
      available: [
        {
          pluginId: 'demo@market',
          name: 'demo',
          description: 'safe demo',
          source: { ref: '1.0.0', url: 'https://example.invalid/demo' },
          marketplaceName: 'test',
        },
      ],
      installed: [],
    }),
    stderr: '',
  });
}

const gitExec: GitExec = async (args) => {
  const command = args.join(' ');
  if (args.includes('status'))
    return { stdout: '# branch.oid initial\n# branch.head main\n', stderr: '' };
  if (args.includes('log')) return { stdout: '', stderr: '' };
  if (args.includes('branch')) return { stdout: '* main\n', stderr: '' };
  if (args.includes('diff'))
    return {
      stdout: `diff --git a/.claude/settings.json b/.claude/settings.json\n+OPENAI_API_KEY=${CANARIES.openai}\n`,
      stderr: '',
    };
  return { stdout: `ok ${command}`.slice(0, 200), stderr: '' };
};

const extensionAdapters: ExtensionProviderAdapter[] = [
  {
    provider: {
      id: 'test',
      displayName: 'Test',
      kind: 'none',
      scopes: ['project'],
      capabilities: {
        list: true,
        detail: false,
        install: false,
        remove: false,
        update: false,
        enable: false,
        disable: false,
      },
    },
    listInstalled: async () => ({ state: 'supported', extensions: [] }),
  },
];

interface Harness {
  base: string;
  app: ReturnType<typeof createApp>;
  server: Server;
  port: number;
  projectRoot: string;
  defaultInstanceId: string;
  deletableInstanceId: string;
  searchDb: FakeDb;
  wsHub: WsHub;
  observations: Observation[];
  close: () => Promise<void>;
}

async function bootHarness(): Promise<Harness> {
  const base = fs.mkdtempSync(path.join(os.tmpdir(), 'agentconfig-canary-sweep-'));
  let server: Server | undefined;
  const wsHub = new WsHub();
  const wsSockets = new Set<Duplex>();
  let cleaned = false;

  const closeServer = async () => {
    const activeServer = server;
    if (!activeServer?.listening) return;
    await new Promise<void>((resolve, reject) =>
      activeServer.close((err) => (err ? reject(err) : resolve())),
    );
  };
  const cleanup = async () => {
    if (cleaned) return;
    wsHub.closeAll();
    for (const socket of wsSockets) socket.destroy();
    let closeError: unknown;
    try {
      await closeServer();
    } catch (err) {
      closeError = err;
    }
    let rmError: unknown;
    try {
      fs.rmSync(base, { recursive: true, force: true });
    } catch (err) {
      rmError = err;
    }
    if (closeError !== undefined && rmError !== undefined) {
      throw new AggregateError([closeError, rmError], 'canary harness cleanup failed');
    }
    if (rmError !== undefined) throw rmError;
    if (closeError !== undefined) throw closeError;
    cleaned = true;
  };

  try {
    const projectRoot = copyFixtureRoot(base);
    const home = seedHome(base, projectRoot);
    const stateDir = seedPipelineState(base, projectRoot);
    const distDir = path.join(base, 'dist');
    const trashDir = path.join(base, 'trash');
    const logDir = path.join(base, 'logs');
    const deletableRoot = path.join(base, 'deletable-project');
    fs.mkdirSync(distDir, { recursive: true });
    fs.mkdirSync(deletableRoot, { recursive: true });
    fs.writeFileSync(path.join(distDir, 'index.html'), '<!doctype html><div>shell</div>');

    const oldEnv: EnvSnapshot = {
      HOME: process.env['HOME'],
      XDG_STATE_HOME: process.env['XDG_STATE_HOME'],
      AGENTCONFIGING_LOG_DIR: process.env['AGENTCONFIGING_LOG_DIR'],
    };
    let registry: InstanceRegistry;
    let defaultInstanceId: string;
    let deletableInstanceId: string;
    let scopes: WriteScope[];
    let searchDb: FakeDb;
    let boundPort = 0;
    let app: ReturnType<typeof createApp>;

    try {
      process.env['HOME'] = home;
      process.env['XDG_STATE_HOME'] = stateDir;
      process.env['AGENTCONFIGING_LOG_DIR'] = logDir;

      registry = new InstanceRegistry('9.9.9');
      registry.seed(projectRoot, { makeDefault: true });
      deletableInstanceId = registry.add(deletableRoot).id;
      defaultInstanceId = registry.list()[0]!.id;
      scopes = [
        { root: projectRoot, kind: 'project' },
        { root: fs.realpathSync(path.join(home, '.claude')), kind: 'global' },
        { root: fs.realpathSync(path.join(home, '.opencode')), kind: 'global' },
      ];

      searchDb = new FakeDb([
        {
          sessionId: SESSION_ID,
          messageIndex: 0,
          role: 'user',
          snip: CANARIES.boundary,
          rawText: `needle PARTIAL_ENV_TOKEN=${CANARIES.partialEnv} ${CANARIES.aws}`,
          timestamp: '2026-07-31T12:00:00.000Z',
        },
      ]);

      app = createApp({
        tokenHash,
        port: () => boundPort,
        distDir,
        registry,
        version: '9.9.9',
        globalStore: new GlobalStore(home, '9.9.9'),
        scopes,
        trashDir,
        catalogClient: catalogSource(),
        marketplaceExec,
        extensionAdapters,
        gitExec,
        interactive: false,
        pipelineStateDir: stateDir,
        searchLoader: fakeSearchLoader(searchDb),
      });

      const observations: Observation[] = [];
      const logger = createFileLogger(path.join(logDir, 'canary.log'));
      const canaryLogSeed = fs.readFileSync(path.join(projectRoot, 'AGENTS.md'), 'utf8');
      logger.append({
        time: new Date('2026-07-31T12:00:00.000Z'),
        level: 'info',
        text: redact(canaryLogSeed).text,
      });

      server = createServer((req, res) => {
        void handleRequest(app.fetch, req, res, `http://127.0.0.1:${boundPort}`);
      });
      server.on('upgrade', (req, socket, head) => {
        wsSockets.add(socket);
        socket.on('close', () => wsSockets.delete(socket));
        handleUpgrade(req, socket, head, {
          tokenHash,
          port: () => boundPort,
          hub: wsHub,
          path: '/api/ws',
        });
      });
      await new Promise<void>((resolve, reject) => {
        server!.once('error', reject);
        server!.listen(0, '127.0.0.1', resolve);
      });
      const addr = server.address();
      if (addr === null || typeof addr === 'string') throw new Error('server did not bind');
      boundPort = addr.port;

      return {
        base,
        app,
        server,
        port: boundPort,
        projectRoot,
        defaultInstanceId,
        deletableInstanceId,
        searchDb,
        wsHub,
        observations,
        close: cleanup,
      };
    } finally {
      restoreEnv(oldEnv);
    }
  } catch (err) {
    await cleanup();
    throw err;
  }
}

function routeKey(method: string, routePath: string): string {
  return `${method.toUpperCase()} ${routePath}`;
}

function concretePath(routePath: string, h: Harness): string {
  return routePath
    .replace(':id', PIPELINE_ID)
    .replace(':runId', RUN_ID)
    .replace('/api/sessions/' + PIPELINE_ID, `/api/sessions/${SESSION_ID}`)
    .replace('/api/instances/' + PIPELINE_ID, `/api/instances/${h.defaultInstanceId}`);
}

interface RouteRecipe {
  description: string;
  path: string;
  body?: unknown;
  expectedStatuses: readonly number[];
}

function routeRecipes(h: Harness): Record<string, RouteRecipe> {
  const ok = [200] as const;
  return {
    'GET /api/health': { description: 'health metadata', path: '', expectedStatuses: ok },
    'GET /api/instances': { description: 'instance inventory', path: '', expectedStatuses: ok },
    'POST /api/instances': {
      description: 'deduped instance add',
      path: '',
      body: { path: h.projectRoot },
      expectedStatuses: ok,
    },
    'POST /api/instances/scan': {
      description: 'bounded project discovery',
      path: '',
      body: { path: h.projectRoot },
      expectedStatuses: ok,
    },
    'POST /api/instances/:id/unload': {
      description: 'known instance unload',
      path: `/api/instances/${h.defaultInstanceId}/unload`,
      body: {},
      expectedStatuses: ok,
    },
    'DELETE /api/instances/:id': {
      description: 'known disposable instance removal',
      path: `/api/instances/${h.deletableInstanceId}`,
      expectedStatuses: ok,
    },
    'GET /api/report': {
      description: 'project report with redacted config content',
      path: '/api/report?fresh=1',
      expectedStatuses: ok,
    },
    'GET /api/context-health': {
      description: 'context health for known instance',
      path: '/api/context-health?fresh=1',
      expectedStatuses: ok,
    },
    'GET /api/context-cost': {
      description: 'context cost for known instance',
      path: '/api/context-cost?fresh=1',
      expectedStatuses: ok,
    },
    'POST /api/write': {
      description: 'dry-run write diff against disposable file',
      path: '',
      body: { path: DISPOSABLE_WRITE_PATH, content: '{"safe":false}\n', dryRun: true },
      expectedStatuses: ok,
    },
    'POST /api/delete': {
      description: 'dry-run delete of existing in-scope file',
      path: '',
      body: { path: DISPOSABLE_WRITE_PATH, dryRun: true },
      expectedStatuses: ok,
    },
    'GET /api/file': {
      description: 'redacted file read',
      path: '/api/file?path=.claude/settings.json',
      expectedStatuses: ok,
    },
    'POST /api/apply-fix': {
      description: 'dry-run analyzer fix',
      path: '',
      body: {
        findingId: 'stale-model-ref-claude-settings-json-claude-3-opus-20240229',
        dryRun: true,
      },
      expectedStatuses: ok,
    },
    'POST /api/hooks/edit': {
      description: 'dry-run hook edit against secret-bearing settings',
      path: '',
      body: {
        path: '.claude/settings.json',
        op: 'add',
        event: 'Stop',
        hook: { type: 'command', command: 'echo ok' },
        dryRun: true,
      },
      expectedStatuses: ok,
    },
    'GET /api/storage': {
      description: 'storage breakdown for known instance',
      path: '',
      expectedStatuses: ok,
    },
    'POST /api/storage/cleanup': {
      description: 'allowlisted storage cleanup',
      path: '',
      body: { home: 'project:.claude', name: 'logs' },
      expectedStatuses: ok,
    },
    'POST /api/sync': {
      description: 'dry-run sync diff',
      path: '',
      body: { sourcePath: 'CLAUDE.md', targets: ['codex'], dryRun: true },
      expectedStatuses: ok,
    },
    'GET /api/catalog': {
      description: 'catalog metadata for known instance',
      path: '',
      expectedStatuses: ok,
    },
    'POST /api/catalog/install': {
      description: 'dry-run catalog install diff',
      path: '',
      body: { entryKey: 'skill/canary', dryRun: true },
      expectedStatuses: ok,
    },
    'POST /api/catalog/remove': {
      description: 'dry-run catalog remove for installed entry',
      path: '',
      body: { entryKey: 'skill/canary', dryRun: true },
      expectedStatuses: ok,
    },
    'GET /api/marketplace': {
      description: 'marketplace listing',
      path: '',
      expectedStatuses: ok,
    },
    'GET /api/marketplace/installed': {
      description: 'installed marketplace inventory',
      path: '',
      expectedStatuses: ok,
    },
    'POST /api/marketplace/install': {
      description: 'allowlisted plugin install request',
      path: '',
      body: { name: 'demo@market' },
      expectedStatuses: ok,
    },
    'GET /api/extensions': {
      description: 'extension provider inventory',
      path: '',
      expectedStatuses: ok,
    },
    'GET /api/git/status': {
      description: 'git status for known instance',
      path: '',
      expectedStatuses: ok,
    },
    'GET /api/git/log': {
      description: 'git log for known instance',
      path: '',
      expectedStatuses: ok,
    },
    'GET /api/git/branches': {
      description: 'git branches for known instance',
      path: '',
      expectedStatuses: ok,
    },
    'GET /api/git/diff': {
      description: 'redacted git diff for a secret-bearing file',
      path: '/api/git/diff?path=.claude/settings.json',
      expectedStatuses: ok,
    },
    'POST /api/git/stage': {
      description: 'git stage request',
      path: '',
      body: { files: ['CLAUDE.md'] },
      expectedStatuses: ok,
    },
    'POST /api/git/unstage': {
      description: 'git unstage request',
      path: '',
      body: { files: ['CLAUDE.md'] },
      expectedStatuses: ok,
    },
    'POST /api/git/commit': {
      description: 'git commit request',
      path: '',
      body: { message: 'test: canary sweep' },
      expectedStatuses: ok,
    },
    'POST /api/git/checkout': {
      description: 'git checkout request',
      path: '',
      body: { branch: 'main' },
      expectedStatuses: ok,
    },
    'POST /api/git/push': {
      description: 'git push request',
      path: '',
      body: {},
      expectedStatuses: ok,
    },
    'POST /api/git/pull': {
      description: 'git pull request',
      path: '',
      body: {},
      expectedStatuses: ok,
    },
    'GET /api/stats': {
      description: 'session aggregate stats',
      path: '',
      expectedStatuses: ok,
    },
    'GET /api/sessions': {
      description: 'session metadata list',
      path: '',
      expectedStatuses: ok,
    },
    'GET /api/sessions/:id': {
      description: 'redacted session replay',
      path: `/api/sessions/${SESSION_ID}`,
      expectedStatuses: ok,
    },
    'POST /api/sessions/:id/tags': {
      description: 'known session tag write',
      path: `/api/sessions/${SESSION_ID}/tags`,
      body: { tags: ['safe'] },
      expectedStatuses: ok,
    },
    'GET /api/known-projects': {
      description: 'known project suggestions',
      path: '',
      expectedStatuses: ok,
    },
    'GET /api/search': {
      description: 'FTS search over raw indexed text',
      path: '/api/search?q=needle&limit=5',
      expectedStatuses: ok,
    },
    'POST /api/search/reindex': {
      description: 'search index rebuild',
      path: '',
      body: {},
      expectedStatuses: ok,
    },
    'GET /api/search/status': {
      description: 'search index status',
      path: '',
      expectedStatuses: ok,
    },
    'GET /api/pty/status': {
      description: 'PTY capability status',
      path: '',
      expectedStatuses: ok,
    },
    'GET /api/pipelines': {
      description: 'pipeline list',
      path: '',
      expectedStatuses: ok,
    },
    'GET /api/pipelines/runs/:runId': {
      description: 'redacted pipeline run detail',
      path: `/api/pipelines/runs/${RUN_ID}`,
      expectedStatuses: ok,
    },
    'GET /api/pipelines/:id/runs': {
      description: 'pipeline run history',
      path: `/api/pipelines/${PIPELINE_ID}/runs`,
      expectedStatuses: ok,
    },
    'GET /api/pipelines/:id': {
      description: 'pipeline detail',
      path: `/api/pipelines/${PIPELINE_ID}`,
      expectedStatuses: ok,
    },
    'POST /api/pipelines': {
      description: 'disposable pipeline save',
      path: '',
      body: {
        id: PIPELINE_SAVE_ID,
        name: 'Save me',
        nodes: [
          { id: 'a', name: 'in', type: 'input' },
          { id: 'b', name: 'out', type: 'output' },
        ],
        edges: [{ from: 'a', to: 'b' }],
      },
      expectedStatuses: ok,
    },
    'DELETE /api/pipelines/:id': {
      description: 'known disposable pipeline delete',
      path: `/api/pipelines/${PIPELINE_DELETE_ID}`,
      expectedStatuses: ok,
    },
    'POST /api/pipelines/:id/run': {
      description: 'pipeline run for known pipeline',
      path: `/api/pipelines/${PIPELINE_ID}/run`,
      body: { input: 'safe' },
      expectedStatuses: ok,
    },
    'GET /api/pipelines/:id/schedule': {
      description: 'pipeline schedule detail',
      path: `/api/pipelines/${PIPELINE_ID}/schedule`,
      expectedStatuses: ok,
    },
    'POST /api/pipelines/:id/schedule': {
      description: 'pipeline schedule update',
      path: `/api/pipelines/${PIPELINE_ID}/schedule`,
      body: { cron: '@daily', enabled: true },
      expectedStatuses: ok,
    },
  };
}

function requestFor(method: string, routePath: string, h: Harness): RouteRecipe {
  const key = routeKey(method, routePath);
  const recipe = routeRecipes(h)[key];
  if (recipe === undefined) {
    throw new Error(`missing canary route recipe for ${key}`);
  }
  return {
    ...recipe,
    path: recipe.path === '' ? concretePath(routePath, h) : recipe.path,
  };
}

async function send(h: Harness, method: string, routePath: string): Promise<Observation> {
  const key = routeKey(method, routePath);
  const spec = requestFor(method, routePath, h);
  return sendSpec(h, method, spec, { label: `${key}`, route: key });
}

async function sendExtra(
  h: Harness,
  method: string,
  path: string,
  label = `${method} ${path}`,
): Promise<Observation> {
  return sendSpec(h, method, { description: label, path, expectedStatuses: [200] }, { label });
}

async function sendSpec(
  h: Harness,
  method: string,
  spec: RouteRecipe,
  labels: { label: string; route?: string },
): Promise<Observation> {
  const headers: Record<string, string> = {
    authorization: `Bearer ${TOKEN}`,
  };
  if (method !== 'GET' && method !== 'HEAD') {
    headers['origin'] = `http://127.0.0.1:${h.port}`;
    headers['content-type'] = 'application/json';
  }
  const res = await fetch(`http://127.0.0.1:${h.port}${spec.path}`, {
    method,
    headers,
    ...(spec.body === undefined ? {} : { body: JSON.stringify(spec.body) }),
  });
  const text = await res.text();
  return {
    label: `${labels.label} -> ${res.status}`,
    ...(labels.route !== undefined ? { route: labels.route } : {}),
    status: res.status,
    text,
  };
}

function isErrorOnlyBody(text: string): boolean {
  try {
    const parsed = JSON.parse(text) as unknown;
    return (
      parsed !== null &&
      typeof parsed === 'object' &&
      !Array.isArray(parsed) &&
      Object.keys(parsed).length === 1 &&
      typeof (parsed as { error?: unknown }).error === 'string'
    );
  } catch {
    return false;
  }
}

async function wsObservation(h: Harness): Promise<Observation> {
  const text = await new Promise<string>((resolve, reject) => {
    const socket = net.connect(h.port, '127.0.0.1', () => {
      socket.write(
        [
          'GET /api/ws HTTP/1.1',
          `Host: 127.0.0.1:${h.port}`,
          'Upgrade: websocket',
          'Connection: Upgrade',
          'Sec-WebSocket-Key: dGhlIHNhbXBsZSBub25jZQ==',
          'Sec-WebSocket-Version: 13',
          `Origin: http://127.0.0.1:${h.port}`,
          `Sec-WebSocket-Protocol: ${TOKEN}`,
          '',
          '',
        ].join('\r\n'),
      );
    });
    let buf: Buffer<ArrayBufferLike> = Buffer.alloc(0);
    let headerDone = false;
    socket.setTimeout(5000, () => reject(new Error('ws timeout')));
    socket.on('data', (chunk: Buffer) => {
      buf = Buffer.concat([buf, chunk]);
      if (!headerDone) {
        const idx = buf.indexOf('\r\n\r\n');
        if (idx === -1) return;
        const header = buf.subarray(0, idx).toString('utf8');
        expect(header).toContain('101 Switching Protocols');
        buf = buf.subarray(idx + 4);
        headerDone = true;
        h.wsHub.broadcast({ type: 'report', instance: h.defaultInstanceId, changed: ['agents'] });
      }
      const decoded = decodeFrames(buf);
      buf = decoded.rest;
      const frame = decoded.frames.find((f) => f.opcode === 0x1);
      if (frame) {
        socket.destroy();
        resolve(frame.payload.toString('utf8'));
      }
    });
    socket.on('error', reject);
  });
  return { label: 'WS /api/ws report frame', text };
}

function logObservations(base: string): Observation[] {
  const logDir = path.join(base, 'logs');
  if (!fs.existsSync(logDir)) return [];
  return fs
    .readdirSync(logDir)
    .filter((name) => name.endsWith('.log'))
    .map((name) => ({
      label: `log ${name}`,
      text: fs.readFileSync(path.join(logDir, name), 'utf8'),
    }));
}

const open: Harness[] = [];
afterAll(async () => {
  await Promise.allSettled(open.map((h) => h.close()));
});

describe('canary secret leak sweep across server output surfaces', () => {
  it('sweeps every concrete API route, report WS payloads, and log files', async () => {
    const h = await bootHarness();
    open.push(h);
    const routes = h.app.routes
      .filter((r) => r.path.startsWith('/api/') && r.path !== '/api/*' && r.method !== 'ALL')
      .map((r) => ({ method: r.method, path: r.path }));
    const recipes = routeRecipes(h);
    expect(routes.map((r) => routeKey(r.method, r.path)).sort()).toEqual(
      Object.keys(recipes).sort(),
    );

    for (const route of routes) {
      h.observations.push(await send(h, route.method, route.path));
    }
    h.observations.push(await sendExtra(h, 'GET', '/api/report?scope=global&fresh=1'));
    h.observations.push(await wsObservation(h));
    h.observations.push(...logObservations(h.base));

    const labels = h.observations.map((o) => o.label);
    for (const route of routes) {
      const key = routeKey(route.method, route.path);
      const recipe = recipes[key]!;
      const observation = h.observations.find((o) => o.route === key);
      expect(labels.some((label) => label.startsWith(`${key} ->`))).toBe(true);
      expect(observation, `${key} (${recipe.description}) was not observed`).toBeDefined();
      expect(
        observation!.status,
        `${key} (${recipe.description}) returned ${observation?.status}: ${observation?.text}`,
      ).toBeGreaterThanOrEqual(200);
      expect(
        observation!.status,
        `${key} (${recipe.description}) returned ${observation?.status}: ${observation?.text}`,
      ).toBeLessThan(300);
      expect(
        recipe.expectedStatuses,
        `${key} (${recipe.description}) returned ${observation?.status}: ${observation?.text}`,
      ).toContain(observation!.status);
      expect(isErrorOnlyBody(observation!.text), `${key} only exercised an error body`).toBe(false);
    }
    const searchObservation = h.observations.find((o) => o.route === 'GET /api/search');
    expect(searchObservation, 'GET /api/search was not observed').toBeDefined();
    const searchBody = JSON.parse(searchObservation!.text) as { results?: unknown };
    expect(searchBody).toMatchObject({
      available: true,
      mode: 'fts',
      query: 'needle',
    });
    expect(Array.isArray(searchBody.results), 'GET /api/search results must be an array').toBe(
      true,
    );
    const searchResults = searchBody.results as unknown[];
    expect(searchResults.length, 'GET /api/search results must be nonempty').toBeGreaterThan(0);
    expect(
      searchResults.some((result) => {
        if (result === null || typeof result !== 'object') return false;
        const snippet = (result as { snippet?: unknown }).snippet;
        return typeof snippet === 'string' && snippet.includes('[REDACTED:');
      }),
      'GET /api/search must return at least one redacted snippet',
    ).toBe(true);
    expect(
      h.searchDb.searchSql.some((sql) => /\btext\s+AS\s+rawText\b/i.test(sql)),
      'GET /api/search must exercise the FTS rawText redaction query',
    ).toBe(true);
    const logObservation = h.observations.find((o) => o.label === 'log canary.log');
    expect(logObservation, 'canary file log was not observed').toBeDefined();
    expect(logObservation!.text, 'canary file log must contain a redaction marker').toContain(
      '[REDACTED:',
    );

    const leaks = [];
    for (const observation of h.observations) {
      for (const fragment of FORBIDDEN) {
        if (observation.text.includes(fragment)) {
          leaks.push({ surface: observation.label, fragment });
        }
      }
    }
    expect(leaks).toEqual([]);
  });
});
