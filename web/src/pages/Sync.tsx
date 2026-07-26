/**
 * Sync (rail `14 SYNC`, route `#/sync`, bead agentconfig-wmc.10) — the INSTRUCTION
 * SYNC page (SPEC §4.1 + §5 row 22). The user designates a SOURCE OF TRUTH (an
 * instruction file in the instance) and REGENERATES the other runtimes'
 * instruction files from it, with a mandatory per-target diff preview before any
 * write. Long-tail runtimes (Cline, Windsurf, Zed, Amazon Q, Junie, Roo, Qodo,
 * Aider) appear as sync TARGETS even when they are not detected.
 *
 * FLOW: pick a source → the server dry-runs the plan (per-runtime sync status +
 * unified diffs, no disk touch) → select which targets to regenerate → REGENERATE
 * commits each selected target through the ONE guarded server write path. All diff
 * content is parsed and rendered by DiffPanel as TEXT nodes only — never markup.
 *
 * CLIENT SEAM: the sync endpoint is not on the shell's app-state value (which
 * stays private), so — following the Settings/Instances pages — this page captures
 * the launch token at module load and builds its own ApiClient. It still calls the
 * shell's refetch() after a commit so the resolved drift findings drop out live.
 */

import { useCallback, useEffect, useMemo, useState } from 'react';
import { ApiClient, ApiError, type SyncResponse, type SyncTarget } from '../api/index.js';
import { parseTokenHash } from '../api/token.js';
import { Button, DiffPanel, EmptyState } from '../components/core/index.js';
import { useAppState } from '../state/index.js';
import { parseDiff } from '../write/index.js';
import {
  defaultSelection,
  isActionable,
  planSummary,
  selectedRuntimeIds,
  SOURCE_CANDIDATES,
  statusLabel,
  statusTone,
} from './sync/logic.js';
import './sync.css';

const bootToken =
  typeof window !== 'undefined' ? parseTokenHash(window.location.hash).token : undefined;

type LoadStatus = 'loading' | 'ok' | 'missing-source' | 'error';

function loadError(err: unknown): { status: LoadStatus; msg: string } {
  if (err instanceof ApiError) {
    if (err.kind === 'notfound') return { status: 'missing-source', msg: 'source not found' };
    if (err.kind === 'forbidden') return { status: 'error', msg: 'source out of scope' };
    if (err.kind === 'unauthorized')
      return { status: 'error', msg: 'session expired — reopen from the CLI' };
    if (err.kind === 'network') return { status: 'error', msg: 'cannot reach the local server' };
  }
  return { status: 'error', msg: 'could not build the sync plan' };
}

function TargetRow({
  target,
  checked,
  onToggle,
}: {
  target: SyncTarget;
  checked: boolean;
  onToggle: () => void;
}) {
  const hunks = useMemo(() => parseDiff(target.diff), [target.diff]);
  const actionable = isActionable(target);
  return (
    <li className="sync__row">
      <div className="sync__row-head">
        <label className="sync__pick">
          <input
            type="checkbox"
            checked={checked}
            disabled={!actionable}
            onChange={onToggle}
            aria-label={`select ${target.path}`}
          />
          <span className="mono-data sync__path">{target.path}</span>
        </label>
        <span className={`sync__badge micro-label sync__badge--${statusTone(target.status)}`}>
          {statusLabel(target.status)}
        </span>
      </div>
      <div className="sync__meta micro-label">
        <span>{target.displayNames.join(' · ')}</span>
        {target.lossy && target.note !== undefined && (
          <span className="sync__note" title="approximate mapping">
            ~ {target.note}
          </span>
        )}
        {target.error !== undefined && <span className="sync__err">· {target.error}</span>}
      </div>
      {actionable && hunks.length > 0 && (
        <DiffPanel
          label={`${target.path}${target.status === 'new' ? ' · new' : ''}`}
          hunks={hunks}
        />
      )}
    </li>
  );
}

export function Sync() {
  const { currentInstance, refetch } = useAppState();
  const client = useMemo(() => (bootToken ? new ApiClient(bootToken) : undefined), []);
  const instanceId = currentInstance?.id;

  const [source, setSource] = useState<string>(SOURCE_CANDIDATES[0] ?? 'CLAUDE.md');
  const [plan, setPlan] = useState<SyncResponse | undefined>();
  const [status, setStatus] = useState<LoadStatus>('loading');
  const [errMsg, setErrMsg] = useState<string>('');
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [committing, setCommitting] = useState(false);
  const [commitMsg, setCommitMsg] = useState<string | undefined>();
  const [reloadKey, setReloadKey] = useState(0);

  // Build (dry-run) the plan whenever the source, instance, or a post-commit
  // reload changes. No disk is touched by a dry-run.
  useEffect(() => {
    let cancelled = false;
    if (!client) {
      setStatus('error');
      setErrMsg('session token missing');
      return;
    }
    setStatus('loading');
    setCommitMsg(undefined);
    void (async () => {
      try {
        const res = await client.syncInstructions(source, { dryRun: true, instance: instanceId });
        if (cancelled) return;
        setPlan(res);
        setSelected(defaultSelection(res.targets));
        setStatus('ok');
      } catch (err) {
        if (cancelled) return;
        const mapped = loadError(err);
        setStatus(mapped.status);
        setErrMsg(mapped.msg);
        setPlan(undefined);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [client, source, instanceId, reloadKey]);

  const toggle = useCallback((path: string) => {
    setSelected((prev) => {
      const next = new Set(prev);
      if (next.has(path)) next.delete(path);
      else next.add(path);
      return next;
    });
  }, []);

  const summary = useMemo(() => (plan ? planSummary(plan.targets) : undefined), [plan]);
  const selectedIds = useMemo(
    () => (plan ? selectedRuntimeIds(plan.targets, selected) : []),
    [plan, selected],
  );

  const onRegenerate = useCallback(async () => {
    if (!client || selectedIds.length === 0) return;
    setCommitting(true);
    setCommitMsg(undefined);
    try {
      const res = await client.syncInstructions(source, {
        dryRun: false,
        targets: selectedIds,
        instance: instanceId,
      });
      const written = res.targets.filter((t) => t.committed).length;
      setCommitMsg(
        res.committed
          ? `regenerated ${written} file${written === 1 ? '' : 's'} from ${source}`
          : 'some targets could not be written — see the rows',
      );
      // Pull the fresh report so resolved drift/conflict findings drop out, then
      // re-run the dry-run so the rows flip to in-sync.
      refetch();
      setReloadKey((k) => k + 1);
    } catch (err) {
      setCommitMsg(err instanceof ApiError ? `sync refused (${err.kind})` : 'sync failed');
    } finally {
      setCommitting(false);
    }
  }, [client, selectedIds, source, instanceId, refetch]);

  return (
    <main className="layout-main page">
      <section className="page__section">
        <h1 className="title-page">
          SYNC
          <span className="sync__sub micro-label">
            {currentInstance ? currentInstance.name : 'no instance'}
          </span>
        </h1>
        <p className="sync__lede micro-label">
          regenerate every runtime&rsquo;s instruction file from one source of truth
        </p>
      </section>

      <section className="page__section">
        <div className="sync__source">
          <span className="micro-label sync__source-label">SOURCE OF TRUTH</span>
          <div className="sync__source-pick">
            {SOURCE_CANDIDATES.map((candidate) => (
              <Button
                key={candidate}
                label={candidate}
                variant={candidate === source ? 'primary' : 'default'}
                onClick={() => setSource(candidate)}
              />
            ))}
          </div>
        </div>
      </section>

      <section className="page__section">
        {status === 'loading' && <p className="micro-label">building sync plan…</p>}

        {status === 'missing-source' && (
          <EmptyState
            title="NO SOURCE"
            instruction={`${source} is not in this instance — pick another source of truth`}
          />
        )}

        {status === 'error' && <EmptyState title="NO SIGNAL" instruction={errMsg} />}

        {status === 'ok' && plan && (
          <>
            {summary && (
              <p className="sync__summary micro-label" role="status">
                {summary.drifted} drifted · {summary.missing} missing · {summary.inSync} in sync
                {summary.unwritable > 0 ? ` · ${summary.unwritable} unwritable` : ''}
              </p>
            )}

            {commitMsg !== undefined && (
              <p className="sync__commit-msg mono-data" role="status">
                {commitMsg}
              </p>
            )}

            <div className="sync__actions">
              <Button
                label={committing ? 'regenerating…' : `regenerate ${selectedIds.length} selected`}
                variant="primary"
                disabled={committing || selectedIds.length === 0}
                onClick={() => void onRegenerate()}
              />
            </div>

            {plan.targets.length === 0 ? (
              <EmptyState instruction="no other runtimes to sync from this source" />
            ) : (
              <ul className="sync__list">
                {plan.targets.map((target) => (
                  <TargetRow
                    key={target.path}
                    target={target}
                    checked={selected.has(target.path)}
                    onToggle={() => toggle(target.path)}
                  />
                ))}
              </ul>
            )}
          </>
        )}
      </section>
    </main>
  );
}
