/** Artifact browser — pure, DOM-free logic for the global (inherited) chip
 *  groups (E12, bead 71h.6). Kept out of the component so the absolute-path
 *  grouping is unit-testable. Global entries carry file paths RELATIVE to their
 *  `root`; the file API (getFile) addresses global files by ABSOLUTE path, so
 *  each chip needs both: `rel` for display under its group heading, `abs` for
 *  selection and fetching. Read-only derivations — no write flow ever sees a
 *  global path. */

import type { GlobalEntry } from '../../api/types.js';
import { joinGlobalPath } from '../../lib/paths.js';

/** One global file: display path (entry-relative) + fetch/selection path. */
export interface GlobalFile {
  rel: string;
  abs: string;
}

/** All files one global config dir contributes, deduplicated across its agents. */
export interface GlobalFileGroup {
  /** Real path of the global config dir (filesystem data — text nodes only). */
  root: string;
  files: GlobalFile[];
}

/** Per-entry chip groups: the union of each entry's agents' files, de-duplicated
 *  and sorted (mirroring the project list's collectFiles). Entries with no
 *  files contribute no group; entry order is preserved. Empty in ⇒ empty out —
 *  no global data leaves the page exactly as it is today. */
export function globalFileGroups(entries: readonly GlobalEntry[]): GlobalFileGroup[] {
  const groups: GlobalFileGroup[] = [];
  for (const entry of entries) {
    const set = new Set<string>();
    for (const agent of entry.agents) for (const file of agent.files) set.add(file);
    if (set.size === 0) continue;
    const files = [...set]
      .sort((a, b) => a.localeCompare(b))
      .map((rel) => ({ rel, abs: joinGlobalPath(entry.root, rel) }));
    groups.push({ root: entry.root, files });
  }
  return groups;
}
