/**
 * Settings (route `#/settings`, bead agentconfig-wmc.2, Console E13.4).
 * Top: an EFFECTIVE CONFIG table — every settings.json key across the three
 * scopes with the winning value accented (`.win`), its scope badged, and
 * well-known defaults surfaced with a dashed `s-default` badge. Scope chips +
 * search + a pager keep long key tables navigable. Below: the per-scope
 * visual editors (shared/git-tracked, local/gitignored, and the global
 * ~/.claude/settings.json when that home is registered) and the storage
 * breakdown with recoverable, allowlisted cleanup.
 *
 * Every save routes through the reusable write flow (dry-run diff → commit)
 * and every committed mutation confirms via toast (§5). Panel provenance is a
 * SourceBadge (§5: provenance is never implicit).
 *
 * DATA-SAFETY (redaction-save trap): GET /api/file returns REDACTED content, so
 * a settings.json whose values include secrets arrives with `[REDACTED:*]`
 * placeholders. Saving that back would overwrite the real secrets — so such a
 * file is rendered strictly READ-ONLY (see ScopePanel / model.ts). All config
 * content is adversarial data and is rendered as TEXT nodes only.
 *
 * CLIENT SEAM: the storage endpoints are not on the shell's app-state value, and
 * the shell keeps its client private. Following the Instances page, this page
 * captures the launch token at module load and builds its own ApiClient for
 * getStorage / cleanupStorage. Config WRITES still go through useWriteFlow (the
 * shell's guarded write path); reads go through useAppState().getFile.
 */

import { useCallback, useEffect, useMemo, useState } from 'react';
import { ApiClient, ApiError, type FileContent, type StorageReport } from '../api/index.js';
import { bootstrapToken } from '../api/token.js';
import {
  ChipRow,
  EmptyState,
  Pager,
  SearchInput,
  SourceBadge,
  formatBytes,
  useToast,
} from '../components/core/index.js';
import { useAppState } from '../state/index.js';
import { useWriteFlow, WriteFlow } from '../write/index.js';
import {
  effectiveRows,
  filterRows,
  type EffectiveRow,
  type EffectiveScope,
} from './settings/effective.js';
import { parseSettings } from './settings/model.js';
import { ScopePanel, type LoadStatus } from './settings/ScopePanel.js';
import { StoragePanel } from './settings/StoragePanel.js';
import './settings.css';

const bootToken = typeof window !== 'undefined' ? bootstrapToken() : undefined;

interface PanelState {
  status: LoadStatus;
  file?: FileContent;
  errMsg?: string;
  path?: string;
}

/** Load one config file through the shell's guarded reader, mapping failures to
 *  a panel status (404 → missing, so the panel can offer to CREATE it). */
async function loadOne(
  getFile: (path: string) => Promise<FileContent>,
  path: string,
): Promise<PanelState> {
  try {
    const file = await getFile(path);
    return { status: 'ok', file, path };
  } catch (err) {
    if (err instanceof ApiError) {
      if (err.kind === 'notfound') return { status: 'missing', path };
      if (err.kind === 'forbidden')
        return { status: 'error', path, errMsg: 'out of scope for this session' };
      if (err.kind === 'unauthorized')
        return { status: 'error', path, errMsg: 'session expired — reopen from the CLI' };
      if (err.kind === 'network')
        return { status: 'error', path, errMsg: 'cannot reach the local server' };
    }
    return { status: 'error', path, errMsg: 'could not load' };
  }
}

function storageError(err: unknown): string {
  if (err instanceof ApiError) {
    if (err.kind === 'notfound') return 'unknown instance';
    if (err.kind === 'unauthorized') return 'session expired — reopen from the CLI';
    if (err.kind === 'network') return 'cannot reach the local server';
  }
  return 'could not read storage';
}

/** A panel's parsed settings object, for the effective-config merge. Only a
 *  loaded, parseable file contributes; missing/failed scopes contribute
 *  nothing (their column reads —). */
function rawOf(panel: PanelState): Record<string, unknown> | undefined {
  if (panel.status !== 'ok' || !panel.file) return undefined;
  const parsed = parseSettings(panel.file.content);
  return parsed.ok ? parsed.raw : undefined;
}

const SCOPE_CHIPS = [
  { value: 'all', label: 'All scopes' },
  { value: 'global', label: 'Global' },
  { value: 'project', label: 'Project' },
  { value: 'local', label: 'Local' },
  { value: 'default', label: 'Default' },
] as const;

const PAGE_SIZE = 20;

/** One effective-config value cell: `—` when unset, `.win` accent when this
 *  scope's value is the one that wins. */
function ValueCell({ value, wins }: { value?: string; wins: boolean }) {
  if (value === undefined) return <td className="mono muted">—</td>;
  return <td className="mono">{wins ? <span className="win">{value}</span> : value}</td>;
}

function EffectiveTable({ rows }: { rows: EffectiveRow[] }) {
  const [scope, setScope] = useState<'all' | EffectiveScope>('all');
  const [query, setQuery] = useState('');
  const [page, setPage] = useState(1);

  const filtered = useMemo(() => filterRows(rows, scope, query), [rows, scope, query]);
  const pageRows = filtered.slice((page - 1) * PAGE_SIZE, page * PAGE_SIZE);

  return (
    <>
      <div className="toolbar">
        <ChipRow
          options={SCOPE_CHIPS}
          value={scope}
          onChange={(next) => {
            setScope(next as 'all' | EffectiveScope);
            setPage(1);
          }}
          label="Scope filter"
        />
        <SearchInput
          value={query}
          onChange={(next) => {
            setQuery(next);
            setPage(1);
          }}
          placeholder="Filter by key or value…"
        />
        <span className="meta">
          {filtered.length} of {rows.length} settings
        </span>
      </div>
      <div className="table-card">
        <table className="ds-table">
          <thead>
            <tr>
              <th scope="col">Setting</th>
              <th scope="col">Global</th>
              <th scope="col">Project</th>
              <th scope="col">Local</th>
              <th scope="col">Effective</th>
            </tr>
          </thead>
          <tbody>
            {pageRows.length === 0 ? (
              <tr>
                <td colSpan={5} className="muted">
                  {query.trim() !== ''
                    ? `No settings match "${query}".`
                    : 'No settings in this scope.'}
                </td>
              </tr>
            ) : (
              pageRows.map((row) => (
                <tr key={row.key}>
                  <td className="mono">{row.key}</td>
                  <ValueCell value={row.values.global} wins={row.win === 'global'} />
                  <ValueCell value={row.values.project} wins={row.win === 'project'} />
                  <ValueCell value={row.values.local} wins={row.win === 'local'} />
                  <td>
                    <span className="mono win">{row.effective}</span>{' '}
                    <SourceBadge scope={row.win} />
                  </td>
                </tr>
              ))
            )}
          </tbody>
        </table>
      </div>
      <Pager page={page} pageSize={PAGE_SIZE} total={filtered.length} onPage={setPage} />
    </>
  );
}

export function Settings() {
  // Toasts confirm through the shell-level ToastProvider (App.tsx).
  return <SettingsBody />;
}

function SettingsBody() {
  const { currentInstance, getFile } = useAppState();
  const client = useMemo(() => (bootToken ? new ApiClient(bootToken) : undefined), []);
  const flow = useWriteFlow();
  const toast = useToast();
  const instanceId = currentInstance?.id;

  const [reloadKey, setReloadKey] = useState(0);
  const reload = useCallback(() => setReloadKey((k) => k + 1), []);

  const [storage, setStorage] = useState<StorageReport | undefined>();
  const [storageStatus, setStorageStatus] = useState<'loading' | 'ok' | 'error'>('loading');
  const [storageErr, setStorageErr] = useState<string | undefined>();
  const [shared, setShared] = useState<PanelState>({ status: 'loading' });
  const [local, setLocal] = useState<PanelState>({ status: 'loading' });
  const [globalScope, setGlobalScope] = useState<PanelState>({ status: 'loading' });
  const [cleaning, setCleaning] = useState(false);

  useEffect(() => {
    let cancelled = false;
    if (!client) {
      setStorageStatus('error');
      setStorageErr('session token missing');
      return;
    }
    setStorageStatus('loading');
    setShared({ status: 'loading' });
    setLocal({ status: 'loading' });
    setGlobalScope({ status: 'loading' });

    void (async () => {
      let rep: StorageReport | undefined;
      try {
        rep = await client.getStorage(instanceId);
        if (cancelled) return;
        setStorage(rep);
        setStorageStatus('ok');
      } catch (err) {
        if (cancelled) return;
        setStorageStatus('error');
        setStorageErr(storageError(err));
      }

      // Project-scope files anchor to the project scope (relative paths).
      const s = await loadOne(getFile, '.claude/settings.json');
      if (cancelled) return;
      setShared(s);
      const l = await loadOne(getFile, '.claude/settings.local.json');
      if (cancelled) return;
      setLocal(l);

      // Global settings.json — reachable only when a ~/.claude home is registered
      // (its absolute root comes from the storage breakdown; it sits in a global
      // write scope, so getFile can read it).
      const home = rep?.homes.find((h) => h.key === 'global:.claude');
      if (home) {
        const g = await loadOne(getFile, `${home.root}/settings.json`);
        if (cancelled) return;
        setGlobalScope(g);
      } else {
        setGlobalScope({
          status: 'unavailable',
          errMsg: 'no ~/.claude home registered for this instance',
        });
      }
    })();

    return () => {
      cancelled = true;
    };
  }, [client, getFile, instanceId, reloadKey]);

  // A committed save changes disk → refresh the panels so they show the new
  // on-disk state (the write flow itself refetches the report separately), and
  // confirm the mutation via toast (§5).
  useEffect(() => {
    if (flow.phase === 'done') {
      toast(flow.request?.label !== undefined ? `Saved — ${flow.request.label}` : 'Saved');
      reload();
    }
  }, [flow.phase, flow.request, reload, toast]);

  const onSave = useCallback(
    (path: string, content: string, label: string) => {
      flow.begin({ kind: 'file', path, content, label });
    },
    [flow],
  );

  const onCleanup = useCallback(
    async (home: string, name: string) => {
      if (!client) return;
      setCleaning(true);
      try {
        const res = await client.cleanupStorage(home, name, instanceId);
        toast(`Cleaned ${name} · freed ${formatBytes(res.bytes)} · recoverable in trash`);
        reload();
      } catch (err) {
        toast(err instanceof ApiError ? `Cleanup refused (${err.kind})` : 'Cleanup failed');
      } finally {
        setCleaning(false);
      }
    },
    [client, instanceId, reload, toast],
  );

  // Which panel's path the active write flow targets (to lock its save button).
  const activePath =
    flow.phase !== 'idle' && flow.request?.kind === 'file' ? flow.request.path : undefined;

  // Effective-config merge over whatever scopes have loaded + parsed.
  const rows = useMemo(
    () =>
      effectiveRows({
        global: rawOf(globalScope),
        project: rawOf(shared),
        local: rawOf(local),
      }),
    [globalScope, shared, local],
  );

  return (
    <main className="layout-main page">
      <div className="page-head">
        <div>
          <h1>Settings</h1>
          <p className="page-sub">
            Every key across scopes, with the winning value highlighted. Precedence: local overrides
            project overrides global.
            {currentInstance ? ` Instance: ${currentInstance.name}.` : ''}
          </p>
        </div>
      </div>

      {flow.phase !== 'idle' && <WriteFlow flow={flow} />}

      <EffectiveTable rows={rows} />

      <h2 className="table-header settings__section-title">EDIT BY SCOPE</h2>
      <div className="settings__grid">
        <ScopePanel
          title="settings.json"
          scope="project"
          detail="git-tracked"
          path={shared.path ?? '.claude/settings.json'}
          status={shared.status}
          file={shared.file}
          errMsg={shared.errMsg}
          onSave={onSave}
          saving={activePath === (shared.path ?? '.claude/settings.json')}
        />
        <ScopePanel
          title="settings.local.json"
          scope="local"
          detail="gitignored"
          path={local.path ?? '.claude/settings.local.json'}
          status={local.status}
          file={local.file}
          errMsg={local.errMsg}
          onSave={onSave}
          saving={activePath === (local.path ?? '.claude/settings.local.json')}
        />
      </div>
      <ScopePanel
        title="~/.claude/settings.json"
        scope="global"
        detail="all projects"
        path={globalScope.path}
        status={globalScope.status}
        file={globalScope.file}
        errMsg={globalScope.errMsg}
        onSave={onSave}
        saving={activePath !== undefined && activePath === globalScope.path}
      />

      <h2 className="table-header settings__section-title">STORAGE · DISK USAGE</h2>
      {storageStatus === 'error' && !storage ? (
        <EmptyState instruction={storageErr ?? 'could not read storage'} />
      ) : (
        <StoragePanel
          report={storage}
          status={storageStatus}
          errMsg={storageErr}
          onCleanup={(home, name) => void onCleanup(home, name)}
          busy={cleaning}
        />
      )}
    </main>
  );
}
