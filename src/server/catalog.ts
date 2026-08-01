/**
 * catalog — the CATALOG install/remove routes (SPEC §4.5, bead
 * agentconfig-0zm.4). Registered under `/api`, so every route INHERITS the
 * hardened app's gates (Host allowlist, bearer token, same-origin/CSRF). This
 * module adds no gate of its own; it adds the install-time trust boundary that
 * makes writing UNTRUSTED registry content to disk safe once a request is
 * authorized.
 *
 * THE INSTALL SECURITY MODEL — a registry entry is OTHER PEOPLE'S CONFIG; its
 * file paths AND its file contents are untrusted, treated as no more trusted
 * than a user write or an analyzer-emitted fix:
 *
 *  1. PATH GUARD. Every entry file PATH is resolved through resolveWriteTarget
 *     (input discipline, scope containment, `..` traversal, symlink/O_NOFOLLOW,
 *     config allowlist) against the target instance's scopes — exactly the guard
 *     a user write clears. A file whose path escapes scope, traverses, is a
 *     symlink, or is not a known config path REFUSES THE WHOLE INSTALL (403/400)
 *     before anything is written: all-or-nothing, never a partial install.
 *  2. CHECKSUM. Every file's content is sha256-verified by the registry client
 *     (fetchEntryFiles → verifyEntry/fetch-time hash) BEFORE it is written. A
 *     content/sha mismatch throws and the install is refused (422). Registry
 *     content is NEVER executed — it is written as inert config DATA files.
 *  3. PROVENANCE. On install we record `installed-by agentconfig from
 *     <source>@<version>` two ways (see stampProvenance + the manifest below):
 *       - a PROVENANCE MANIFEST (`.agentconfig/provenance.json`, project scope)
 *         is the AUTHORITATIVE record — {entry, source, version, files,
 *         installedAt} — that REMOVE and UPGRADE read. It covers every file
 *         regardless of type and is the single mechanism REMOVE trusts.
 *       - for files that already carry a YAML frontmatter fence (skills,
 *         subagents, commands, .mdc rules) we ALSO stamp an `installed-by:` key
 *         into the frontmatter for in-file, human-visible traceability. This is
 *         a visible marker, not the source of truth; files without frontmatter
 *         (JSON hooks/mcp, plain-markdown rules) rely solely on the manifest.
 *     Provenance is DATA — recorded, shown in the diff, never executed.
 *  4. REMOVE reads the manifest and TRASHES (trashFile — recoverable, never
 *     unlink) exactly the files that manifest recorded as installed-by-agentconfig
 *     for the entry. A file not in the manifest is NEVER touched, so remove can
 *     never trash a user's own file. The manifest itself is written/updated
 *     through the SAME guarded write primitive.
 *
 * WHY METADATA-ONLY CATALOG + ON-DEMAND CONTENT: GET /api/catalog returns only
 * entry METADATA (kind/name/description/version/source/tags + file PATHS) plus
 * the installed record for the resolved instance — never file bodies, which can
 * be large. File CONTENT is fetched+verified lazily by the install flow (which
 * is the only thing that needs the bytes) and disclosed solely as the dry-run
 * unified DIFF the user approves.
 *
 * ERRORS (constant bodies, no path echo): 400 malformed body; 404 unknown
 * instance OR unknown entry OR (for remove) not-installed — indistinguishable,
 * no oracle; 403 an entry file path the guard refuses; 422 a file whose content
 * failed checksum verification.
 */

import type { Hono } from 'hono';
import { CAPS } from '../core/index.js';
import { parseFrontmatter } from '../core/index.js';
import type { RegistryEntry, ResolvedFile } from '../core/index.js';
import { resolveWriteTarget, type ResolvedTarget, type WriteScope } from './pathguard.js';
import { PROVENANCE_MANIFEST_REL } from './pathguard.js';
import type { InstanceRegistry } from './registry.js';
import { jsonError } from './http.js';
import { commitResolved, previewResolved, statFile } from './write.js';
import { trashFile } from './trash.js';
import { readManifest, upsertInstall, removeInstall, type InstallRecord } from './provenance.js';

/**
 * The narrow slice of the registry client the routes depend on. `RegistryClient`
 * (src/core/registry) satisfies it structurally; tests inject a stub so hostile
 * catalog shapes (a malicious file path, a checksum-failing file) can be fired
 * at the real install path.
 */
export interface CatalogSource {
  /** The merged, validated catalog entries (seed ∪ verified overlay). */
  getCatalog(): Promise<RegistryEntry[]>;
  /** Every file of an entry resolved to sha256-VERIFIED bytes; throws on any mismatch. */
  fetchEntryFiles(entry: RegistryEntry): Promise<ResolvedFile[]>;
}

export interface CatalogRoutesConfig {
  scopes: WriteScope[];
  registry: InstanceRegistry;
  /** The catalog source (a RegistryClient in production; a stub in tests). */
  client: CatalogSource;
  /** Where trashed files go on remove (never hard-unlinked). */
  trashDir: string;
}

async function readJsonBody(req: Request): Promise<Record<string, unknown> | undefined> {
  try {
    const body = (await req.json()) as unknown;
    if (body === null || typeof body !== 'object' || Array.isArray(body)) return undefined;
    return body as Record<string, unknown>;
  } catch {
    return undefined;
  }
}

/** Stable key for an entry / install record: `<kind>/<name>` (mirrors mergeCatalog). */
function entryKeyOf(entry: RegistryEntry): string {
  return `${entry.kind}/${entry.name}`;
}

/** Metadata-only catalog row — never carries file CONTENT (see module header). */
interface CatalogEntryMeta {
  key: string;
  kind: string;
  name: string;
  description: string;
  version: string;
  source: string;
  tags: string[];
  files: string[];
}

function toMeta(entry: RegistryEntry): CatalogEntryMeta {
  return {
    key: entryKeyOf(entry),
    kind: entry.kind,
    name: entry.name,
    description: entry.description,
    version: entry.version,
    source: entry.source,
    tags: entry.tags,
    files: entry.files.map((f) => f.path),
  };
}

/**
 * Stamp `installed-by agentconfig from <source>@<version>` into a file's YAML
 * frontmatter, when it HAS one. We insert the key just before the closing fence
 * rather than re-serialize the YAML, so existing keys/order/formatting are left
 * untouched (never corrupt a hand-authored block). Files with no frontmatter are
 * returned unchanged — their provenance lives in the manifest. The bytes were
 * already checksum-verified before this runs; the stamp is an intentional,
 * diff-visible addition on top of the verified payload.
 */
export function stampProvenance(content: string, source: string, version: string): string {
  const fm = parseFrontmatter(content);
  if (!fm.hasFrontmatter) return content;
  const line = `installed-by: agentconfig from ${source}@${version}`;
  const lines = content.replace(/\r\n/g, '\n').split('\n');
  // lines[0] is the opening `---`; find the FIRST closing fence after it.
  for (let i = 1; i < lines.length; i += 1) {
    const trimmed = (lines[i] ?? '').trim();
    if (trimmed === '---' || trimmed === '...') {
      lines.splice(i, 0, line);
      return lines.join('\n');
    }
  }
  // Unterminated fence (parseFrontmatter would have flagged it) — leave as-is.
  return content;
}

/** One file's dry-run/commit row. Shares the shape; commit adds committed/error. */
interface CatalogFileRow {
  path: string;
  pathScope: string;
  willCreate: boolean;
  willModify: boolean;
  /** Unified diff of the provenance-stamped content that would land. Text only. */
  diff: string;
  committed?: boolean;
  error?: string;
}

/** A guard-resolved install file paired with the exact bytes to write. */
interface PlannedFile {
  resolved: ResolvedTarget;
  /** Provenance-stamped, checksum-verified content. */
  content: string;
  row: CatalogFileRow;
}

export function registerCatalogRoutes(app: Hono, config: CatalogRoutesConfig): void {
  const { scopes, registry, client, trashDir } = config;
  const globalScopes = scopes.filter((s) => s.kind === 'global');

  const instanceScopesFor = (root: string): WriteScope[] => [
    { root, kind: 'project' },
    ...globalScopes,
  ];

  // GET /api/catalog[?instance=] — metadata for every catalog entry PLUS the
  // installed record for the resolved instance (so the UI shows INSTALL vs
  // REMOVE). No file CONTENT is ever included here.
  app.get('/api/catalog', async (c) => {
    const instanceSel = new URL(c.req.url).searchParams.get('instance') ?? undefined;
    const instance = registry.resolve(instanceSel);
    if (!instance) return jsonError(404, 'not found');
    let entries: RegistryEntry[];
    try {
      entries = await client.getCatalog();
    } catch (err) {
      console.error(`agentconfiging server: catalog load failed: ${String(err)}`);
      return jsonError(500, 'catalog failed');
    }
    const manifest = readManifest(instance.root, scopes);
    return c.json({
      entries: entries.map(toMeta),
      installed: Object.values(manifest.installs),
    });
  });

  // POST /api/catalog/install {entryKey, instance?, dryRun?}
  app.post('/api/catalog/install', async (c) => {
    const body = await readJsonBody(c.req.raw);
    if (!body) return jsonError(400, 'bad request');
    const { entryKey, instance: instanceSel, dryRun } = body;
    if (typeof entryKey !== 'string' || entryKey === '') return jsonError(400, 'bad request');
    if (instanceSel !== undefined && typeof instanceSel !== 'string')
      return jsonError(400, 'bad request');
    if (dryRun !== undefined && typeof dryRun !== 'boolean') return jsonError(400, 'bad request');

    const instance = registry.resolve(instanceSel ?? undefined);
    if (!instance) return jsonError(404, 'not found');

    // Resolve the entry from the (validated) catalog. Unknown key → 404.
    let entry: RegistryEntry | undefined;
    try {
      entry = (await client.getCatalog()).find((e) => entryKeyOf(e) === entryKey);
    } catch (err) {
      console.error(`agentconfiging server: catalog load failed: ${String(err)}`);
      return jsonError(500, 'catalog failed');
    }
    if (!entry) return jsonError(404, 'not found');

    // CHECKSUM GATE — verify + resolve every file's bytes BEFORE any write. A
    // mismatch (or a failed fetch) refuses the whole install; nothing lands.
    let files: ResolvedFile[];
    try {
      files = await client.fetchEntryFiles(entry);
    } catch {
      return jsonError(422, 'unverified content');
    }

    const scopesForInstance = instanceScopesFor(instance.root);

    // PATH GUARD + PREVIEW every file BEFORE writing any: a single out-of-scope,
    // traversing, symlinked, non-config, or oversized file path refuses the whole
    // install (all-or-nothing — no partial write is ever left behind).
    const planned: PlannedFile[] = [];
    for (const file of files) {
      const stamped = stampProvenance(file.content, entry.source, entry.version);
      if (Buffer.byteLength(stamped, 'utf-8') > CAPS.maxFileBytes)
        return jsonError(400, 'bad request');
      const target = resolveWriteTarget(file.path, scopesForInstance);
      if (!target.ok)
        return jsonError(target.status, target.status === 400 ? 'bad request' : 'forbidden');
      // Entry files may NEVER target agentconfig's reserved provenance namespace:
      // a hostile entry that wrote `.agentconfig/provenance.json` directly could
      // forge an install record and make REMOVE trash a victim's never-installed
      // file. The path guard already denies this to entry resolution (only the
      // provenance writer unlocks it); this is the explicit second layer.
      if (target.relPath === PROVENANCE_MANIFEST_REL || target.relPath.startsWith('.agentconfig/'))
        return jsonError(403, 'forbidden');
      const preview = previewResolved(target, stamped);
      if ('refuse' in preview) return jsonError(403, 'forbidden');
      planned.push({
        resolved: target,
        content: stamped,
        row: {
          path: target.relPath,
          pathScope: target.scope.kind,
          willCreate: preview.willCreate,
          willModify: preview.willModify,
          diff: preview.diff,
        },
      });
    }

    if (dryRun !== false) {
      return c.json({
        dryRun: true,
        entryKey,
        files: planned.map((p) => p.row),
        provenance: {
          path: PROVENANCE_MANIFEST_REL,
          note: `installed-by agentconfig from ${entry.source}@${entry.version}`,
        },
      });
    }

    // COMMIT: write each file through the guarded primitive. All were previewed
    // clean above, so a failure here is only a TOCTOU symlink swap (ELOOP) → 403.
    for (const p of planned) {
      try {
        commitResolved(p.resolved, p.content);
        p.row.committed = true;
      } catch (err) {
        if ((err as NodeJS.ErrnoException).code === 'ELOOP') return jsonError(403, 'forbidden');
        throw err;
      }
    }

    // Record provenance through the SAME guarded write primitive. This is the
    // authoritative record REMOVE/UPGRADE read.
    const record: InstallRecord = {
      key: entryKey,
      kind: entry.kind,
      name: entry.name,
      source: entry.source,
      version: entry.version,
      installedAt: new Date().toISOString(),
      files: planned.map((p) => p.row.path),
    };
    upsertInstall(instance.root, scopes, record);

    // Disk changed → drop the cached report so the next fetch re-scans.
    try {
      registry.load(instance).invalidate('project');
    } catch {
      // Non-fatal to the install that already landed.
    }

    return c.json({ committed: true, entryKey, files: planned.map((p) => p.row) });
  });

  // POST /api/catalog/remove {entryKey, instance?, dryRun?}
  app.post('/api/catalog/remove', async (c) => {
    const body = await readJsonBody(c.req.raw);
    if (!body) return jsonError(400, 'bad request');
    const { entryKey, instance: instanceSel, dryRun } = body;
    if (typeof entryKey !== 'string' || entryKey === '') return jsonError(400, 'bad request');
    if (instanceSel !== undefined && typeof instanceSel !== 'string')
      return jsonError(400, 'bad request');
    if (dryRun !== undefined && typeof dryRun !== 'boolean') return jsonError(400, 'bad request');

    const instance = registry.resolve(instanceSel ?? undefined);
    if (!instance) return jsonError(404, 'not found');

    const manifest = readManifest(instance.root, scopes);
    // Object.hasOwn (not a bare index) so a prototype-inherited key
    // (`__proto__`, `constructor`, `toString`, …) can never resolve to an
    // inherited value that slips past this guard and later crashes on
    // record.files. Unknown / special key → 404, same as any not-installed entry.
    const record = Object.hasOwn(manifest.installs, entryKey)
      ? manifest.installs[entryKey]
      : undefined;
    // Not recorded as installed-by-agentconfig → nothing to remove. We ONLY ever
    // act on manifest-recorded files, so a user file is never trashed.
    if (!record) return jsonError(404, 'not found');

    const scopesForInstance = instanceScopesFor(instance.root);

    // Each recorded file still passes the guard before we touch it; a recorded
    // path that no longer resolves in-scope, or is already gone, is reported and
    // skipped — never trashed blindly.
    const rows = record.files.map((rel) => {
      const target = resolveWriteTarget(rel, scopesForInstance);
      if (!target.ok) return { path: rel, missing: true as const };
      if (!statFile(target.absPath)) return { path: target.relPath, missing: true as const };
      return { path: target.relPath, target } as { path: string; target: ResolvedTarget };
    });

    if (dryRun !== false) {
      return c.json({
        dryRun: true,
        entryKey,
        files: rows.map((r) =>
          'missing' in r ? { path: r.path, missing: true } : { path: r.path, willTrash: true },
        ),
      });
    }

    // COMMIT: trash each present, recorded file (recoverable — never unlink).
    const out = rows.map((r) => {
      if ('missing' in r) return { path: r.path, missing: true };
      const res = trashFile(r.target.absPath, r.target.relPath, trashDir);
      return { path: r.path, trashed: true, trashedTo: res.trashedTo };
    });

    // Drop the entry from the manifest (authoritative record) through the guard.
    removeInstall(instance.root, scopes, entryKey);

    try {
      registry.load(instance).invalidate('project');
    } catch {
      // Non-fatal.
    }

    return c.json({ committed: true, entryKey, files: out });
  });
}
