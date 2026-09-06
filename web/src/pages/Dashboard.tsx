/**
 * Dashboard (route `#/dashboard`) — the SESSION ANALYTICS view (SPEC §5 row 1,
 * bead 7yb.2). Live stats from THIS machine's runtime history: session /
 * message counts, streaks, an activity heatmap, XP + level, and the
 * achievements catalog. Console treatment (opendesign/DESIGN.md §5): stat
 * `.tile` rows instead of giant numerals, a thin accent progress bar for level
 * progress, and the Heatmap primitive. Distinct from Overview, which inspects
 * the current instance's config report.
 *
 * The served stats are CONTENT-FREE aggregates + achievement metadata (never
 * message bodies). Achievement names/descriptions are our own catalog text;
 * every value here is a number or catalog string, rendered as text nodes only.
 *
 * CLIENT SEAM: like Catalog/Marketplace/Settings, the shell keeps its ApiClient
 * private, so this page captures the launch token at module load and builds its
 * own client.
 */

import { useEffect, useMemo, useState } from 'react';
import { ApiClient, ApiError, type AchievementMeta, type StatsResponse } from '../api/index.js';
import { bootstrapToken } from '../api/token.js';
import { EmptyState, Heatmap, StatBlock } from '../components/core/index.js';
import {
  achievementProgressLabel,
  activityRange,
  costCaption,
  formatRuntimes,
  formatUsageInputTokens,
  formatUsageCost,
  formatUsageOutputTokens,
  formatUsageTokens,
  groupThousands,
  hasNoHistory,
  levelProgressLevel,
  usageMessagesCaption,
} from './dashboard/logic.js';
import './dashboard.css';

const bootToken = typeof window !== 'undefined' ? bootstrapToken() : undefined;

type LoadStatus = 'loading' | 'ok' | 'error';

function loadError(err: unknown): string {
  if (err instanceof ApiError) {
    if (err.kind === 'unauthorized') return 'Session expired — reopen from the CLI.';
    if (err.kind === 'network') return 'Cannot reach the local server.';
  }
  return 'Could not load session stats.';
}

/** One achievement chip. Name + description are our own catalog text nodes. */
function AchievementChip({ meta, unlocked }: { meta: AchievementMeta; unlocked: boolean }) {
  return (
    <li className={`dash-ach ${unlocked ? 'dash-ach--on' : 'dash-ach--off'}`}>
      <span className="dash-ach__dot" aria-hidden="true" />
      <span className="dash-ach__body">
        <span className="dash-ach__name">{meta.name}</span>
        <span className="dash-ach__desc meta">{meta.description}</span>
      </span>
      <span className="dash-ach__cat table-header">{meta.category}</span>
    </li>
  );
}

export function Dashboard() {
  const client = useMemo(() => (bootToken ? new ApiClient(bootToken) : undefined), []);

  const [data, setData] = useState<StatsResponse | undefined>();
  const [status, setStatus] = useState<LoadStatus>('loading');
  const [errMsg, setErrMsg] = useState('');

  useEffect(() => {
    let cancelled = false;
    if (!client) {
      setStatus('error');
      setErrMsg('Session token missing.');
      return;
    }
    setStatus('loading');
    void (async () => {
      try {
        const res = await client.getStats();
        if (cancelled) return;
        setData(res);
        setStatus('ok');
      } catch (err) {
        if (cancelled) return;
        setErrMsg(loadError(err));
        setStatus('error');
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [client]);

  const stats = data?.stats;
  const achievements = data?.achievements;
  const unlockedIds = useMemo(
    () => new Set((achievements?.unlocked ?? []).map((a) => a.id)),
    [achievements],
  );
  const catalog = useMemo(
    () => [...(achievements?.unlocked ?? []), ...(achievements?.locked ?? [])],
    [achievements],
  );

  return (
    <main className="layout-main page">
      <section className="page__section">
        <h1 className="title-page">Dashboard</h1>
        <p className="page-sub">
          Live session analytics from this machine&apos;s runtime history — counts, streaks,
          activity, XP &amp; achievements.
        </p>
      </section>

      {status === 'loading' && (
        <section className="page__section">
          <p className="meta">Loading session stats…</p>
        </section>
      )}

      {status === 'error' && (
        <section className="page__section">
          <EmptyState title="No stats" instruction={errMsg} />
        </section>
      )}

      {status === 'ok' && stats && hasNoHistory(stats) && (
        <section className="page__section">
          <EmptyState title="No stats" instruction="This machine has no session history yet." />
        </section>
      )}

      {status === 'ok' && stats && achievements && !hasNoHistory(stats) && (
        <>
          <section className="page__section">
            <div className="tile-row">
              <StatBlock value={groupThousands(stats.sessionCount)} label="Sessions" />
              <StatBlock value={groupThousands(stats.messageCounts.total)} label="Messages" />
              <StatBlock value={stats.streak.current} label="Current streak" />
              <StatBlock value={stats.streak.longest} label="Longest streak" />
            </div>
            <div className="tile-row">
              <StatBlock value={stats.xp.level} label="Level" />
              <StatBlock value={groupThousands(stats.xp.xp)} label="XP" />
              <StatBlock value={groupThousands(stats.activeDays)} label="Active days" />
              <StatBlock value={groupThousands(stats.promptCount)} label="Prompts" />
            </div>
            <div className="tile-row">
              <StatBlock
                value={formatUsageTokens(stats.usage)}
                label="Tokens"
                caption={usageMessagesCaption(stats.usage)}
              />
              <StatBlock
                value={formatUsageCost(stats.usage)}
                label="Estimated cost"
                caption={costCaption(stats.usage)}
              />
              <StatBlock
                value={formatUsageInputTokens(stats.usage)}
                label="Input tokens"
                caption="fresh only"
              />
              <StatBlock value={formatUsageOutputTokens(stats.usage)} label="Output tokens" />
            </div>
            <div
              className="dash__progress"
              role="progressbar"
              aria-label="level progress"
              aria-valuemin={0}
              aria-valuemax={100}
              aria-valuenow={Math.round(levelProgressLevel(stats) * 100)}
            >
              <span
                className="dash__progress-fill"
                style={{ width: `${levelProgressLevel(stats) * 100}%` }}
              />
            </div>
            <p className="meta dash__progress-note">
              {groupThousands(stats.xp.xpIntoLevel)} / {groupThousands(stats.xp.xpForNextLevel)} XP
              to next level · runtimes: {formatRuntimes(stats.runtimes)}
            </p>
          </section>

          <section className="page__section">
            <div className="dash__section-head">
              <h2 className="title-section">Activity</h2>
              {activityRange(stats) !== '' && <span className="meta">{activityRange(stats)}</span>}
            </div>
            <Heatmap cells={stats.heatmap} label="session activity calendar" />
            {data.capped && (
              <p className="meta dash__note">
                Showing the most recent {groupThousands(data.sessionsScanned)} of{' '}
                {groupThousands(data.sessionsTotal)} sessions.
              </p>
            )}
          </section>

          <section className="page__section">
            <div className="dash__section-head">
              <h2 className="title-section">Achievements</h2>
              <span className="meta">{achievementProgressLabel(achievements)}</span>
            </div>
            <ul className="dash__ach-list">
              {catalog.map((meta) => (
                <AchievementChip key={meta.id} meta={meta} unlocked={unlockedIds.has(meta.id)} />
              ))}
            </ul>
          </section>
        </>
      )}
    </main>
  );
}
