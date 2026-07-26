/**
 * PATH env bag collection — the CALLER side of the analyzers' env-bag
 * contract (src/core/report.ts `AnalyzerEnv`). Core stays pure; this module
 * does the actual filesystem probing and lives in src/cli on purpose.
 */

import fs from 'node:fs';
import path from 'node:path';

/** Directories with more entries than this are skipped (work cap). */
export const MAX_PATH_DIR_ENTRIES = 5000;

/**
 * Executable names (bare, no directories) found across the PATH entries.
 * Unreadable directories are tolerated silently; oversized directories are
 * skipped entirely. Deterministic: deduped and sorted.
 */
export function collectPathCommands(pathEnv: string | undefined): string[] {
  const names = new Set<string>();
  const dirs = new Set((pathEnv ?? '').split(path.delimiter).filter(Boolean));

  for (const dir of dirs) {
    let entries: fs.Dirent[];
    try {
      entries = fs.readdirSync(dir, { withFileTypes: true });
    } catch {
      continue;
    }
    if (entries.length > MAX_PATH_DIR_ENTRIES) continue;

    for (const entry of entries) {
      if (!entry.isFile() && !entry.isSymbolicLink()) continue;
      try {
        fs.accessSync(path.join(dir, entry.name), fs.constants.X_OK);
      } catch {
        continue;
      }
      names.add(entry.name);
    }
  }

  return [...names].sort();
}
