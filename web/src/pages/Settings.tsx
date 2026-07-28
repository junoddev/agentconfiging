/**
 * Settings (rail `06 SETTINGS`, DESIGN §6 / SPEC §5 row 2, bead agentconfig-wmc.2).
 * A visual editor for settings.json at two scopes shown SIDE BY SIDE — the
 * shared, git-tracked `.claude/settings.json` and the local, gitignored
 * `.claude/settings.local.json` — plus the global `~/.claude/settings.json` when
 * that home is registered. Editors cover model, permission mode, allow/ask/deny
 * rules, env vars, and statusLine; hooks are preserved but edited elsewhere
 * (wmc.5). Every save routes through the reusable write flow (dry-run diff →
 * commit). A storage panel breaks down agent-config disk usage and offers
 * recoverable, allowlisted cleanup. Panel provenance tags are composed with
 * sourceBadgeText (bead 71h.4) so scope wording matches the app-wide
 * SourceBadge voice; the GLOBAL panel stays WRITABLE (SPEC §5 row 2).
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
import { parseTokenHash } from '../api/token.js';
import { EmptyState, formatBytes, sourceBadgeText } from '../components/core/index.js';
import { useAppState } from '../state/index.js';
import { useWriteFlow, WriteFlow } from '../write/index.js';
import { ScopePanel, type LoadStatus } from './settings/ScopePanel.js';
import { StoragePanel } from './settings/StoragePanel.js';
import './settings.css';

const bootToken =
  typeof window !== 'undefined' ? parseTokenHash(window.location.hash).token : undefined;

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

export function Settings() {
  const { currentInstance, getFile } = useAppState();
  const client = useMemo(() => (bootToken ? new ApiClient(bootToken) : undefined), []);
  const flow = useWriteFlow();
  const instanceId = currentInstance?.id;

  const [reloadKey, setReloadKey] = useState(0);
  const reload = useCallback(() => setReloadKey((k) => k + 1), []);

  const [storage, setStorage] = useState<StorageReport | undefined>();
  const [storageStatus, setStorageStatus] = useState<'loading' | 'ok' | 'error'>('loading');
  const [storageErr, setStorageErr] = useState<string | undefined>();
  const [shared, setShared] = useState<PanelState>({ status: 'loading' });
  const [local, setLocal] = useState<PanelState>({ status: 'loading' });
  const [globalScope, setGlobalScope] = useState<PanelState>({ status: 'loading' });
  const [cleanMsg, setCleanMsg] = useState<string | undefined>();
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
  // on-disk state (the write flow itself refetches the report separately).
  useEffect(() => {
    if (flow.phase === 'done') reload();
  }, [flow.phase, reload]);

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
      setCleanMsg(undefined);
      try {
        const res = await client.cleanupStorage(home, name, instanceId);
        setCleanMsg(`cleaned ${name} · freed ${formatBytes(res.bytes)} · recoverable in trash`);
        reload();
      } catch (err) {
        setCleanMsg(err instanceof ApiError ? `cleanup refused (${err.kind})` : 'cleanup failed');
      } finally {
        setCleaning(false);
      }
    },
    [client, instanceId, reload],
  );

  // Which panel's path the active write flow targets (to lock its save button).
  const activePath =
    flow.phase !== 'idle' && flow.request?.kind === 'file' ? flow.request.path : undefined;

  return (
    <main className="layout-main page">
      <section className="page__section">
        <h1 className="title-page">
          SETTINGS
          <span className="settings__sub micro-label">
            {currentInstance ? currentInstance.name : 'no instance'}
          </span>
        </h1>
      </section>

      {flow.phase !== 'idle' && (
        <section className="page__section">
          <WriteFlow flow={flow} />
        </section>
      )}

      <section className="page__section">
        <div className="settings__grid">
          <ScopePanel
            title="settings.json"
            tag={sourceBadgeText('project', 'git-tracked')}
            path={shared.path ?? '.claude/settings.json'}
            status={shared.status}
            file={shared.file}
            errMsg={shared.errMsg}
            onSave={onSave}
            saving={activePath === (shared.path ?? '.claude/settings.json')}
          />
          <ScopePanel
            title="settings.local.json"
            tag={sourceBadgeText('local', 'gitignored')}
            path={local.path ?? '.claude/settings.local.json'}
            status={local.status}
            file={local.file}
            errMsg={local.errMsg}
            onSave={onSave}
            saving={activePath === (local.path ?? '.claude/settings.local.json')}
          />
        </div>
      </section>

      <section className="page__section">
        <ScopePanel
          title="~/.claude/settings.json"
          tag={sourceBadgeText('global', 'all projects')}
          path={globalScope.path}
          status={globalScope.status}
          file={globalScope.file}
          errMsg={globalScope.errMsg}
          onSave={onSave}
          saving={activePath !== undefined && activePath === globalScope.path}
        />
      </section>

      <section className="page__section">
        <h2 className="settings__section-title micro-label">STORAGE · DISK USAGE</h2>
        {storageStatus === 'error' && !storage ? (
          <EmptyState title="NO SIGNAL" instruction={storageErr ?? 'could not read storage'} />
        ) : (
          <StoragePanel
            report={storage}
            status={storageStatus}
            errMsg={storageErr}
            onCleanup={(home, name) => void onCleanup(home, name)}
            busy={cleaning}
            message={cleanMsg}
          />
        )}
      </section>
    </main>
  );
}
