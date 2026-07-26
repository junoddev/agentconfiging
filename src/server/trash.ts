/**
 * trash — recoverable deletes for the WRITE API (SPEC §4.3, bead
 * agentconfig-gxo.3). Deletes NEVER hard-unlink: the file is MOVED into a
 * per-delete trash directory
 *
 *     <trashDir>/<timestamp>-<rand>/<relPath>
 *
 * alongside a `METADATA.json` recording the original absolute path, so a user
 * can recover the file. `<trashDir>` defaults to
 * `~/.local/state/agentconfiging/trash` (XDG_STATE_HOME honored).
 *
 * The per-delete directory carries a random suffix so two deletes in the same
 * millisecond never collide.
 */

import crypto from 'node:crypto';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

export interface TrashResult {
  /** Original absolute location the file was moved FROM. */
  originalPath: string;
  /** Scope-relative path (for display). */
  relPath: string;
  /** Absolute location the file was moved TO (recover from here). */
  trashedTo: string;
  trashedAt: string;
}

/** Default trash root: `$XDG_STATE_HOME/agentconfiging/trash` or `~/.local/state/...`. */
export function defaultTrashDir(): string {
  const stateHome = process.env['XDG_STATE_HOME'] || path.join(os.homedir(), '.local', 'state');
  return path.join(stateHome, 'agentconfiging', 'trash');
}

/** Move `absPath` to the trash; returns where it went. Never hard-deletes. */
export function trashFile(absPath: string, relPath: string, trashDir: string): TrashResult {
  const trashedAt = new Date().toISOString();
  const stamp = `${trashedAt.replace(/[:.]/g, '-')}-${crypto.randomBytes(3).toString('hex')}`;
  const bucket = path.join(trashDir, stamp);
  const dest = path.join(bucket, relPath);

  fs.mkdirSync(path.dirname(dest), { recursive: true });
  try {
    fs.renameSync(absPath, dest);
  } catch (err) {
    // Cross-device (trash on a different mount than the file): copy then unlink.
    if ((err as NodeJS.ErrnoException).code === 'EXDEV') {
      fs.copyFileSync(absPath, dest);
      fs.unlinkSync(absPath);
    } else {
      throw err;
    }
  }

  fs.writeFileSync(
    path.join(bucket, 'METADATA.json'),
    JSON.stringify({ originalPath: absPath, relPath, trashedAt }, null, 2),
  );

  return { originalPath: absPath, relPath, trashedTo: dest, trashedAt };
}
