import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { afterEach, describe, expect, it, vi } from 'vitest';
import type { AppProps } from './app.js';
import {
  buildOpenCommand,
  runLaunch,
  type LaunchDeps,
  type LaunchOptions,
  type ServerHandle,
} from './launch.js';
import { loadWorkspace, saveWorkspace } from './workspace.js';

const tempDirs: string[] = [];
afterEach(() => {
  while (tempDirs.length > 0) fs.rmSync(tempDirs.pop() as string, { recursive: true, force: true });
});

function makeTempDir(): string {
  const dir = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), 'agentconfiging-launch-')));
  tempDirs.push(dir);
  return dir;
}

const URL = 'http://127.0.0.1:4242';

interface Harness {
  deps: LaunchDeps;
  stdout: () => string;
  stderr: () => string;
  serverCalls: { root: string }[];
  spawnCalls: { cmd: string; args: readonly string[] }[];
  close: ReturnType<typeof vi.fn>;
  logDir: string;
  stateDir: string;
  cwd: string;
  serverInstances: () => readonly string[] | undefined;
  renderedProps: () => AppProps | undefined;
}

function makeHarness(overrides: Partial<LaunchDeps> = {}): Harness {
  const out: string[] = [];
  const err: string[] = [];
  const serverCalls: { root: string }[] = [];
  const spawnCalls: { cmd: string; args: readonly string[] }[] = [];
  const close = vi.fn(async () => undefined);
  const logDir = makeTempDir();
  const stateDir = makeTempDir();
  const cwd = makeTempDir();
  let rendered: AppProps | undefined;

  let serverInstances: readonly string[] | undefined;
  const handle: ServerHandle = { url: URL, port: 4242, token: 'tok', close };
  const deps: LaunchDeps = {
    io: {
      stdout: (chunk) => void out.push(chunk),
      stderr: (chunk) => void err.push(chunk),
    },
    serverFactory: async (opts) => {
      serverCalls.push({ root: opts.root });
      serverInstances = opts.instances;
      return handle;
    },
    spawnOpen: (cmd, args) => void spawnCalls.push({ cmd, args }),
    renderApp: async (props) => {
      rendered = props;
    },
    loadCounts: () => ({ agentCount: 2, findingCount: 3 }),
    discover: () => [],
    cwd,
    env: { AGENTCONFIGING_LOG_DIR: logDir, AGENTCONFIGING_STATE_DIR: stateDir },
    isTTY: false,
    platform: 'darwin',
    now: () => new Date('2026-07-26T12:00:00.000Z'),
    ...overrides,
  };

  return {
    deps,
    stdout: () => out.join(''),
    stderr: () => err.join(''),
    serverCalls,
    spawnCalls,
    close,
    logDir,
    stateDir,
    cwd,
    serverInstances: () => serverInstances,
    renderedProps: () => rendered,
  };
}

const OPTS: LaunchOptions = { open: true, detach: false };

describe('runLaunch (plain, non-TTY)', () => {
  it('starts the server with root=cwd and prints the URL', async () => {
    const h = makeHarness();
    const code = await runLaunch(OPTS, h.deps);
    expect(code).toBe(0);
    expect(h.serverCalls).toEqual([{ root: h.cwd }]);
    expect(h.stdout()).toContain(`SIGNAL ACQUIRED · ${URL}`);
  });

  it('prints the log path on startup and mirrors every line to disk', async () => {
    const h = makeHarness();
    await runLaunch(OPTS, h.deps);
    const logFile = path.join(h.logDir, '2026-07-26T12-00-00.log');
    expect(h.stdout()).toContain(`LOG ${logFile}`);
    const onDisk = fs.readFileSync(logFile, 'utf-8');
    expect(onDisk).toContain(`SIGNAL ACQUIRED · ${URL}`);
    expect(onDisk).toContain('2 AGENTS · 3 FINDINGS');
    expect(onDisk).toContain(`OPEN ${URL}`);
  });

  it('redacts the session token from the disk log but keeps it in terminal output', async () => {
    const tokened = `${URL}/#token=SEKRET`;
    const h = makeHarness({
      serverFactory: async () => ({ url: tokened, port: 4242, token: 'SEKRET', close: vi.fn() }),
    });
    await runLaunch(OPTS, h.deps);
    const onDisk = fs.readFileSync(path.join(h.logDir, '2026-07-26T12-00-00.log'), 'utf-8');
    expect(onDisk).not.toContain('token=');
    expect(onDisk).not.toContain('SEKRET');
    // Plain (non-TTY) terminal output keeps the token: the browser-open needs it.
    expect(h.stdout()).toContain('token=SEKRET');
  });

  it('reports engine counts for the eagerly loaded cwd instance', async () => {
    const h = makeHarness();
    await runLaunch(OPTS, h.deps);
    expect(h.stdout()).toContain('2 AGENTS · 3 FINDINGS');
  });

  it('builds the platform browser-open command but only via the injected spawner', async () => {
    const h = makeHarness();
    await runLaunch(OPTS, h.deps);
    expect(h.spawnCalls).toEqual([{ cmd: 'open', args: [URL] }]);
  });

  it('--no-open skips the browser but still prints the URL', async () => {
    const h = makeHarness();
    await runLaunch({ open: false, detach: false }, h.deps);
    expect(h.spawnCalls).toEqual([]);
    expect(h.stdout()).toContain(URL);
  });

  it('a failing engine run degrades to a warning, not a crash', async () => {
    const h = makeHarness({
      loadCounts: () => {
        throw new Error('boom');
      },
    });
    const code = await runLaunch(OPTS, h.deps);
    expect(code).toBe(0);
    expect(h.stdout()).toContain('SCAN FAILED · boom');
  });

  it('server start failure exits 1 with the message and log path on stderr', async () => {
    const h = makeHarness({
      serverFactory: async () => {
        throw new Error('EADDRINUSE');
      },
    });
    const code = await runLaunch(OPTS, h.deps);
    expect(code).toBe(1);
    expect(h.stderr()).toContain('EADDRINUSE');
    expect(h.stderr()).toContain(`LOG ${path.join(h.logDir, '2026-07-26T12-00-00.log')}`);
  });

  it('never renders Ink when piped', async () => {
    const h = makeHarness();
    await runLaunch(OPTS, h.deps);
    expect(h.renderedProps()).toBeUndefined();
  });
});

describe('runLaunch (TTY / Ink mode)', () => {
  it('renders the app with cwd loaded, startup logs buffered, and closes the server on quit', async () => {
    const h = makeHarness({ isTTY: true });
    const code = await runLaunch(OPTS, h.deps);
    expect(code).toBe(0);
    const props = h.renderedProps();
    expect(props).toBeDefined();
    expect(props?.url).toBe(URL);
    expect(props?.initialList.instances).toEqual([
      { root: h.cwd, name: path.basename(h.cwd), loaded: true, agentCount: 2, findingCount: 3 },
    ]);
    expect(props?.initialLogs.map((e) => e.text)).toEqual([
      expect.stringContaining('LOG '),
      `SIGNAL ACQUIRED · ${URL}`,
      '2 AGENTS · 3 FINDINGS',
      `OPEN ${URL}`,
    ]);
    expect(h.close).toHaveBeenCalledTimes(1);
    // Startup lines go to the log pane + disk, not raw stdout (no plain dump under Ink).
    expect(h.stdout()).toBe('');
  });

  it('respects NO_COLOR', async () => {
    const h = makeHarness({ isTTY: true });
    h.deps.env = { ...h.deps.env, NO_COLOR: '1' };
    await runLaunch(OPTS, h.deps);
    expect(h.renderedProps()?.colors).toBe(false);
  });

  it('--detach leaves the server running after quit and prints where it lives', async () => {
    const h = makeHarness({ isTTY: true });
    const code = await runLaunch({ open: true, detach: true }, h.deps);
    expect(code).toBe(0);
    expect(h.close).not.toHaveBeenCalled();
    expect(h.stdout()).toContain(`DETACHED · SERVER LIVE · ${URL}`);
  });

  it('a UI crash exits 1, prints the log path, and still closes the server', async () => {
    const h = makeHarness({
      isTTY: true,
      renderApp: async () => {
        throw new Error('render exploded');
      },
    });
    const code = await runLaunch(OPTS, h.deps);
    expect(code).toBe(1);
    expect(h.stderr()).toContain('render exploded');
    expect(h.stderr()).toContain('LOG ');
    expect(h.close).toHaveBeenCalledTimes(1);
    const logFile = path.join(h.logDir, '2026-07-26T12-00-00.log');
    expect(fs.readFileSync(logFile, 'utf-8')).toContain('UI CRASHED · render exploded');
  });

  it('addFolder validates directories and scanFolder surfaces discovery hits', async () => {
    const other = makeTempDir();
    const h = makeHarness({ isTTY: true, discover: () => [other] });
    await runLaunch(OPTS, h.deps);
    const props = h.renderedProps();
    expect(props?.addFolder(other)).toEqual({ ok: true, root: other, message: `ADDED ${other}` });
    expect(props?.addFolder(path.join(other, 'missing')).ok).toBe(false);
    expect(props?.scanFolder(other)).toEqual({
      ok: true,
      hits: [other],
      message: `SCAN ${other} · 1 HIT`,
    });
  });
});

describe('workspace persistence (agentconfig-gxo.6)', () => {
  const workspaceFile = (stateDir: string) => path.join(stateDir, 'workspace.json');

  it('records cwd in workspace.json on launch', async () => {
    const h = makeHarness();
    await runLaunch(OPTS, h.deps);
    const ws = loadWorkspace(workspaceFile(h.stateDir));
    expect(ws.instances.map((e) => e.root)).toEqual([h.cwd]);
    expect(ws.instances[0]!.addedAt).toBe('2026-07-26T12:00:00.000Z');
  });

  it('restores persisted roots as lazy instances and seeds them into the server', async () => {
    const other = makeTempDir();
    const h = makeHarness({ isTTY: true });
    // Pre-seed the workspace with cwd + another root.
    saveWorkspace(workspaceFile(h.stateDir), {
      version: 1,
      instances: [
        { root: h.cwd, addedAt: '2026-01-01T00:00:00.000Z' },
        { root: other, addedAt: '2026-01-02T00:00:00.000Z' },
      ],
    });
    await runLaunch(OPTS, h.deps);

    // cwd loaded eagerly; the restored root follows as a lazy (○) instance.
    const list = h.renderedProps()?.initialList;
    expect(list?.instances.map((i) => i.root)).toEqual([h.cwd, other]);
    expect(list?.instances[0]?.loaded).toBe(true);
    expect(list?.instances[1]?.loaded).toBe(false);
    // The one server process is seeded with the restored root.
    expect(h.serverInstances()).toEqual([other]);
  });

  it('does not seed a persisted root that duplicates cwd', async () => {
    const h = makeHarness();
    saveWorkspace(workspaceFile(h.stateDir), {
      version: 1,
      instances: [{ root: h.cwd, addedAt: '2026-01-01T00:00:00.000Z' }],
    });
    await runLaunch(OPTS, h.deps);
    expect(h.serverInstances()).toEqual([]);
  });

  it('addFolder persists the added folder for the next launch', async () => {
    const other = makeTempDir();
    const h = makeHarness({ isTTY: true });
    await runLaunch(OPTS, h.deps);
    const result = h.renderedProps()?.addFolder(other);
    expect(result?.ok).toBe(true);
    const ws = loadWorkspace(workspaceFile(h.stateDir));
    expect(ws.instances.map((e) => e.root)).toEqual([h.cwd, other]);
  });

  it('a corrupt workspace.json degrades to just cwd, no crash', async () => {
    const h = makeHarness();
    fs.mkdirSync(h.stateDir, { recursive: true });
    fs.writeFileSync(workspaceFile(h.stateDir), '{ not json ]');
    const code = await runLaunch(OPTS, h.deps);
    expect(code).toBe(0);
    expect(loadWorkspace(workspaceFile(h.stateDir)).instances.map((e) => e.root)).toEqual([h.cwd]);
  });
});

describe('buildOpenCommand', () => {
  it('maps platforms to their opener', () => {
    expect(buildOpenCommand('darwin', URL)).toEqual({ cmd: 'open', args: [URL] });
    expect(buildOpenCommand('linux', URL)).toEqual({ cmd: 'xdg-open', args: [URL] });
    expect(buildOpenCommand('win32', URL)).toEqual({
      cmd: 'cmd',
      args: ['/c', 'start', '', URL],
    });
  });
});
