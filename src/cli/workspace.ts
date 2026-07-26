/**
 * Workspace persistence (SPEC §4.2, agentconfig-gxo.6) — the instance list
 * survives across launches. On disk at
 * `~/.local/state/agentconfiging/workspace.json`, so the next launch restores
 * the same roots (all lazy/unloaded — restoring never scans).
 *
 * Path resolution mirrors logs.ts's env-override convention:
 *   AGENTCONFIGING_STATE_DIR  overrides the state dir outright, then
 *   $XDG_STATE_HOME/agentconfiging, then ~/.local/state/agentconfiging.
 * workspace.json lives directly in that dir.
 *
 * ADVERSARIAL-DATA DISCIPLINE: the file is local + 0600, but a corrupt or
 * hand-mangled file must never crash launch. A missing file, non-JSON, or a
 * wrong-shaped payload all degrade to an EMPTY list — load never throws. The
 * list is capped (MAX_WORKSPACE_INSTANCES) on both read and write so a
 * runaway file can't grow unbounded.
 *
 * Path resolution + the pure add/remove transitions have no I/O; only
 * loadWorkspace/saveWorkspace touch the filesystem.
 */

import fs from 'node:fs';
import path from 'node:path';

/** One persisted instance: its root and when it was first added. */
export interface WorkspaceEntry {
  root: string;
  addedAt: string;
}

export interface Workspace {
  version: number;
  instances: WorkspaceEntry[];
}

export const WORKSPACE_VERSION = 1;

/** Cap on persisted instances — bounds a corrupt/runaway file. */
export const MAX_WORKSPACE_INSTANCES = 128;

/** The `.local/state/agentconfiging` dir (or its overrides). See module header. */
export function resolveStateDir(env: Record<string, string | undefined>, homeDir: string): string {
  const override = env['AGENTCONFIGING_STATE_DIR'];
  if (override !== undefined && override.trim() !== '') return path.resolve(override);
  const xdg = env['XDG_STATE_HOME'];
  const stateHome =
    xdg !== undefined && xdg.trim() !== '' ? xdg : path.join(homeDir, '.local', 'state');
  return path.join(stateHome, 'agentconfiging');
}

/** Absolute path of workspace.json. */
export function resolveWorkspacePath(
  env: Record<string, string | undefined>,
  homeDir: string,
): string {
  return path.join(resolveStateDir(env, homeDir), 'workspace.json');
}

function emptyWorkspace(): Workspace {
  return { version: WORKSPACE_VERSION, instances: [] };
}

/**
 * Read + validate workspace.json. Missing file, invalid JSON, or a malformed
 * payload all yield an empty workspace — never a throw. Entries are validated
 * one-by-one (bad ones dropped), deduped on `root`, and capped.
 */
export function loadWorkspace(filePath: string): Workspace {
  let raw: string;
  try {
    raw = fs.readFileSync(filePath, 'utf-8');
  } catch {
    return emptyWorkspace(); // missing / unreadable
  }
  let parsed: unknown;
  try {
    parsed = JSON.parse(raw);
  } catch {
    return emptyWorkspace(); // corrupt JSON
  }
  if (parsed === null || typeof parsed !== 'object') return emptyWorkspace();
  const rawInstances = (parsed as { instances?: unknown }).instances;
  if (!Array.isArray(rawInstances)) return emptyWorkspace();

  const instances: WorkspaceEntry[] = [];
  const seen = new Set<string>();
  for (const item of rawInstances) {
    if (item === null || typeof item !== 'object') continue;
    const root = (item as { root?: unknown }).root;
    if (typeof root !== 'string' || root.trim() === '' || seen.has(root)) continue;
    const addedAtRaw = (item as { addedAt?: unknown }).addedAt;
    const addedAt = typeof addedAtRaw === 'string' ? addedAtRaw : new Date(0).toISOString();
    seen.add(root);
    instances.push({ root, addedAt });
    if (instances.length >= MAX_WORKSPACE_INSTANCES) break;
  }
  return { version: WORKSPACE_VERSION, instances };
}

/**
 * Write workspace.json (0600 — it lists local paths). Creates the state dir
 * eagerly and caps the list. Throws on a genuine I/O failure; callers wrap
 * this so a read-only state dir degrades to a warning, never a crash.
 */
export function saveWorkspace(filePath: string, workspace: Workspace): void {
  fs.mkdirSync(path.dirname(filePath), { recursive: true });
  const payload: Workspace = {
    version: WORKSPACE_VERSION,
    instances: workspace.instances.slice(0, MAX_WORKSPACE_INSTANCES),
  };
  fs.writeFileSync(filePath, `${JSON.stringify(payload, null, 2)}\n`, { mode: 0o600 });
  fs.chmodSync(filePath, 0o600); // enforce past a permissive umask
}

/** Add a root (pure); no-op when already present. Newest additions are capped out. */
export function addWorkspaceRoot(workspace: Workspace, root: string, addedAt: Date): Workspace {
  if (workspace.instances.some((e) => e.root === root)) return workspace;
  const instances = [...workspace.instances, { root, addedAt: addedAt.toISOString() }].slice(
    0,
    MAX_WORKSPACE_INSTANCES,
  );
  return { version: WORKSPACE_VERSION, instances };
}

/** Remove a root (pure); no-op when absent. */
export function removeWorkspaceRoot(workspace: Workspace, root: string): Workspace {
  const instances = workspace.instances.filter((e) => e.root !== root);
  return { version: WORKSPACE_VERSION, instances };
}
