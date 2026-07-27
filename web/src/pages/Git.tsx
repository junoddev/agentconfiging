/**
 * Git (rail `22 GIT`, route `#/git`) — the GIT PANEL (SPEC §5 row 10, bead
 * agentconfig-ngs.1), SCOPED to the launched repo (the current instance root):
 * a branch switcher, grouped changes (staged / unstaged / untracked) with
 * stage/unstage + a diff view, a CONVENTIONAL-COMMIT helper, push/pull with an
 * ahead/behind indicator, and the commit timeline.
 *
 * The server SHELLS OUT to `git` (execFile, no shell, cwd pinned to the repo
 * root, every ref/path validated, the commit message piped on stdin). Every
 * value shown here — branch names, file paths, commit subjects + authors — is
 * that subprocess's UNTRUSTED output and is rendered as a TEXT NODE only, never
 * markup. git-absent → a clear "git not found" state; a non-repo instance → a
 * clear "not a git repository" state; neither is a crash.
 *
 * REFRESH via the WATCHER, not polling: the page re-fetches git state whenever
 * the shell's `report` object changes — which happens on the WS report-change
 * push the file watcher drives (SPEC §4.4) — plus after each mutation it issues.
 *
 * CLIENT SEAM: like Sync/Marketplace, the shell keeps its ApiClient private, so
 * this page captures the launch token at module load and builds its own client.
 */

import { useCallback, useEffect, useMemo, useState } from 'react';
import {
  ApiClient,
  ApiError,
  type GitBranch,
  type GitCommit,
  type GitFileChange,
  type GitStatusResponse,
} from '../api/index.js';
import { parseTokenHash } from '../api/token.js';
import { Button, DiffPanel, EmptyState } from '../components/core/index.js';
import { useAppState } from '../state/index.js';
import { parseDiff } from '../write/index.js';
import {
  buildCommitMessage,
  COMMIT_TYPES,
  hasChanges,
  statusLabel,
  statusTone,
  syncSummary,
} from './git/logic.js';
import './git.css';

const bootToken =
  typeof window !== 'undefined' ? parseTokenHash(window.location.hash).token : undefined;

type Phase = 'loading' | 'ok' | 'error';

/** Identifies the file whose diff is open (path + which side). */
interface OpenDiff {
  path: string;
  staged: boolean;
}

function loadError(err: unknown): string {
  if (err instanceof ApiError) {
    if (err.kind === 'unauthorized') return 'session expired — reopen from the CLI';
    if (err.kind === 'network') return 'cannot reach the local server';
    if (err.kind === 'notfound') return 'no instance selected';
  }
  return 'could not read git status';
}

/** One change row: the path (text), a status badge, and stage/unstage + diff. */
function ChangeRow({
  change,
  action,
  onAction,
  onDiff,
}: {
  change: GitFileChange;
  action: 'stage' | 'unstage';
  onAction: () => void;
  onDiff: () => void;
}) {
  return (
    <li className="git__row">
      <span className={`git__badge micro-label git__badge--${statusTone(change.status)}`}>
        {statusLabel(change.status)}
      </span>
      <span className="mono-data git__path">
        {change.orig ? `${change.orig} → ${change.path}` : change.path}
      </span>
      <span className="git__row-actions">
        <Button label="diff" onClick={onDiff} />
        <Button
          label={action}
          variant={action === 'stage' ? 'primary' : 'default'}
          onClick={onAction}
        />
      </span>
    </li>
  );
}

/** One untracked-file row (no diff — nothing tracked yet). */
function UntrackedRow({ path, onStage }: { path: string; onStage: () => void }) {
  return (
    <li className="git__row">
      <span className="git__badge micro-label git__badge--add">untracked</span>
      <span className="mono-data git__path">{path}</span>
      <span className="git__row-actions">
        <Button label="stage" variant="primary" onClick={onStage} />
      </span>
    </li>
  );
}

function CommitTimeline({ commits }: { commits: GitCommit[] }) {
  if (commits.length === 0) {
    return <p className="micro-label">no commits yet</p>;
  }
  return (
    <ul className="git__log">
      {commits.map((commit) => (
        <li key={commit.hash} className="git__log-row">
          <span className="mono-data git__hash">{commit.hash.slice(0, 8)}</span>
          <span className="git__subject">{commit.subject}</span>
          <span className="micro-label git__log-meta">
            {commit.author} · {commit.date.slice(0, 10)}
          </span>
        </li>
      ))}
    </ul>
  );
}

export function Git() {
  const { currentInstance, report } = useAppState();
  const client = useMemo(() => (bootToken ? new ApiClient(bootToken) : undefined), []);
  const instanceId = currentInstance?.id;

  const [phase, setPhase] = useState<Phase>('loading');
  const [errMsg, setErrMsg] = useState('');
  const [status, setStatus] = useState<GitStatusResponse | undefined>();
  const [branches, setBranches] = useState<GitBranch[]>([]);
  const [commits, setCommits] = useState<GitCommit[]>([]);
  const [notice, setNotice] = useState<string | undefined>();

  // Conventional-commit builder state.
  const [ctype, setCtype] = useState<string>('feat');
  const [scope, setScope] = useState('');
  const [subject, setSubject] = useState('');
  const [body, setBody] = useState('');
  const [breaking, setBreaking] = useState(false);
  const [newBranch, setNewBranch] = useState('');

  const [openDiff, setOpenDiff] = useState<OpenDiff | undefined>();
  const [diffText, setDiffText] = useState('');
  const [busy, setBusy] = useState(false);

  const refresh = useCallback(async () => {
    if (!client) {
      setPhase('error');
      setErrMsg('session token missing');
      return;
    }
    try {
      const [s, log, br] = await Promise.all([
        client.getGitStatus(instanceId),
        client.getGitLog(instanceId),
        client.getGitBranches(instanceId),
      ]);
      setStatus(s);
      setCommits(s.gitAvailable && s.isRepo && log.gitAvailable && log.isRepo ? log.commits : []);
      setBranches(br.gitAvailable && br.isRepo ? br.branches : []);
      setPhase('ok');
    } catch (err) {
      setPhase('error');
      setErrMsg(loadError(err));
    }
  }, [client, instanceId]);

  // Refresh on instance change AND whenever the shell's report updates — the
  // report refetch is driven by the WS report-change push (the file watcher),
  // so this is watcher-driven refresh, not polling.
  useEffect(() => {
    void refresh();
  }, [refresh, report]);

  const commitMessage = useMemo(
    () => buildCommitMessage({ type: ctype, scope, subject, body, breaking }),
    [ctype, scope, subject, body, breaking],
  );
  const diffHunks = useMemo(() => parseDiff(diffText), [diffText]);

  // Run a mutation, surface its (untrusted) message, then refresh from git.
  const runMutation = useCallback(
    async (op: () => Promise<{ ok?: boolean; message?: string } & Record<string, unknown>>) => {
      if (busy) return;
      setBusy(true);
      setNotice(undefined);
      try {
        const res = await op();
        if ('ok' in res && res.ok === false) {
          setNotice(res.message && res.message !== '' ? res.message : 'git refused the operation');
        }
      } catch (err) {
        setNotice(err instanceof ApiError ? `refused (${err.kind})` : 'operation failed');
      } finally {
        setBusy(false);
        await refresh();
      }
    },
    [busy, refresh],
  );

  const onViewDiff = useCallback(
    async (path: string, staged: boolean) => {
      if (!client) return;
      if (openDiff && openDiff.path === path && openDiff.staged === staged) {
        setOpenDiff(undefined);
        setDiffText('');
        return;
      }
      setOpenDiff({ path, staged });
      setDiffText('');
      try {
        const res = await client.getGitDiff(path, staged, instanceId);
        setDiffText(res.gitAvailable && res.isRepo ? res.diff : '');
      } catch {
        setDiffText('');
      }
    },
    [client, instanceId, openDiff],
  );

  const onCommit = useCallback(() => {
    if (!client || commitMessage === '') return;
    void runMutation(async () => {
      const res = await client.gitCommit(commitMessage, instanceId);
      if (!('ok' in res) || res.ok !== false) {
        setSubject('');
        setBody('');
        setBreaking(false);
      }
      return res;
    });
  }, [client, commitMessage, instanceId, runMutation]);

  if (phase === 'error') {
    return (
      <main className="layout-main page">
        <section className="page__section">
          <h1 className="title-page">GIT</h1>
          <EmptyState title="NO SIGNAL" instruction={errMsg} />
        </section>
      </main>
    );
  }

  const gitAbsent = status !== undefined && !status.gitAvailable;
  const notRepo = status !== undefined && status.gitAvailable && !status.isRepo;
  const repo = status !== undefined && status.gitAvailable && status.isRepo ? status : undefined;

  return (
    <main className="layout-main page">
      <section className="page__section">
        <h1 className="title-page">
          GIT
          <span className="git__sub micro-label">
            {currentInstance ? currentInstance.name : 'no instance'}
          </span>
        </h1>
        <p className="git__lede micro-label">
          branches, changes, conventional commits, and timeline
        </p>
      </section>

      {phase === 'loading' && (
        <section className="page__section">
          <p className="micro-label">reading git…</p>
        </section>
      )}

      {gitAbsent && (
        <section className="page__section">
          <EmptyState title="NO GIT" instruction="git is not installed on this machine" />
        </section>
      )}

      {notRepo && (
        <section className="page__section">
          <EmptyState
            title="NOT A REPO"
            instruction="the launched instance is not a git repository"
          />
        </section>
      )}

      {repo && (
        <>
          <section className="page__section git__head">
            <div className="git__branchline">
              <span className="micro-label">BRANCH</span>
              <select
                className="git__select mono-data"
                aria-label="switch branch"
                value={repo.detached ? '' : repo.branch}
                disabled={busy}
                onChange={(e) => {
                  const branch = e.target.value;
                  if (branch !== '' && branch !== repo.branch && client) {
                    void runMutation(() => client.gitCheckout(branch, false, instanceId));
                  }
                }}
              >
                {repo.detached && <option value="">(detached)</option>}
                {branches.map((b) => (
                  <option key={b.name} value={b.name}>
                    {b.name}
                  </option>
                ))}
              </select>
              {syncSummary(repo.ahead, repo.behind) !== '' && (
                <span className="git__ab mono-data">{syncSummary(repo.ahead, repo.behind)}</span>
              )}
              {repo.upstream !== undefined && (
                <span className="micro-label git__upstream">→ {repo.upstream}</span>
              )}
            </div>

            <div className="git__head-actions">
              <input
                className="git__input mono-data"
                placeholder="new-branch"
                aria-label="new branch name"
                value={newBranch}
                onChange={(e) => setNewBranch(e.target.value)}
              />
              <Button
                label="create + switch"
                disabled={busy || newBranch.trim() === ''}
                onClick={() => {
                  if (client && newBranch.trim() !== '') {
                    const name = newBranch.trim();
                    void runMutation(() => client.gitCheckout(name, true, instanceId));
                    setNewBranch('');
                  }
                }}
              />
              <Button
                label="pull"
                disabled={busy}
                onClick={() => client && void runMutation(() => client.gitPull(instanceId))}
              />
              <Button
                label="push"
                variant="primary"
                disabled={busy}
                onClick={() => client && void runMutation(() => client.gitPush(instanceId))}
              />
            </div>
          </section>

          {notice !== undefined && (
            <section className="page__section">
              <p className="git__notice mono-data" role="status">
                {notice}
              </p>
            </section>
          )}

          <section className="page__section">
            {!hasChanges(repo.staged, repo.unstaged, repo.untracked) ? (
              <p className="micro-label">working tree clean</p>
            ) : (
              <div className="git__changes">
                {repo.staged.length > 0 && (
                  <div className="git__group">
                    <span className="micro-label git__group-label">STAGED</span>
                    <ul className="git__list">
                      {repo.staged.map((change) => (
                        <ChangeRow
                          key={`s:${change.path}`}
                          change={change}
                          action="unstage"
                          onAction={() =>
                            client &&
                            void runMutation(() => client.gitUnstage([change.path], instanceId))
                          }
                          onDiff={() => void onViewDiff(change.path, true)}
                        />
                      ))}
                    </ul>
                  </div>
                )}

                {repo.unstaged.length > 0 && (
                  <div className="git__group">
                    <span className="micro-label git__group-label">CHANGED</span>
                    <ul className="git__list">
                      {repo.unstaged.map((change) => (
                        <ChangeRow
                          key={`u:${change.path}`}
                          change={change}
                          action="stage"
                          onAction={() =>
                            client &&
                            void runMutation(() => client.gitStage([change.path], instanceId))
                          }
                          onDiff={() => void onViewDiff(change.path, false)}
                        />
                      ))}
                    </ul>
                  </div>
                )}

                {repo.untracked.length > 0 && (
                  <div className="git__group">
                    <span className="micro-label git__group-label">UNTRACKED</span>
                    <ul className="git__list">
                      {repo.untracked.map((path) => (
                        <UntrackedRow
                          key={`t:${path}`}
                          path={path}
                          onStage={() =>
                            client && void runMutation(() => client.gitStage([path], instanceId))
                          }
                        />
                      ))}
                    </ul>
                  </div>
                )}
              </div>
            )}

            {openDiff !== undefined && diffHunks.length > 0 && (
              <DiffPanel
                label={`${openDiff.path}${openDiff.staged ? ' · staged' : ''}`}
                hunks={diffHunks}
              />
            )}
          </section>

          <section className="page__section git__commit">
            <span className="micro-label git__group-label">CONVENTIONAL COMMIT</span>
            <div className="git__commit-fields">
              <select
                className="git__select mono-data"
                aria-label="commit type"
                value={ctype}
                onChange={(e) => setCtype(e.target.value)}
              >
                {COMMIT_TYPES.map((t) => (
                  <option key={t} value={t}>
                    {t}
                  </option>
                ))}
              </select>
              <input
                className="git__input mono-data"
                placeholder="scope (optional)"
                aria-label="commit scope"
                value={scope}
                onChange={(e) => setScope(e.target.value)}
              />
              <input
                className="git__input git__input--grow mono-data"
                placeholder="subject"
                aria-label="commit subject"
                value={subject}
                onChange={(e) => setSubject(e.target.value)}
              />
              <label className="git__breaking micro-label">
                <input
                  type="checkbox"
                  checked={breaking}
                  onChange={(e) => setBreaking(e.target.checked)}
                />
                breaking
              </label>
            </div>
            <textarea
              className="git__body mono-data"
              placeholder="body (optional)"
              aria-label="commit body"
              rows={3}
              value={body}
              onChange={(e) => setBody(e.target.value)}
            />
            {commitMessage !== '' && (
              <pre className="git__preview mono-data" aria-label="commit message preview">
                {commitMessage}
              </pre>
            )}
            <div className="git__commit-actions">
              <Button
                label={busy ? 'committing…' : 'commit'}
                variant="primary"
                disabled={busy || commitMessage === '' || repo.staged.length === 0}
                onClick={onCommit}
              />
              {repo.staged.length === 0 && (
                <span className="micro-label git__hint">stage a file to commit</span>
              )}
            </div>
          </section>

          <section className="page__section">
            <span className="micro-label git__group-label">TIMELINE</span>
            <CommitTimeline commits={commits} />
          </section>
        </>
      )}
    </main>
  );
}
