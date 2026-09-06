/**
 * ContextHealth (route `#/context`) — the CONTEXT HEALTH + STORAGE MAINTENANCE
 * view (SPEC §5 row 16 / E7, bead agentconfig-7yb.6).
 *
 * Three content-free surfaces for the current instance:
 *  - CONTEXT HEALTH: how much of the agent config FOOTPRINT loads into an
 *    agent's context window — total size vs a budget (a plain meter bar), the
 *    largest contributors, per-category totals, and honest, size-derived
 *    optimization suggestions. Served by GET /api/context-health (sizes + paths
 *    only).
 *  - INITIAL CONTEXT: per detected agent, estimated launch-time token cost vs
 *    budget from GET /api/context-cost (agentconfig-ub3.5). Launch-lite only:
 *    no per-section links until ub3.6.
 *  - STORAGE MAINTENANCE: the disk-usage breakdown + recoverable, allowlisted
 *    cleanup — REUSED from the Settings storage panel (the committed StoragePanel
 *    component + GET /api/storage / POST /api/storage/cleanup). No new delete
 *    path: cleanup goes through the same committed guarded endpoint.
 *
 * All values are numbers or filesystem paths; every path is rendered as a TEXT
 * node only, never HTML.
 *
 * CLIENT SEAM: uses the AppStateProvider's token-bearing ApiClient so tests can
 * inject endpoint behavior and production still shares the launch token.
 */

import { useCallback, useEffect, useMemo, useState } from 'react';
import {
  ApiError,
  type ContextCost,
  type ContextHealth as ContextHealthData,
  type StorageReport,
} from '../api/index.js';
import {
  EmptyState,
  FileChip,
  Notice,
  StatBlock,
  Table,
  formatBytes,
  useToast,
} from '../components/core/index.js';
import { useAppState } from '../state/index.js';
import { StoragePanel } from './settings/StoragePanel.js';
import {
  budgetPercent,
  agentCostCaption,
  categoryLabel,
  formatTokenCount,
  hasNoConfig,
  hasNoContextCost,
  meterLevel,
  statusLabel,
} from './contexthealth/logic.js';
import './contexthealth.css';
import './settings.css';

type LoadStatus = 'loading' | 'ok' | 'error';

function loadError(err: unknown): string {
  if (err instanceof ApiError) {
    if (err.kind === 'notfound') return 'unknown instance';
    if (err.kind === 'unauthorized') return 'session expired — reopen from the CLI';
    if (err.kind === 'network') return 'cannot reach the local server';
  }
  return 'could not load context health';
}

function contextCostError(err: unknown): string {
  if (err instanceof ApiError) {
    if (err.kind === 'notfound') return 'unknown instance';
    if (err.kind === 'unauthorized') return 'session expired — reopen from the CLI';
    if (err.kind === 'network') return 'cannot reach the local server';
  }
  return 'could not load initial context';
}

function storageError(err: unknown): string {
  if (err instanceof ApiError) {
    if (err.kind === 'notfound') return 'unknown instance';
    if (err.kind === 'unauthorized') return 'session expired — reopen from the CLI';
    if (err.kind === 'network') return 'cannot reach the local server';
  }
  return 'could not read storage';
}

function ContextHealthPanel() {
  const { currentInstance, client } = useAppState();
  const instanceId = currentInstance?.id;
  const toast = useToast();

  const [reloadKey, setReloadKey] = useState(0);
  const reload = useCallback(() => setReloadKey((k) => k + 1), []);

  const [health, setHealth] = useState<ContextHealthData | undefined>();
  const [status, setStatus] = useState<LoadStatus>('loading');
  const [errMsg, setErrMsg] = useState('');

  const [cost, setCost] = useState<ContextCost | undefined>();
  const [costStatus, setCostStatus] = useState<LoadStatus>('loading');
  const [costErr, setCostErr] = useState('');

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
      setCostStatus('error');
      setCostErr('session token missing');
      setStorageStatus('error');
      setStorageErr('session token missing');
      return;
    }
    setStatus('loading');
    setCostStatus('loading');
    setStorageStatus('loading');

    void (async () => {
      try {
        const res = await client.getContextCost(instanceId);
        if (cancelled) return;
        setCost(res);
        setCostStatus('ok');
      } catch (err) {
        if (cancelled) return;
        setCostErr(contextCostError(err));
        setCostStatus('error');
      }
    })();

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
    })();

    void (async () => {
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
        toast(`Cleaned ${name} — freed ${formatBytes(res.bytes)} (recoverable in trash)`);
        reload();
      } catch (err) {
        setCleanMsg(err instanceof ApiError ? `cleanup refused (${err.kind})` : 'cleanup failed');
      } finally {
        setCleaning(false);
      }
    },
    [client, instanceId, reload, toast],
  );

  const maxCategoryBytes = useMemo(
    () => (health ? health.byCategory.reduce((m, c) => Math.max(m, c.bytes), 0) || 1 : 1),
    [health],
  );

  return (
    <main className="layout-main page">
      <section className="page__section">
        <div className="page-head">
          <div>
            <h1>Context health</h1>
            <p className="page-sub">
              Size of the agent config that loads into an agent&apos;s context window for{' '}
              <span className="mono">{currentInstance ? currentInstance.name : 'no instance'}</span>{' '}
              — total vs budget, largest contributors &amp; optimization suggestions.
            </p>
          </div>
        </div>
      </section>

      {status === 'loading' && (
        <section className="page__section">
          <p className="meta">measuring context…</p>
        </section>
      )}

      {status === 'error' && (
        <section className="page__section">
          <EmptyState title="Context health unavailable" instruction={errMsg} />
        </section>
      )}

      <section className="page__section">
        <h2 className="ctx-heading">Initial context</h2>

        {costStatus === 'loading' && <p className="meta">measuring initial context…</p>}

        {costStatus === 'error' && (
          <EmptyState title="Initial context unavailable" instruction={costErr} />
        )}

        {costStatus === 'ok' && cost && hasNoContextCost(cost) && (
          <EmptyState
            title="No detected agents"
            instruction="no initial context token costs were reported for this instance"
          />
        )}

        {costStatus === 'ok' && cost && !hasNoContextCost(cost) && (
          <div className="tile-row ctx-agent-tiles">
            {cost.agents.map((agent) => (
              <StatBlock
                key={agent.kind}
                value={formatTokenCount(agent.totalTokens)}
                label={`${agent.kind} initial tokens`}
                caption={agentCostCaption(agent)}
              />
            ))}
          </div>
        )}
      </section>

      {status === 'ok' && health && hasNoConfig(health) && (
        <section className="page__section">
          <EmptyState
            title="No context config"
            instruction="no agent config loads into context for this instance"
          />
        </section>
      )}

      {status === 'ok' && health && !hasNoConfig(health) && (
        <>
          <section className="page__section">
            <div className="tile-row ctx-tiles">
              <StatBlock value={formatBytes(health.totalBytes)} label="Context config" />
              <StatBlock value={budgetPercent(health)} label="Of budget" />
              <StatBlock value={health.fileCount} label="Config files" />
            </div>
            <div className={`ctx-budget ctx-budget--${health.status}`}>
              <div
                className="ctx-meter"
                role="meter"
                aria-label="Context budget usage"
                aria-valuemin={0}
                aria-valuemax={1}
                aria-valuenow={meterLevel(health)}
              >
                <span
                  className="ctx-meter__fill"
                  style={{ width: `${meterLevel(health) * 100}%` }}
                />
              </div>
              <span className="mono-data ctx-budget-caption">
                {formatBytes(health.totalBytes)} / {formatBytes(health.budgetBytes)} ·{' '}
                {statusLabel(health.status)}
              </span>
            </div>
          </section>

          {health.suggestions.length > 0 && (
            <section className="page__section">
              <h2 className="ctx-heading">Optimization suggestions</h2>
              {health.suggestions.map((s) => (
                <Notice key={s.id} tone={s.severity === 'warn' ? 'warn' : 'info'}>
                  {s.message}
                </Notice>
              ))}
            </section>
          )}

          <section className="page__section">
            <h2 className="ctx-heading">By category</h2>
            <ul className="ctx-cats">
              {health.byCategory.map((c) => (
                <li key={c.category} className="ctx-cat-row">
                  <span className="table-header ctx-cat-name">{categoryLabel(c.category)}</span>
                  <div
                    className="ctx-meter"
                    role="meter"
                    aria-label={`${c.category} share`}
                    aria-valuemin={0}
                    aria-valuemax={1}
                    aria-valuenow={c.bytes / maxCategoryBytes}
                  >
                    <span
                      className="ctx-meter__fill"
                      style={{ width: `${(c.bytes / maxCategoryBytes) * 100}%` }}
                    />
                  </div>
                  <span className="mono-data ctx-cat-size">
                    {formatBytes(c.bytes)} · {c.files}f
                  </span>
                </li>
              ))}
            </ul>
          </section>

          <section className="page__section">
            <h2 className="ctx-heading">Largest contributors</h2>
            <Table headers={['FILE', 'CATEGORY', 'SIZE']}>
              {health.largest.map((f) => (
                <tr key={f.path}>
                  <td>
                    <FileChip path={f.path} size={f.size} />
                  </td>
                  <td className="mono muted">{categoryLabel(f.category)}</td>
                  <td className="mono num-col">{formatBytes(f.size)}</td>
                </tr>
              ))}
            </Table>
          </section>
        </>
      )}

      <section className="page__section">
        <h2 className="ctx-heading">Storage · disk usage</h2>
        {storageStatus === 'error' && !storage ? (
          <EmptyState
            title="Storage unavailable"
            instruction={storageErr ?? 'could not read storage'}
          />
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

export function ContextHealth() {
  // Toasts confirm through the shell-level ToastProvider (App.tsx).
  return <ContextHealthPanel />;
}
