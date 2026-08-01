/**
 * Git (route `#/git`) — the GIT PANEL (SPEC §5 row 10, bead agentconfig-ngs.1),
 * SCOPED to the launched repo (the current instance root): a branch switcher,
 * grouped changes (staged / unstaged / untracked) as Console list-cards with a
 * diff view, a CONVENTIONAL-COMMIT helper, push/pull with an ahead/behind
 * indicator, and the commit timeline.
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
import { bootstrapToken } from '../api/token.js';
import {
  Button,
  DiffPanel,
  EmptyState,
  Field,
  Input,
  ListCard,
  ListRow,
  Notice,
  Pill,
  Select,
  Switch,
  Table,
  useToast,
  type PillTone,
} from '../components/core/index.js';
import { useAppState } from '../state/index.js';
import { resolveOperateTarget, type NavigationTarget } from '../navigation.js';
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

const bootToken = typeof window !== 'undefined' ? bootstrapToken() : undefined;

type Phase = 'loading' | 'ok' | 'error';

/** Console pill tone for a porcelain status-tone token. */
const TONE_PILL: Record<ReturnType<typeof statusTone>, PillTone> = {
  add: 'ok',
  mod: 'warn',
  del: 'err',
};

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

/** One change row: the path (text), a status pill, and stage/unstage + diff. */
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
    <ListRow
      title={
        <span className="mono-data git-path">
          {change.orig ? `${change.orig} → ${change.path}` : change.path}
        </span>
      }
      badge={<Pill tone={TONE_PILL[statusTone(change.status)]}>{statusLabel(change.status)}</Pill>}
      trailing={
        <span className="git-row-actions">
          <Button label="Diff" variant="ghost" onClick={onDiff} />
          <Button label={action === 'stage' ? 'Stage' : 'Unstage'} onClick={onAction} />
        </span>
      }
    />
  );
}

/** One untracked-file row (no diff — nothing tracked yet). */
function UntrackedRow({ path, onStage }: { path: string; onStage: () => void }) {
  return (
    <ListRow
      title={<span className="mono-data git-path">{path}</span>}
      badge={<Pill tone="off">untracked</Pill>}
      trailing={
        <span className="git-row-actions">
          <Button label="Stage" onClick={onStage} />
        </span>
      }
    />
  );
}

function CommitTimeline({ commits }: { commits: GitCommit[] }) {
  if (commits.length === 0) {
    return <EmptyState instruction="no commits yet" />;
  }
  return (
    <Table headers={['HASH', 'SUBJECT', 'AUTHOR · DATE']}>
      {commits.map((commit) => (
        <tr key={commit.hash}>
          <td className="mono muted">{commit.hash.slice(0, 8)}</td>
          <td className="git-subject">{commit.subject}</td>
          <td className="mono muted git-log-meta">
            {commit.author} · {commit.date.slice(0, 10)}
          </td>
        </tr>
      ))}
    </Table>
  );
}

function GitPanel({ target }: { target?: NavigationTarget }) {
  const { currentInstance, instances, report } = useAppState();
  const client = useMemo(() => (bootToken ? new ApiClient(bootToken) : undefined), []);
  const resolvedTarget = useMemo(
    () => resolveOperateTarget(target, instances, currentInstance?.id),
    [currentInstance?.id, instances, target],
  );
  const instanceId = resolvedTarget?.instanceId;
  const displayInstance =
    instances.find((instance) => instance.id === instanceId) ?? currentInstance;
  const toast = useToast();

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
  // Success confirms via toast; a refusal surfaces as a warn notice.
  const runMutation = useCallback(
    async (
      op: () => Promise<{ ok?: boolean; message?: string } & Record<string, unknown>>,
      confirm?: string,
    ) => {
      if (busy) return;
      setBusy(true);
      setNotice(undefined);
      try {
        const res = await op();
        if ('ok' in res && res.ok === false) {
          setNotice(res.message && res.message !== '' ? res.message : 'git refused the operation');
        } else if (confirm !== undefined) {
          toast(confirm);
        }
      } catch (err) {
        setNotice(err instanceof ApiError ? `refused (${err.kind})` : 'operation failed');
      } finally {
        setBusy(false);
        await refresh();
      }
    },
    [busy, refresh, toast],
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
    }, 'Committed');
  }, [client, commitMessage, instanceId, runMutation]);

  if (phase === 'error') {
    return (
      <main className="layout-main page">
        <section className="page__section">
          <div className="page-head">
            <h1>Git</h1>
          </div>
          <EmptyState title="Git unavailable" instruction={errMsg} />
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
        <div className="page-head">
          <div>
            <h1>Git</h1>
            <p className="page-sub">
              Branches, changes, conventional commits, and the timeline for{' '}
              <span className="mono">{displayInstance ? displayInstance.name : 'no instance'}</span>
              .
            </p>
          </div>
        </div>
      </section>

      {phase === 'loading' && (
        <section className="page__section">
          <p className="meta">reading git…</p>
        </section>
      )}

      {gitAbsent && (
        <section className="page__section">
          <Notice>git is not installed on this machine — the git panel needs a git binary.</Notice>
        </section>
      )}

      {notRepo && (
        <section className="page__section">
          <Notice>
            The launched instance is not a git repository — initialize one with{' '}
            <span className="code">git init</span> to use this panel.
          </Notice>
        </section>
      )}

      {repo && (
        <>
          <section className="page__section git-head">
            <div className="git-branchline">
              <span className="micro-label">BRANCH</span>
              <Select
                className="git-select mono"
                aria-label="switch branch"
                value={repo.detached ? '' : repo.branch}
                disabled={busy}
                onChange={(e) => {
                  const branch = e.target.value;
                  if (branch !== '' && branch !== repo.branch && client) {
                    void runMutation(
                      () => client.gitCheckout(branch, false, instanceId),
                      'Switched branch',
                    );
                  }
                }}
              >
                {repo.detached && <option value="">(detached)</option>}
                {branches.map((b) => (
                  <option key={b.name} value={b.name}>
                    {b.name}
                  </option>
                ))}
              </Select>
              {syncSummary(repo.ahead, repo.behind) !== '' && (
                <span className="mono win">{syncSummary(repo.ahead, repo.behind)}</span>
              )}
              {repo.upstream !== undefined && (
                <span className="meta git-upstream">→ {repo.upstream}</span>
              )}
            </div>

            <div className="git-head-actions">
              <Input
                className="git-newbranch mono"
                placeholder="new-branch"
                aria-label="new branch name"
                value={newBranch}
                onChange={(e) => setNewBranch(e.target.value)}
              />
              <Button
                label="Create + switch"
                disabled={busy || newBranch.trim() === ''}
                onClick={() => {
                  if (client && newBranch.trim() !== '') {
                    const name = newBranch.trim();
                    void runMutation(
                      () => client.gitCheckout(name, true, instanceId),
                      'Created branch',
                    );
                    setNewBranch('');
                  }
                }}
              />
              <Button
                label="Pull"
                disabled={busy}
                onClick={() =>
                  client && void runMutation(() => client.gitPull(instanceId), 'Pulled')
                }
              />
              <Button
                label="Push"
                variant="primary"
                disabled={busy}
                onClick={() =>
                  client && void runMutation(() => client.gitPush(instanceId), 'Pushed')
                }
              />
            </div>
          </section>

          {notice !== undefined && (
            <section className="page__section">
              <Notice>
                <span role="status">{notice}</span>
              </Notice>
            </section>
          )}

          <section className="page__section">
            {!hasChanges(repo.staged, repo.unstaged, repo.untracked) ? (
              <EmptyState instruction="working tree clean — nothing to stage or commit" />
            ) : (
              <>
                {repo.staged.length > 0 && (
                  <ListCard
                    head="STAGED"
                    headMeta={`${repo.staged.length} file${repo.staged.length === 1 ? '' : 's'}`}
                  >
                    {repo.staged.map((change) => (
                      <ChangeRow
                        key={`s:${change.path}`}
                        change={change}
                        action="unstage"
                        onAction={() =>
                          client &&
                          void runMutation(
                            () => client.gitUnstage([change.path], instanceId),
                            'Unstaged',
                          )
                        }
                        onDiff={() => void onViewDiff(change.path, true)}
                      />
                    ))}
                  </ListCard>
                )}

                {repo.unstaged.length > 0 && (
                  <ListCard
                    head="CHANGED"
                    headMeta={`${repo.unstaged.length} file${
                      repo.unstaged.length === 1 ? '' : 's'
                    }`}
                  >
                    {repo.unstaged.map((change) => (
                      <ChangeRow
                        key={`u:${change.path}`}
                        change={change}
                        action="stage"
                        onAction={() =>
                          client &&
                          void runMutation(
                            () => client.gitStage([change.path], instanceId),
                            'Staged',
                          )
                        }
                        onDiff={() => void onViewDiff(change.path, false)}
                      />
                    ))}
                  </ListCard>
                )}

                {repo.untracked.length > 0 && (
                  <ListCard
                    head="UNTRACKED"
                    headMeta={`${repo.untracked.length} file${
                      repo.untracked.length === 1 ? '' : 's'
                    }`}
                  >
                    {repo.untracked.map((path) => (
                      <UntrackedRow
                        key={`t:${path}`}
                        path={path}
                        onStage={() =>
                          client &&
                          void runMutation(() => client.gitStage([path], instanceId), 'Staged')
                        }
                      />
                    ))}
                  </ListCard>
                )}
              </>
            )}

            {openDiff !== undefined && diffHunks.length > 0 && (
              <DiffPanel
                label={`${openDiff.path}${openDiff.staged ? ' · staged' : ''}`}
                hunks={diffHunks}
              />
            )}
          </section>

          <section className="page__section">
            <div className="card git-commit">
              <h2>Conventional commit</h2>
              <div className="git-commit-fields">
                <Field label="Type" htmlFor="git-commit-type">
                  <Select
                    id="git-commit-type"
                    className="mono"
                    value={ctype}
                    onChange={(e) => setCtype(e.target.value)}
                  >
                    {COMMIT_TYPES.map((t) => (
                      <option key={t} value={t}>
                        {t}
                      </option>
                    ))}
                  </Select>
                </Field>
                <Field label="Scope (optional)" htmlFor="git-commit-scope">
                  <Input
                    id="git-commit-scope"
                    className="mono"
                    placeholder="scope"
                    value={scope}
                    onChange={(e) => setScope(e.target.value)}
                  />
                </Field>
                <Field label="Subject" htmlFor="git-commit-subject">
                  <Input
                    id="git-commit-subject"
                    placeholder="subject"
                    value={subject}
                    onChange={(e) => setSubject(e.target.value)}
                  />
                </Field>
                <div className="field git-breaking">
                  <label>Breaking</label>
                  <Switch
                    on={breaking}
                    onChange={setBreaking}
                    label="breaking change"
                    disabled={busy}
                  />
                </div>
              </div>
              <Field label="Body (optional)" htmlFor="git-commit-body">
                <textarea
                  id="git-commit-body"
                  className="input mono git-body"
                  placeholder="body"
                  rows={3}
                  value={body}
                  onChange={(e) => setBody(e.target.value)}
                />
              </Field>
              {commitMessage !== '' && (
                <pre className="mono-data git-preview" aria-label="commit message preview">
                  {commitMessage}
                </pre>
              )}
              <div className="git-commit-actions">
                <Button
                  label={busy ? 'Committing…' : 'Commit'}
                  variant="primary"
                  disabled={busy || commitMessage === '' || repo.staged.length === 0}
                  onClick={onCommit}
                />
                {repo.staged.length === 0 && <span className="meta">stage a file to commit</span>}
              </div>
            </div>
          </section>

          <section className="page__section">
            <h2 className="git-section-head">Timeline</h2>
            <CommitTimeline commits={commits} />
          </section>
        </>
      )}
    </main>
  );
}

export function Git({ target }: { target?: NavigationTarget }) {
  // Toasts confirm through the shell-level ToastProvider (App.tsx).
  return <GitPanel target={target} />;
}
