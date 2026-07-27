/**
 * ContextHealth (rail `21 CONTEXT`, route `#/context`) — the CONTEXT HEALTH +
 * STORAGE MAINTENANCE view (SPEC §5 row 16 / E7, bead agentconfig-7yb.6).
 *
 * Two content-free surfaces for the current instance:
 *  - CONTEXT HEALTH: how much of the agent config FOOTPRINT loads into an
 *    agent's context window — total size vs a budget (a VU bar), the largest
 *    contributors, per-category totals, and honest, size-derived optimization
 *    suggestions. Served by GET /api/context-health (sizes + paths only).
 *  - STORAGE MAINTENANCE: the disk-usage breakdown + recoverable, allowlisted
 *    cleanup — REUSED from the Settings storage panel (the committed StoragePanel
 *    component + GET /api/storage / POST /api/storage/cleanup). No new delete
 *    path: cleanup goes through the same committed guarded endpoint.
 *
 * All values are numbers or filesystem paths; every path is rendered as a TEXT
 * node only, never HTML.
 *
 * CLIENT SEAM: like Settings/Dashboard, the shell keeps its ApiClient private,
 * so this page captures the launch token at module load and builds its own
 * client for getContextHealth / getStorage / cleanupStorage.
 */

import { useCallback, useEffect, useMemo, useState } from 'react';
import {
  ApiClient,
  ApiError,
  type ContextHealth as ContextHealthData,
  type StorageReport,
} from '../api/index.js';
import { parseTokenHash } from '../api/token.js';
import { EmptyState, FileChip, StatBlock, Table, formatBytes } from '../components/core/index.js';
import { VuMeter } from '../components/signal/index.js';
import { useAppState } from '../state/index.js';
import { StoragePanel } from './settings/StoragePanel.js';
import {
  budgetPercent,
  categoryLabel,
  hasNoConfig,
  meterLevel,
  statusLabel,
} from './contexthealth/logic.js';
import './contexthealth.css';
import './settings.css';

const bootToken =
  typeof window !== 'undefined' ? parseTokenHash(window.location.hash).token : undefined;

type LoadStatus = 'loading' | 'ok' | 'error';

function loadError(err: unknown): string {
  if (err instanceof ApiError) {
    if (err.kind === 'notfound') return 'unknown instance';
    if (err.kind === 'unauthorized') return 'session expired — reopen from the CLI';
    if (err.kind === 'network') return 'cannot reach the local server';
  }
  return 'could not load context health';
}

function storageError(err: unknown): string {
  if (err instanceof ApiError) {
    if (err.kind === 'notfound') return 'unknown instance';
    if (err.kind === 'unauthorized') return 'session expired — reopen from the CLI';
    if (err.kind === 'network') return 'cannot reach the local server';
  }
  return 'could not read storage';
}

export function ContextHealth() {
  const { currentInstance } = useAppState();
  const client = useMemo(() => (bootToken ? new ApiClient(bootToken) : undefined), []);
  const instanceId = currentInstance?.id;

  const [reloadKey, setReloadKey] = useState(0);
  const reload = useCallback(() => setReloadKey((k) => k + 1), []);

  const [health, setHealth] = useState<ContextHealthData | undefined>();
  const [status, setStatus] = useState<LoadStatus>('loading');
  const [errMsg, setErrMsg] = useState('');

  const [storage, setStorage] = useState<StorageReport | undefined>();
  const [storageStatus, setStorageStatus] = useState<LoadStatus>('loading');
  const [storageErr, setStorageErr] = useState<string | undefined>();
  const [cleanMsg, setCleanMsg] = useState<string | undefined>();
  const [cleaning, setCleaning] = useState(false);

  useEffect(() => {
    let cancelled = false;
    if (!client) {
      setStatus('error');
      setErrMsg('session token missing');
      setStorageStatus('error');
      setStorageErr('session token missing');
      return;
    }
    setStatus('loading');
    setStorageStatus('loading');

    void (async () => {
      try {
        const res = await client.getContextHealth(instanceId);
        if (cancelled) return;
        setHealth(res);
        setStatus('ok');
      } catch (err) {
        if (cancelled) return;
        setErrMsg(loadError(err));
        setStatus('error');
      }

      try {
        const rep = await client.getStorage(instanceId);
        if (cancelled) return;
        setStorage(rep);
        setStorageStatus('ok');
      } catch (err) {
        if (cancelled) return;
        setStorageStatus('error');
        setStorageErr(storageError(err));
      }
    })();

    return () => {
      cancelled = true;
    };
  }, [client, instanceId, reloadKey]);

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

  const maxCategoryBytes = useMemo(
    () => (health ? health.byCategory.reduce((m, c) => Math.max(m, c.bytes), 0) || 1 : 1),
    [health],
  );

  return (
    <main className="layout-main page">
      <section className="page__section">
        <h1 className="title-page">
          CONTEXT HEALTH
          <span className="ctx__sub micro-label">
            {currentInstance ? currentInstance.name : 'no instance'}
          </span>
        </h1>
        <p className="ctx__lede micro-label">
          size of the agent config that loads into an agent&apos;s context window — total vs budget,
          largest contributors &amp; optimization suggestions
        </p>
      </section>

      {status === 'loading' && (
        <section className="page__section">
          <p className="micro-label ctx__acquiring">ACQUIRING SIGNAL</p>
        </section>
      )}

      {status === 'error' && (
        <section className="page__section">
          <EmptyState title="NO SIGNAL" instruction={errMsg} />
        </section>
      )}

      {status === 'ok' && health && hasNoConfig(health) && (
        <section className="page__section">
          <EmptyState title="NO SIGNAL" instruction="no agent config loads into context here" />
        </section>
      )}

      {status === 'ok' && health && !hasNoConfig(health) && (
        <>
          <section className="page__section">
            <div className="grid-page ctx__stats">
              <div className="ctx__stat">
                <StatBlock value={formatBytes(health.totalBytes)} label="CONTEXT CONFIG" />
              </div>
              <div className="ctx__stat col-rule">
                <StatBlock value={budgetPercent(health)} label="OF BUDGET" size="md" />
              </div>
              <div className="ctx__stat col-rule">
                <StatBlock value={health.fileCount} label="CONFIG FILES" size="md" />
              </div>
            </div>
            <div className={`ctx__budget ctx__budget--${health.status}`}>
              <VuMeter level={meterLevel(health)} warnFrom={0.75} label="context budget usage" />
              <span className="mono-data ctx__budget-caption">
                {formatBytes(health.totalBytes)} / {formatBytes(health.budgetBytes)} ·{' '}
                {statusLabel(health.status)}
              </span>
            </div>
          </section>

          {health.suggestions.length > 0 && (
            <section className="page__section">
              <h2 className="micro-label ctx__heading">OPTIMIZATION SUGGESTIONS</h2>
              <ul className="ctx__suggestions">
                {health.suggestions.map((s) => (
                  <li key={s.id} className={`ctx__suggestion ctx__suggestion--${s.severity}`}>
                    <span className="ctx__suggestion-dot" aria-hidden="true" />
                    <span className="ctx__suggestion-msg">{s.message}</span>
                  </li>
                ))}
              </ul>
            </section>
          )}

          <section className="page__section">
            <h2 className="micro-label ctx__heading">BY CATEGORY</h2>
            <ul className="ctx__cats">
              {health.byCategory.map((c) => (
                <li key={c.category} className="ctx__cat-row">
                  <span className="micro-label ctx__cat-name">{categoryLabel(c.category)}</span>
                  <VuMeter level={c.bytes / maxCategoryBytes} label={`${c.category} share`} />
                  <span className="mono-data ctx__cat-size">
                    {formatBytes(c.bytes)} · {c.files}f
                  </span>
                </li>
              ))}
            </ul>
          </section>

          <section className="page__section">
            <h2 className="micro-label ctx__heading">LARGEST CONTRIBUTORS</h2>
            <Table headers={['FILE', 'CATEGORY', 'SIZE']}>
              {health.largest.map((f) => (
                <tr key={f.path}>
                  <td>
                    <FileChip path={f.path} size={f.size} />
                  </td>
                  <td className="micro-label">{categoryLabel(f.category)}</td>
                  <td className="mono-data">{formatBytes(f.size)}</td>
                </tr>
              ))}
            </Table>
          </section>
        </>
      )}

      <section className="page__section">
        <h2 className="ctx__heading micro-label">STORAGE · DISK USAGE</h2>
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
