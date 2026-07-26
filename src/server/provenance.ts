/**
 * provenance — the CATALOG install manifest (SPEC §4.5, bead agentconfig-0zm.4).
 *
 * This is agentconfig's authoritative, on-disk record of what the catalog
 * install flow wrote: for each installed entry (keyed `<kind>/<name>`) its
 * source, version, install time, and the EXACT project-relative files written.
 * REMOVE reads it to trash only agentconfig-installed files (never a user file);
 * UPGRADE reads it to know what a prior version placed.
 *
 * The manifest lives at `.agentconfig/provenance.json` under the PROJECT scope
 * and is read/written EXCLUSIVELY through the one guarded write primitive
 * (resolveWriteTarget + commitResolved + O_NOFOLLOW), so agentconfig's own
 * bookkeeping file gets the identical scope/symlink protections a config write
 * gets — no second, weaker write path. The manifest is DATA: it is parsed
 * defensively (a corrupt or tampered file degrades to an empty manifest) and is
 * never executed.
 */

import fs from 'node:fs';
import {
  resolveWriteTarget,
  PROVENANCE_MANIFEST_REL,
  type ResolvedTarget,
  type WriteScope,
} from './pathguard.js';
import { commitResolved } from './write.js';

const O_NOFOLLOW = fs.constants.O_NOFOLLOW ?? 0;

/** One installed entry's record — the unit REMOVE and UPGRADE read. */
export interface InstallRecord {
  /** `<kind>/<name>` — matches the catalog entry key. */
  key: string;
  kind: string;
  name: string;
  /** Provenance label components: `installed-by agentconfig from <source>@<version>`. */
  source: string;
  version: string;
  installedAt: string;
  /** Project-relative paths this entry wrote (what REMOVE may trash). */
  files: string[];
}

export interface ProvenanceManifest {
  version: 1;
  installs: Record<string, InstallRecord>;
}

function emptyManifest(): ProvenanceManifest {
  // Null-prototype installs map: a lookup for a special key (`__proto__`,
  // `constructor`, …) resolves to undefined rather than an inherited value.
  return { version: 1, installs: Object.create(null) as Record<string, InstallRecord> };
}

/** Resolve the manifest path through the guard (project scope, allowlisted). */
function resolveManifest(root: string, scopes: WriteScope[]): ResolvedTarget | undefined {
  const projectScopes: WriteScope[] = [
    { root, kind: 'project' },
    ...scopes.filter((s) => s.kind === 'global'),
  ];
  // This is the ONE caller permitted to reach the reserved manifest path; the
  // flag is what unlocks the allowlist entry that every untrusted caller is
  // denied. Scope containment + symlink/O_NOFOLLOW still apply.
  const target = resolveWriteTarget(PROVENANCE_MANIFEST_REL, projectScopes, {
    allowProvenanceManifest: true,
  });
  return target.ok ? target : undefined;
}

/**
 * Read + parse the manifest for an instance. Never throws: an absent, symlinked,
 * oversized, or malformed manifest degrades to an empty manifest so a tampered
 * file can never crash install/remove or smuggle a non-record shape through.
 */
export function readManifest(root: string, scopes: WriteScope[]): ProvenanceManifest {
  const target = resolveManifest(root, scopes);
  if (!target) return emptyManifest();

  let fd: number;
  try {
    fd = fs.openSync(target.absPath, fs.constants.O_RDONLY | O_NOFOLLOW);
  } catch {
    return emptyManifest(); // absent, or a symlinked leaf (TOCTOU) — treat as empty
  }
  let raw: string;
  try {
    raw = fs.readFileSync(fd, 'utf-8');
  } catch {
    return emptyManifest();
  } finally {
    fs.closeSync(fd);
  }
  return parseManifest(raw);
}

/** Defensive parse: only well-formed InstallRecords survive; everything else drops. */
export function parseManifest(raw: string): ProvenanceManifest {
  let json: unknown;
  try {
    json = JSON.parse(raw);
  } catch {
    return emptyManifest();
  }
  if (json === null || typeof json !== 'object' || Array.isArray(json)) return emptyManifest();
  const installsRaw = (json as { installs?: unknown }).installs;
  if (installsRaw === null || typeof installsRaw !== 'object' || Array.isArray(installsRaw)) {
    return emptyManifest();
  }
  const installs: Record<string, InstallRecord> = Object.create(null) as Record<
    string,
    InstallRecord
  >;
  for (const [key, value] of Object.entries(installsRaw as Record<string, unknown>)) {
    const record = asRecord(key, value);
    if (record) installs[key] = record;
  }
  return { version: 1, installs };
}

function asRecord(key: string, value: unknown): InstallRecord | undefined {
  if (value === null || typeof value !== 'object' || Array.isArray(value)) return undefined;
  const v = value as Record<string, unknown>;
  const files = v['files'];
  if (!Array.isArray(files) || !files.every((f) => typeof f === 'string')) return undefined;
  const str = (k: string): string => (typeof v[k] === 'string' ? (v[k] as string) : '');
  return {
    key,
    kind: str('kind'),
    name: str('name'),
    source: str('source'),
    version: str('version'),
    installedAt: str('installedAt'),
    files: files as string[],
  };
}

/** Write the manifest through the one guarded write primitive. */
function writeManifest(root: string, scopes: WriteScope[], manifest: ProvenanceManifest): void {
  const target = resolveManifest(root, scopes);
  if (!target) return; // project scope missing — nothing to record against
  commitResolved(target, JSON.stringify(manifest, null, 2) + '\n');
}

/** Record (or replace) an entry's install record, then persist the manifest. */
export function upsertInstall(root: string, scopes: WriteScope[], record: InstallRecord): void {
  const manifest = readManifest(root, scopes);
  manifest.installs[record.key] = record;
  writeManifest(root, scopes, manifest);
}

/** Drop an entry's install record, then persist the manifest. */
export function removeInstall(root: string, scopes: WriteScope[], key: string): void {
  const manifest = readManifest(root, scopes);
  if (!(key in manifest.installs)) return;
  delete manifest.installs[key];
  writeManifest(root, scopes, manifest);
}
