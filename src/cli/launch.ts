/**
 * Launch flow — the default `agentconfiging` command (SPEC §5 row 24,
 * DESIGN §8): start the local server over cwd, open the browser, and run
 * the Ink app (TTY) or plain line output (piped / non-TTY).
 *
 * Every collaborator is injectable for tests: server factory (the real
 * `startServer` from src/server is dynamically imported), browser spawner,
 * engine-count loader, recursive discovery, and the Ink renderer. The
 * production wiring is the thin `defaultX` closures at the bottom.
 *
 * First instance = cwd, loaded eagerly for real counts; everything else is
 * lazy (SPEC §4.2). Instances are in-memory this bead — persistence
 * (workspace.json) layers onto the instances.ts model later.
 */

import { spawn } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { buildReport, detect, discoverProjects, scanProject } from '../core/index.js';
import type { AppProps } from './app.js';
import {
  addInstance,
  addInstances,
  createInstanceList,
  markLoaded,
  type InstanceList,
} from './instances.js';
import {
  createFileLogger,
  formatTerminalLine,
  logFileName,
  resolveLogDir,
  type LogEntry,
  type LogLevel,
} from './logs.js';
import type { ReportIo } from './report.js';
import { colorEnabled, resolveRenderMode } from './tty.js';
import {
  addWorkspaceRoot,
  loadWorkspace,
  resolveWorkspacePath,
  saveWorkspace,
  type Workspace,
} from './workspace.js';

/** Contract of src/server startServer (implemented in the server bead). */
export interface ServerHandle {
  url: string;
  port: number;
  token: string;
  close: () => Promise<void>;
}

export interface ServerFactoryOptions {
  root: string;
  /** Extra roots (the restored workspace) to seed as lazy instances. */
  instances?: readonly string[];
  host?: string;
  port?: number;
  distDir?: string;
}

export type ServerFactory = (opts: ServerFactoryOptions) => Promise<ServerHandle>;

export interface LaunchOptions {
  /** Open the browser to the server URL (false with --no-open). */
  open: boolean;
  /** Quitting the UI leaves the server running (--detach). */
  detach: boolean;
}

export interface InstanceCounts {
  agentCount: number;
  findingCount: number;
}

export interface LaunchDeps {
  io: ReportIo;
  serverFactory?: ServerFactory;
  /** Spawns the platform browser opener; injected so tests never spawn. */
  spawnOpen?: (cmd: string, args: readonly string[]) => void;
  /** Runs the Ink app; resolves when the user quits. */
  renderApp?: (props: AppProps) => Promise<void>;
  /** Engine run for the eager cwd instance. */
  loadCounts?: (root: string) => InstanceCounts;
  /** Recursive project discovery for the `s` key; returns hit roots. */
  discover?: (root: string) => string[];
  cwd?: string;
  env?: Record<string, string | undefined>;
  isTTY?: boolean;
  platform?: NodeJS.Platform;
  homeDir?: string;
  now?: () => Date;
}

/** Platform browser-opener command; pure so tests can assert on it. */
export function buildOpenCommand(
  platform: NodeJS.Platform,
  url: string,
): { cmd: string; args: string[] } {
  if (platform === 'darwin') return { cmd: 'open', args: [url] };
  if (platform === 'win32') return { cmd: 'cmd', args: ['/c', 'start', '', url] };
  return { cmd: 'xdg-open', args: [url] };
}

const defaultSpawnOpen = (cmd: string, args: readonly string[]): void => {
  spawn(cmd, [...args], { stdio: 'ignore', detached: true }).unref();
};

const defaultLoadCounts = (root: string): InstanceCounts => {
  const manifest = scanProject(root);
  const agents = detect(manifest);
  const { findings } = buildReport(manifest, agents);
  return { agentCount: agents.length, findingCount: findings.length };
};

const defaultDiscover = (root: string): string[] =>
  discoverProjects(root).hits.map((hit) => hit.root);

const defaultServerFactory: ServerFactory = async (opts) => {
  // Dynamic import + capability check: the server bead lands concurrently,
  // and src/cli must typecheck against the contract, not the module state.
  const serverModule = (await import('../server/index.js')) as Partial<{
    startServer: ServerFactory;
  }>;
  if (typeof serverModule.startServer !== 'function') {
    throw new Error('server unavailable: src/server does not export startServer yet');
  }
  return serverModule.startServer(opts);
};

const defaultRenderApp = async (props: AppProps): Promise<void> => {
  const [{ render }, { App }, { createElement }] = await Promise.all([
    import('ink'),
    import('./app.js'),
    import('react'),
  ]);
  await render(createElement(App, props), { exitOnCtrlC: true }).waitUntilExit();
};

/**
 * Run the launch flow. Resolves with the process exit code once the UI
 * exits (TTY) or once startup completes (non-TTY: the server keeps the
 * process alive until it is closed or the process is signalled).
 */
export async function runLaunch(opts: LaunchOptions, deps: LaunchDeps): Promise<number> {
  const { io } = deps;
  const env = deps.env ?? process.env;
  const cwd = path.resolve(deps.cwd ?? process.cwd());
  const isTTY = deps.isTTY ?? process.stdout.isTTY === true;
  const platform = deps.platform ?? process.platform;
  const now = deps.now ?? (() => new Date());
  const mode = resolveRenderMode(isTTY);
  const colors = colorEnabled(env, isTTY);

  const logPath = path.join(resolveLogDir(env, deps.homeDir ?? os.homedir()), logFileName(now()));
  const logger = createFileLogger(logPath, io.stderr);

  // Startup log lines: to disk always; to stdout in plain mode; buffered as
  // the initial <Static> items in Ink mode so nothing is shown but unlogged.
  const startupLogs: LogEntry[] = [];
  const emit = (level: LogLevel, text: string): void => {
    const entry: LogEntry = { time: now(), level, text };
    logger.append(entry);
    startupLogs.push(entry);
    if (mode === 'plain') io.stdout(`${formatTerminalLine(entry)}\n`);
  };

  emit('info', `LOG ${logPath}`);

  // Restore the persisted instance list (SPEC §4.2): roots come back LAZY —
  // reading workspace.json never scans. Corrupt/missing file → empty list
  // (loadWorkspace never throws). cwd is keyed by its real path so it dedupes
  // against a persisted entry that points at the same folder via a symlink.
  const workspacePath = resolveWorkspacePath(env, deps.homeDir ?? os.homedir());
  let workspace: Workspace = loadWorkspace(workspacePath);
  let realCwd = cwd;
  try {
    realCwd = fs.realpathSync(cwd);
  } catch {
    // cwd off-disk (unusual) — the lexical path is the best key we have.
  }
  const restoredRoots = workspace.instances.map((e) => e.root).filter((r) => r !== realCwd);

  // Persist cwd + the restored list so a fresh launch (empty file) records
  // the current root. A read-only state dir degrades to a warning, not a crash.
  const persistWorkspace = (): void => {
    try {
      saveWorkspace(workspacePath, workspace);
    } catch (err) {
      emit('warn', `WORKSPACE SAVE FAILED · ${err instanceof Error ? err.message : String(err)}`);
    }
  };

  let server: ServerHandle;
  try {
    server = await (deps.serverFactory ?? defaultServerFactory)({
      root: cwd,
      instances: restoredRoots,
    });
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    logger.append({ time: now(), level: 'error', text: `SERVER FAILED · ${message}` });
    io.stderr(`agentconfiging: ${message}\nLOG ${logPath}\n`);
    return 1;
  }

  emit('ok', `SERVER UP · ${server.url}`);

  // First instance = cwd, loaded eagerly so the list shows real counts. The
  // restored roots follow as lazy instances (○, counts unknown until opened).
  let list: InstanceList = addInstance(createInstanceList(), cwd).list;
  list = addInstances(list, restoredRoots).list;
  try {
    const counts = (deps.loadCounts ?? defaultLoadCounts)(cwd);
    list = markLoaded(list, cwd, counts);
    emit(
      'info',
      `${counts.agentCount} AGENT${counts.agentCount === 1 ? '' : 'S'} · ` +
        `${counts.findingCount} FINDING${counts.findingCount === 1 ? '' : 'S'}`,
    );
  } catch (err) {
    emit('warn', `SCAN FAILED · ${err instanceof Error ? err.message : String(err)}`);
  }

  // Record cwd in the persisted list (no-op if already present) and flush.
  workspace = addWorkspaceRoot(workspace, realCwd, now());
  persistWorkspace();

  const spawnOpen = deps.spawnOpen ?? defaultSpawnOpen;
  const openUrl = (): void => {
    const { cmd, args } = buildOpenCommand(platform, server.url);
    spawnOpen(cmd, args);
  };
  if (opts.open) {
    openUrl();
    emit('info', `OPEN ${server.url}`);
  }

  if (mode === 'plain') {
    // No Ink layout when piped: startup lines are out, the server keeps the
    // event loop (and process) alive. Ctrl+C / signals end it.
    return 0;
  }

  const discover = deps.discover ?? defaultDiscover;
  const props: AppProps = {
    url: server.url,
    initialList: list,
    initialLogs: startupLogs,
    colors,
    detach: opts.detach,
    now,
    appendLog: (entry) => logger.append(entry),
    openUrl,
    addFolder: (input) => {
      const requested = path.resolve(cwd, input);
      let root: string;
      try {
        if (!fs.statSync(requested).isDirectory())
          return { ok: false, message: `NOT A FOLDER · ${requested}` };
        // Real path so a symlink dedupes against an already-added instance.
        root = fs.realpathSync(requested);
      } catch {
        return { ok: false, message: `NO SUCH FOLDER · ${requested}` };
      }
      // Persist so the folder returns on the next launch (SPEC §4.2). The
      // running server registry is not mutated here — the web workspace UI
      // (c6p.6, blocked on this bead) drives POST /api/instances for live
      // switching; restore-on-next-launch is what this wiring guarantees.
      workspace = addWorkspaceRoot(workspace, root, now());
      persistWorkspace();
      return { ok: true, root, message: `ADDED ${root}` };
    },
    scanFolder: (input) => {
      const root = path.resolve(cwd, input);
      try {
        const hits = discover(root);
        return {
          ok: true,
          hits,
          message: `SCAN ${root} · ${hits.length} HIT${hits.length === 1 ? '' : 'S'}`,
        };
      } catch (err) {
        const message = err instanceof Error ? err.message : String(err);
        return { ok: false, hits: [], message: `SCAN FAILED · ${message}` };
      }
    },
  };

  try {
    await (deps.renderApp ?? defaultRenderApp)(props);
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    logger.append({ time: now(), level: 'error', text: `UI CRASHED · ${message}` });
    io.stderr(`agentconfiging: ${message}\nLOG ${logPath}\n`);
    await server.close().catch(() => undefined);
    return 1;
  }

  if (opts.detach) {
    io.stdout(`DETACHED · SERVER LIVE · ${server.url}\nLOG ${logPath}\n`);
    return 0;
  }
  await server.close();
  return 0;
}
