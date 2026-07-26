#!/usr/bin/env node
/**
 * build-manifests.mjs — regenerate fixtures/manifests/*.json from fixtures/trees/.
 *
 * Each fixture tree under fixtures/trees/<name>/ is walked (dotfiles included),
 * and every file becomes a Manifest entry { path, size, sha256, content? } where
 * size/sha256 are computed from the file's utf-8 bytes. Files listed in a
 * fixture's `noContent` list get their content omitted (size/sha256 still real)
 * to exercise readers that must tolerate content-less entries.
 *
 * Manifest shape (spec §4.1): { root, cwdBasename, files: [...], stats }.
 *
 * Usage:
 *   node fixtures/tools/build-manifests.mjs           # write manifests
 *   node fixtures/tools/build-manifests.mjs --verify  # check manifests match trees
 */

import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import { fileURLToPath } from 'node:url';

const FIXTURES_DIR = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const TREES_DIR = path.join(FIXTURES_DIR, 'trees');
const MANIFESTS_DIR = path.join(FIXTURES_DIR, 'manifests');

/** Fixture table: one manifest per entry. Roots are synthetic (never real machines). */
const FIXTURES = [
  { name: 'claude-basic', root: '/home/user/projects/taskboard' },
  { name: 'cursor-basic', root: '/home/user/projects/storefront' },
  { name: 'copilot-basic', root: '/home/user/projects/billing-service' },
  { name: 'codex-basic', root: '/home/user/projects/data-pipeline' },
  { name: 'codex-global', root: '/home/user/.codex' },
  { name: 'continue-basic', root: '/home/user/projects/mobile-app' },
  { name: 'aider-basic', root: '/home/user/projects/legacy-api' },
  { name: 'gemini-basic', root: '/home/user/projects/ml-notebooks' },
  { name: 'opencode-basic', root: '/home/user/projects/gateway' },
  { name: 'claude-rich', root: '/home/user/projects/orbit' },
  { name: 'multi-runtime', root: '/home/user/projects/checkout' },
  { name: 'negative-plain', root: '/home/user/projects/plainlib', noContent: ['package-lock.json'] },
];

function sha256Hex(buf) {
  return crypto.createHash('sha256').update(buf).digest('hex');
}

function walk(dir, base = dir) {
  const out = [];
  for (const entry of fs.readdirSync(dir, { withFileTypes: true }).sort((a, b) => a.name.localeCompare(b.name))) {
    const abs = path.join(dir, entry.name);
    if (entry.isDirectory()) out.push(...walk(abs, base));
    else if (entry.isFile()) out.push(path.relative(base, abs).split(path.sep).join('/'));
  }
  return out.sort();
}

function buildManifest(fixture) {
  const treeDir = path.join(TREES_DIR, fixture.name);
  const noContent = new Set(fixture.noContent ?? []);
  const files = walk(treeDir).map((rel) => {
    const buf = fs.readFileSync(path.join(treeDir, rel));
    const entry = { path: rel, size: buf.length, sha256: sha256Hex(buf) };
    if (!noContent.has(rel)) entry.content = buf.toString('utf8');
    return entry;
  });
  return {
    root: fixture.root,
    cwdBasename: path.posix.basename(fixture.root),
    files,
    stats: {
      fileCount: files.length,
      totalBytes: files.reduce((n, f) => n + f.size, 0),
    },
  };
}

function main() {
  const verify = process.argv.includes('--verify');
  fs.mkdirSync(MANIFESTS_DIR, { recursive: true });
  let failed = 0;
  for (const fixture of FIXTURES) {
    const manifest = buildManifest(fixture);
    const outPath = path.join(MANIFESTS_DIR, `${fixture.name}.json`);
    const text = JSON.stringify(manifest, null, 2) + '\n';
    if (verify) {
      const existing = fs.existsSync(outPath) ? fs.readFileSync(outPath, 'utf8') : null;
      if (existing !== text) {
        failed += 1;
        console.error(`MISMATCH: ${outPath}`);
      } else {
        // Independently re-check every size/sha256 against the content string.
        const parsed = JSON.parse(existing);
        for (const f of parsed.files) {
          if (f.content !== undefined) {
            const buf = Buffer.from(f.content, 'utf8');
            if (buf.length !== f.size || sha256Hex(buf) !== f.sha256) {
              failed += 1;
              console.error(`INTEGRITY FAIL: ${fixture.name}:${f.path}`);
            }
          }
        }
        console.log(`ok ${fixture.name} (${parsed.files.length} files)`);
      }
    } else {
      fs.writeFileSync(outPath, text);
      console.log(`wrote ${outPath} (${manifest.files.length} files, ${manifest.stats.totalBytes} bytes)`);
    }
  }
  if (verify && failed) process.exit(1);
}

main();
