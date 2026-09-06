/**
 * build-seed.ts — regenerate (and verify) src/core/registry/seed/index.json.
 *
 * The seed snapshot is the in-package mirror of what the external
 * `agentconfig-registry` repo publishes (SPEC §4.5 + §5 row 14): a static
 * index.json holding the starter template gallery. The reviewable catalog
 * entries live in catalog.json; this script computes checksums and writes the
 * generated index.json artifact.
 *
 * Every file's sha256 is COMPUTED from its UTF-8 bytes with the same hasher
 * the runtime verifier uses (verifyEntry / sha256Hex from ../verify.ts), so
 * the seed is guaranteed to pass verifyEntry — the seed-integrity test then
 * re-checks that independently.
 *
 * Usage (run from repo root):
 *   npx tsx src/core/registry/seed/build-seed.ts            # write index.json
 *   npx tsx src/core/registry/seed/build-seed.ts --verify   # check it matches
 *
 * All content below is ORIGINAL, clean-room starter config — no secrets, no
 * payload that executes on install (hook/MCP entries are config snippets that
 * a runtime may later run; installing them only writes files).
 */

import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import type { RegistryEntry, RegistryIndex } from '../schema.js';
import { sha256Hex, verifyEntry } from '../verify.js';
import catalogRaw from './catalog.json';

const SEED_DIR = path.dirname(fileURLToPath(import.meta.url));
const INDEX_PATH = path.join(SEED_DIR, 'index.json');

const SEED_VERSION = catalogRaw.version;

const allEntries: RegistryEntry[] = catalogRaw.entries.map((entry) => ({
  ...entry,
  kind: entry.kind as RegistryEntry['kind'],
  files: entry.files.map((file) => ({
    ...file,
    sha256: sha256Hex(file.content),
  })),
}));

function buildIndex(): RegistryIndex {
  return { version: SEED_VERSION, entries: allEntries };
}

function serialize(index: RegistryIndex): string {
  return JSON.stringify(index, null, 2) + '\n';
}

function main(): void {
  const verify = process.argv.includes('--verify');
  const index = buildIndex();
  const text = serialize(index);

  // Self-check: every entry must pass the runtime verifier.
  let integrityFailures = 0;
  for (const e of index.entries) {
    const result = verifyEntry(e);
    if (!result.ok) {
      integrityFailures += 1;
      console.error(`INTEGRITY FAIL: ${e.kind}/${e.name}`, result.mismatches);
    }
  }

  if (verify) {
    const existing = fs.existsSync(INDEX_PATH) ? fs.readFileSync(INDEX_PATH, 'utf8') : null;
    if (existing !== text) {
      console.error(`MISMATCH: ${INDEX_PATH} is stale — rerun without --verify.`);
      process.exit(1);
    }
    if (integrityFailures) process.exit(1);
    console.log(`ok ${index.entries.length} entries verified`);
  } else {
    fs.writeFileSync(INDEX_PATH, text);
    console.log(`wrote ${INDEX_PATH} (${index.entries.length} entries)`);
    if (integrityFailures) process.exit(1);
  }
}

main();
