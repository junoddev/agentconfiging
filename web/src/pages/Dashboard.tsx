/**
 * Dashboard (rail `17 DASHBOARD`, route `#/dashboard`) — the SESSION ANALYTICS
 * view (SPEC §5 row 1, bead 7yb.2). Live stats from THIS machine's runtime
 * history: session / message counts, streaks, an activity heatmap, XP + level,
 * and the achievements catalog. Rendered as Signal Grid stat blocks + a heatmap
 * (DESIGN §6–§7). Distinct from the `01 SIGNAL` overview, which inspects the
 * current instance's config report.
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
import { parseTokenHash } from '../api/token.js';
import { EmptyState, Heatmap, StatBlock } from '../components/core/index.js';
import { VuMeter } from '../components/signal/index.js';
import {
  achievementProgressLabel,
  activityRange,
  formatRuntimes,
  groupThousands,
  hasNoHistory,
  levelProgressLevel,
} from './dashboard/logic.js';
import './dashboard.css';

const bootToken =
  typeof window !== 'undefined' ? parseTokenHash(window.location.hash).token : undefined;

type LoadStatus = 'loading' | 'ok' | 'error';

function loadError(err: unknown): string {
  if (err instanceof ApiError) {
    if (err.kind === 'unauthorized') return 'session expired — reopen from the CLI';
    if (err.kind === 'network') return 'cannot reach the local server';
  }
  return 'could not load session stats';
}

/** One achievement chip. Name + description are our own catalog text nodes. */
function AchievementChip({ meta, unlocked }: { meta: AchievementMeta; unlocked: boolean }) {
  return (
    <li className={`dash-ach ${unlocked ? 'dash-ach--on' : 'dash-ach--off'}`}>
      <span className="dash-ach__dot" aria-hidden="true" />
      <span className="dash-ach__body">
        <span className="dash-ach__name">{meta.name}</span>
        <span className="dash-ach__desc micro-label">{meta.description}</span>
      </span>
      <span className="dash-ach__cat micro-label">{meta.category}</span>
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
      setErrMsg('session token missing');
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
        <h1 className="title-page">DASHBOARD</h1>
        <p className="dash__lede micro-label">
          live session analytics from this machine&apos;s runtime history — counts, streaks,
          activity, XP &amp; achievements
        </p>
      </section>

      {status === 'loading' && (
        <section className="page__section">
          <p className="micro-label dash__acquiring">ACQUIRING SIGNAL</p>
        </section>
      )}

      {status === 'error' && (
        <section className="page__section">
          <EmptyState title="NO SIGNAL" instruction={errMsg} />
        </section>
      )}

      {status === 'ok' && stats && hasNoHistory(stats) && (
        <section className="page__section">
          <EmptyState title="NO SIGNAL" instruction="no session history yet" />
        </section>
      )}

      {status === 'ok' && stats && achievements && !hasNoHistory(stats) && (
        <>
          <section className="page__section">
            <div className="grid-page dash__stats">
              <div className="dash__stat">
                <StatBlock value={groupThousands(stats.sessionCount)} label="SESSIONS" />
              </div>
              <div className="dash__stat col-rule">
                <StatBlock
                  value={groupThousands(stats.messageCounts.total)}
                  label="MESSAGES"
                  size="md"
                />
              </div>
              <div className="dash__stat col-rule">
                <StatBlock value={stats.streak.current} label="CURRENT STREAK" size="md" />
              </div>
              <div className="dash__stat col-rule">
                <StatBlock value={stats.streak.longest} label="LONGEST STREAK" size="md" />
              </div>
            </div>
          </section>

          <section className="page__section dash__xp">
            <div className="dash__xp-figures">
              <StatBlock value={stats.xp.level} label="LEVEL" size="md" />
              <div className="dash__xp-meter">
                <VuMeter level={levelProgressLevel(stats)} label="level progress" />
                <span className="mono-data dash__xp-detail">
                  {groupThousands(stats.xp.xp)} XP · {groupThousands(stats.xp.xpIntoLevel)} /{' '}
                  {groupThousands(stats.xp.xpForNextLevel)} TO NEXT
                </span>
              </div>
            </div>
            <div className="dash__meta micro-label">
              <span>{formatRuntimes(stats.runtimes)}</span>
              <span>{groupThousands(stats.activeDays)} ACTIVE DAYS</span>
              <span>{groupThousands(stats.promptCount)} PROMPTS</span>
            </div>
          </section>

          <section className="page__section">
            <div className="dash__section-head">
              <h2 className="micro-label dash__heading">ACTIVITY</h2>
              {activityRange(stats) !== '' && (
                <span className="mono-data dash__range">{activityRange(stats)}</span>
              )}
            </div>
            <Heatmap cells={stats.heatmap} label="session activity calendar" />
            {data.capped && (
              <p className="micro-label dash__note">
                showing the most recent {groupThousands(data.sessionsScanned)} of{' '}
                {groupThousands(data.sessionsTotal)} sessions
              </p>
            )}
          </section>

          <section className="page__section">
            <div className="dash__section-head">
              <h2 className="micro-label dash__heading">ACHIEVEMENTS</h2>
              <span className="mono-data dash__range">
                {achievementProgressLabel(achievements)}
              </span>
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
