/**
 * Sync (#/sync, Console page, E13.5) — the INSTRUCTION SYNC page (SPEC §4.1 +
 * §5 row 22). The user designates a SOURCE OF TRUTH (an instruction file in the
 * instance) and REGENERATES the other runtimes' instruction files from it, with
 * a mandatory per-target diff preview before any write. Long-tail runtimes
 * (Cline, Windsurf, Zed, Amazon Q, Junie, Roo, Qodo, Aider) appear as sync
 * TARGETS even when they are not detected.
 *
 * FLOW: pick a source → the server dry-runs the plan (per-runtime sync status +
 * unified diffs, no disk touch) → select which targets to regenerate → REGENERATE
 * commits each selected target through the ONE guarded server write path and
 * confirms via Toast. All diff content is parsed and rendered by DiffPanel as
 * TEXT nodes only — never markup.
 *
 * CLIENT SEAM: the sync endpoint is not on the shell's app-state value (which
 * stays private), so — following the Settings/Instances pages — this page captures
 * the launch token at module load and builds its own ApiClient. It still calls the
 * shell's refetch() after a commit so the resolved drift findings drop out live.
 */

import { useCallback, useEffect, useMemo, useState } from 'react';
import { ApiClient, ApiError, type SyncResponse, type SyncTarget } from '../api/index.js';
import { bootstrapToken } from '../api/token.js';
import {
  Button,
  DiffPanel,
  EmptyState,
  Pill,
  SegmentedControl,
  SourceBadge,
  useToast,
  type PillTone,
} from '../components/core/index.js';
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

const bootToken = typeof window !== 'undefined' ? bootstrapToken() : undefined;

type LoadStatus = 'loading' | 'ok' | 'missing-source' | 'error';

/** Map the logic layer's tone onto the Console pill tones. */
const PILL_TONE: Record<ReturnType<typeof statusTone>, PillTone> = {
  signal: 'ok',
  warn: 'warn',
  dim: 'off',
};

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
    <li className="card sync__row">
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
        <span className="sync__row-marks">
          <SourceBadge scope="project" />
          <Pill tone={PILL_TONE[statusTone(target.status)]}>{statusLabel(target.status)}</Pill>
        </span>
      </div>
      <div className="sync__meta meta">
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

function SyncBody() {
  const { currentInstance, refetch } = useAppState();
  const client = useMemo(() => (bootToken ? new ApiClient(bootToken) : undefined), []);
  const instanceId = currentInstance?.id;
  const toast = useToast();

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
      const msg = res.committed
        ? `regenerated ${written} file${written === 1 ? '' : 's'} from ${source}`
        : 'some targets could not be written — see the rows';
      setCommitMsg(msg);
      if (res.committed) toast(`Regenerated ${written} file${written === 1 ? '' : 's'}`);
      // Pull the fresh report so resolved drift/conflict findings drop out, then
      // re-run the dry-run so the rows flip to in-sync.
      refetch();
      setReloadKey((k) => k + 1);
    } catch (err) {
      setCommitMsg(err instanceof ApiError ? `sync refused (${err.kind})` : 'sync failed');
    } finally {
      setCommitting(false);
    }
  }, [client, selectedIds, source, instanceId, refetch, toast]);

  return (
    <main className="layout-main page">
      <div className="page-head">
        <div>
          <h1>Sync</h1>
          <p className="page-sub">
            regenerate every runtime&rsquo;s instruction file from one source of truth
          </p>
        </div>
        <span className="meta">{currentInstance ? currentInstance.name : 'no instance'}</span>
      </div>

      <section className="page__section">
        <div className="sync__source">
          <span className="table-header">SOURCE OF TRUTH</span>
          <SegmentedControl
            options={SOURCE_CANDIDATES}
            value={source}
            onChange={setSource}
            label="Source of truth"
          />
        </div>
      </section>

      <section className="page__section">
        {status === 'loading' && <p className="meta">building sync plan…</p>}

        {status === 'missing-source' && (
          <EmptyState
            title="No source"
            instruction={`${source} is not in this instance — pick another source of truth.`}
          />
        )}

        {status === 'error' && <EmptyState title="Sync unavailable" instruction={errMsg} />}

        {status === 'ok' && plan && (
          <>
            {summary && (
              <p className="sync__summary meta" role="status">
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
                label={committing ? 'Regenerating…' : `Regenerate ${selectedIds.length} selected`}
                variant="primary"
                disabled={committing || selectedIds.length === 0}
                onClick={() => void onRegenerate()}
              />
            </div>

            {plan.targets.length === 0 ? (
              <EmptyState instruction="No other runtimes to sync from this source." />
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

export function Sync() {
  // Toasts confirm through the shell-level ToastProvider (App.tsx).
  return <SyncBody />;
}
