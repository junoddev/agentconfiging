/**
 * Built-in extension inventory adapters.
 *
 * These adapters are deliberately read-only. Claude's native plugin registry
 * remains owned by the Claude CLI; Codex has no native plugin registry, so its
 * adapter reports the bounded set of Codex configuration artifacts that can be
 * surfaced as extensions without pretending that config files are installable
 * plugins.
 */

import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import type { ClaudeExec, ExecResult, InstalledPlugin } from './marketplace.js';
import { parseInstalled } from './marketplace.js';
import type {
  Extension,
  ExtensionCapabilities,
  ExtensionInventory,
  ExtensionProviderAdapter,
} from './extensions.js';

const DEFAULT_TIMEOUT_MS = 20_000;
const MAX_FILE_BYTES = 64 * 1024;
const MAX_DIRECTORY_ENTRIES = 100;

const READ_ONLY: ExtensionCapabilities = {
  list: true,
  detail: false,
  install: false,
  remove: false,
  update: false,
  enable: false,
  disable: false,
};

const NATIVE_READ_ONLY: ExtensionCapabilities = {
  ...READ_ONLY,
  detail: true,
};

const claudeProvider = {
  id: 'claude',
  displayName: 'Claude Code',
  kind: 'native' as const,
  scopes: ['global', 'project'],
  capabilities: NATIVE_READ_ONLY,
};

export interface ClaudeExtensionAdapterOptions {
  exec?: ClaudeExec;
  timeoutMs?: number;
}

function isMissing(err: unknown): boolean {
  return typeof err === 'object' && err !== null && (err as { code?: unknown }).code === 'ENOENT';
}

function isTimedOut(err: unknown): boolean {
  return typeof err === 'object' && err !== null && (err as { killed?: unknown }).killed === true;
}

function claudeReason(err: unknown): string {
  if (isMissing(err)) return 'claude CLI not found';
  if (isTimedOut(err)) return 'claude CLI timed out';
  return 'claude plugin inventory unavailable';
}

function installedToExtension(plugin: InstalledPlugin): Extension {
  return {
    providerId: 'claude',
    id: plugin.id,
    name: plugin.name,
    version: plugin.version,
    scope: plugin.scope || 'unknown',
    source: plugin.source,
    enabled: true,
    kind: 'native',
  };
}

/** Wraps the existing Claude marketplace implementation without changing its routes. */
export function createClaudeExtensionAdapter(
  options: ClaudeExtensionAdapterOptions = {},
): ExtensionProviderAdapter {
  const exec = options.exec ?? defaultClaudeExec;
  const timeoutMs = options.timeoutMs ?? DEFAULT_TIMEOUT_MS;

  return {
    provider: claudeProvider,
    async listInstalled(): Promise<ExtensionInventory> {
      let result: ExecResult;
      try {
        result = await exec(['plugin', 'list', '--json'], { timeoutMs });
      } catch (error) {
        return { state: 'unavailable', extensions: [], reason: claudeReason(error) };
      }

      let raw: unknown;
      try {
        raw = JSON.parse(result.stdout) as unknown;
      } catch {
        return {
          state: 'unavailable',
          extensions: [],
          reason: 'could not read Claude plugin output',
        };
      }
      const installed = parseInstalled(raw);
      return {
        state: 'supported',
        extensions: installed.map(installedToExtension),
      };
    },
  };
}

const defaultClaudeExec: ClaudeExec = (args, { timeoutMs }) =>
  new Promise<ExecResult>((resolve, reject) => {
    // Imported lazily so consumers that only use the filesystem adapter do not
    // need a second subprocess abstraction. The command and argv remain fixed.
    void import('node:child_process').then(({ execFile }) => {
      execFile(
        'claude',
        args,
        { timeout: timeoutMs, maxBuffer: MAX_FILE_BYTES * 128, windowsHide: true },
        (error, stdout, stderr) => {
          if (error) reject(error);
          else resolve({ stdout, stderr });
        },
      );
    }, reject);
  });

interface CodexExtensionAdapterOptions {
  homeDir?: string;
  projectRoot?: string;
}

interface Candidate {
  absolutePath: string;
  displayPath: string;
  scope: 'global' | 'project';
  kind: 'config' | 'rules';
}

const codexProvider = {
  id: 'codex',
  displayName: 'Codex',
  kind: 'config' as const,
  scopes: ['global', 'project'],
  capabilities: READ_ONLY,
};

function candidate(
  absolutePath: string,
  displayPath: string,
  scope: Candidate['scope'],
  kind: Candidate['kind'],
): Candidate {
  return { absolutePath, displayPath, scope, kind };
}

function fixedCandidates(options: CodexExtensionAdapterOptions): Candidate[] {
  const home = path.resolve(options.homeDir ?? os.homedir());
  const project = options.projectRoot === undefined ? undefined : path.resolve(options.projectRoot);
  const candidates: Candidate[] = [
    candidate(path.join(home, '.codex', 'config.toml'), '~/.codex/config.toml', 'global', 'config'),
    candidate(path.join(home, '.codex', 'AGENTS.md'), '~/.codex/AGENTS.md', 'global', 'config'),
  ];
  if (project !== undefined) {
    candidates.push(
      candidate(path.join(project, 'codex.toml'), 'codex.toml', 'project', 'config'),
      candidate(path.join(project, 'AGENTS.md'), 'AGENTS.md', 'project', 'config'),
      candidate(
        path.join(project, '.codex', 'config.toml'),
        '.codex/config.toml',
        'project',
        'config',
      ),
    );
  }
  return candidates;
}

async function safeRegularFile(filePath: string): Promise<boolean> {
  try {
    const stat = await fs.lstat(filePath);
    return stat.isFile() && stat.size <= MAX_FILE_BYTES;
  } catch {
    return false;
  }
}

async function listRuleFiles(root: string, scope: Candidate['scope']): Promise<Candidate[]> {
  const rulesRoot = path.join(root, '.codex', 'rules');
  let entries: import('node:fs').Dirent[];
  try {
    entries = await fs.readdir(rulesRoot, { withFileTypes: true });
  } catch {
    return [];
  }
  return entries
    .slice(0, MAX_DIRECTORY_ENTRIES)
    .filter((entry) => entry.isFile() && entry.name.endsWith('.rules'))
    .map((entry) =>
      candidate(
        path.join(rulesRoot, entry.name),
        scope === 'global' ? `~/.codex/rules/${entry.name}` : `.codex/rules/${entry.name}`,
        scope,
        'rules',
      ),
    );
}

/** Read-only Codex adapter: config artifacts are inventory items, not plugins. */
export function createCodexExtensionAdapter(
  options: CodexExtensionAdapterOptions = {},
): ExtensionProviderAdapter {
  return {
    provider: codexProvider,
    async listInstalled(): Promise<ExtensionInventory> {
      const home = path.resolve(options.homeDir ?? os.homedir());
      const project =
        options.projectRoot === undefined ? undefined : path.resolve(options.projectRoot);
      const candidates = fixedCandidates(options);
      candidates.push(...(await listRuleFiles(home, 'global')));
      if (project !== undefined) candidates.push(...(await listRuleFiles(project, 'project')));

      const extensions: Extension[] = [];
      for (const item of candidates) {
        if (!(await safeRegularFile(item.absolutePath))) continue;
        extensions.push({
          providerId: 'codex',
          id: `codex:${item.displayPath}`,
          name: path.basename(item.absolutePath),
          version: '',
          scope: item.scope,
          source: item.displayPath,
          enabled: true,
          kind: item.kind,
          path: item.absolutePath,
        });
      }

      return extensions.length > 0
        ? { state: 'detected', extensions }
        : { state: 'unavailable', extensions: [], reason: 'Codex configuration not found' };
    },
  };
}

export interface BuiltInExtensionAdaptersOptions extends ClaudeExtensionAdapterOptions {
  homeDir?: string;
  projectRoot?: string;
}

export function createBuiltInExtensionAdapters(
  options: BuiltInExtensionAdaptersOptions = {},
): readonly ExtensionProviderAdapter[] {
  return [createClaudeExtensionAdapter(options), createCodexExtensionAdapter(options)];
}
