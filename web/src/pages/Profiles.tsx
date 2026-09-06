import { useEffect, useState } from 'react';
import { EmptyState, Pill } from '../components/core/index.js';
import type { ProfileCapability, ProfileSummary } from '../api/types.js';
import { useAppState } from '../state/index.js';
import './profiles.css';

const CAPABILITIES: ProfileCapability[] = [
  'instructionArtifacts',
  'settings',
  'models',
  'tools',
  'hookEvents',
  'commands',
  'skills',
  'mcp',
  'extensions',
  'history',
];
const LABELS: Record<ProfileCapability, string> = {
  instructionArtifacts: 'Instructions',
  settings: 'Settings',
  models: 'Models',
  tools: 'Tools',
  hookEvents: 'Hooks',
  commands: 'Commands',
  skills: 'Skills',
  mcp: 'MCP',
  extensions: 'Extensions',
  history: 'History',
};
const tone = (value: string): 'ok' | 'warn' | 'err' | 'off' =>
  value === 'full' || value === 'fresh' || value === 'verified'
    ? 'ok'
    : value === 'partial' || value === 'stale' || value === 'corroborated'
      ? 'warn'
      : value === 'expired'
        ? 'err'
        : 'off';

export function Profiles() {
  const { client } = useAppState();
  const [profiles, setProfiles] = useState<ProfileSummary[]>();
  const [error, setError] = useState<string>();
  useEffect(() => {
    let active = true;
    if (!client) return;
    client.getProfiles().then(
      (value) => active && setProfiles(value.profiles),
      (err: unknown) =>
        active && setError(err instanceof Error ? err.message : 'profile request failed'),
    );
    return () => {
      active = false;
    };
  }, [client]);

  return (
    <main className="layout-main page profiles-page">
      <div className="page-head">
        <div>
          <h1>Profiles</h1>
          <p className="page-sub">
            Upstream runtime support knowledge. This is maintained reference data, separate from
            agents detected in the current folder.
          </p>
        </div>
      </div>
      <div className="profiles-notice">
        <strong>Support matrix</strong>
        <span>Coverage describes what agentconfiging knows, not what is installed locally.</span>
      </div>
      {error ? (
        <EmptyState title="Profiles unavailable" instruction={error} />
      ) : !profiles ? (
        <EmptyState instruction="loading upstream profiles …" />
      ) : (
        <div className="profiles-table-wrap">
          <table className="profiles-table">
            <thead>
              <tr>
                <th>Runtime</th>
                <th>Check</th>
                <th>Trust</th>
                {CAPABILITIES.map((area) => (
                  <th key={area}>{LABELS[area]}</th>
                ))}
              </tr>
            </thead>
            <tbody>
              {profiles.map((profile) => (
                <tr key={profile.id}>
                  <th scope="row">
                    <span className="profiles-name">{profile.displayName}</span>
                    <span className="meta">
                      {profile.vendor} · {profile.supportTier}
                    </span>
                    {profile.pendingDrift && <Pill tone="warn">pending drift</Pill>}
                  </th>
                  <td>
                    <span className="mono">
                      {profile.lastSuccessfulCheck
                        ? new Date(profile.lastSuccessfulCheck).toLocaleDateString()
                        : 'not checked'}
                    </span>
                  </td>
                  <td>
                    <Pill tone={tone(profile.confidence)}>{profile.confidence}</Pill>
                  </td>
                  {CAPABILITIES.map((area) => (
                    <td key={area}>
                      <Pill tone={tone(profile.freshness[area])}>{profile.coverage[area]}</Pill>
                      <span className={`profiles-fresh profiles-fresh--${profile.freshness[area]}`}>
                        {profile.freshness[area]}
                      </span>
                    </td>
                  ))}
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
      {profiles?.map((profile) => (
        <section className="profiles-sources" key={`${profile.id}-sources`}>
          <h2>{profile.displayName} sources</h2>
          <div>
            {profile.sources.length ? (
              profile.sources.map((source) => (
                <a key={source.id} href={source.url} target="_blank" rel="noreferrer">
                  {source.id}
                </a>
              ))
            ) : (
              <span className="meta">No public source links</span>
            )}
          </div>
        </section>
      ))}
    </main>
  );
}
