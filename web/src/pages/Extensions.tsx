import { useEffect, useMemo, useState } from 'react';
import type {
  ExtensionInventoryResponse,
  ExtensionProvider,
  ExtensionProviderState,
} from '../api/index.js';
import {
  ChipRow,
  EmptyState,
  Notice,
  Pill,
  SearchInput,
  SourceBadge,
  Table,
  type SourceScope,
} from '../components/core/index.js';
import { routeHash } from '../routes.js';
import {
  integrationInventoryTerm,
  integrationInventoryTermLower,
} from '../lib/agentTerminology.js';
import { useAppState } from '../state/index.js';
import { capabilityLabels, filterExtensions, groupExtensions } from './extensions/logic.js';
import './extensions.css';

type LoadStatus = 'loading' | 'ok' | 'error';
const providerStateTone: Record<ExtensionProviderState, 'ok' | 'warn' | 'err' | 'off'> = {
  supported: 'ok',
  detected: 'warn',
  unavailable: 'warn',
  unsupported: 'off',
  error: 'err',
};
const scopeMap: Record<string, SourceScope> = {
  global: 'global',
  user: 'global',
  project: 'project',
  local: 'local',
};

function scopeBadge(scope: string) {
  const mapped = scopeMap[scope.toLowerCase()];
  return mapped ? <SourceBadge scope={mapped} /> : <span className="mono">{scope || '—'}</span>;
}

function providerMessage(provider: ExtensionProvider) {
  if (provider.state === 'supported' || provider.state === 'detected') return null;
  return (
    provider.reason ||
    (provider.state === 'unavailable'
      ? 'The provider was detected, but its extension inventory is unavailable.'
      : 'Installed extensions are not supported for this provider yet.')
  );
}

export function Extensions() {
  const { client, agentScopeKind } = useAppState();
  const inventoryTerm = integrationInventoryTerm(agentScopeKind);
  const inventoryTermLower = integrationInventoryTermLower(agentScopeKind);
  const [data, setData] = useState<ExtensionInventoryResponse>();
  const [status, setStatus] = useState<LoadStatus>('loading');
  const [query, setQuery] = useState('');
  const [providerId, setProviderId] = useState('all');

  useEffect(() => {
    let cancelled = false;
    if (!client) {
      setStatus('error');
      return;
    }
    setStatus('loading');
    void client
      .getExtensions()
      .then((response) => {
        if (!cancelled) {
          setData(response);
          setStatus('ok');
        }
      })
      .catch(() => {
        if (!cancelled) setStatus('error');
      });
    return () => {
      cancelled = true;
    };
  }, [client]);

  const providers = data?.providers ?? [];
  const filtered = useMemo(
    () => filterExtensions(data?.extensions ?? [], query, providerId),
    [data, query, providerId],
  );
  const groups = useMemo(() => groupExtensions(providers, filtered), [providers, filtered]);
  const providerOptions = [
    { value: 'all', label: 'All providers' },
    ...providers.map((p) => ({ value: p.id, label: p.displayName })),
  ];

  return (
    <main className="layout-main page">
      <section className="page__section">
        <h1 className="title-page">{inventoryTerm}</h1>
        <p className="page-sub">
          Installed {inventoryTermLower} for the selected agent, normalized by provider and scope.
          This page is read-only.
        </p>
      </section>
      {inventoryTerm === 'Plugins' && (
        <section className="page__section extensions__marketplace-note">
          <Notice tone="info">
            Looking for Claude plugins to browse or install?{' '}
            <a className="lr-link" href={routeHash({ name: 'marketplace' })}>
              Open Marketplace
            </a>{' '}
            — it remains a separate Claude Code experience.
          </Notice>
        </section>
      )}
      {status === 'loading' && (
        <section className="page__section">
          <p className="meta">Loading {inventoryTermLower}…</p>
        </section>
      )}
      {status === 'error' && (
        <section className="page__section">
          <EmptyState
            title={`No ${inventoryTermLower}`}
            instruction={`The ${inventoryTermLower} inventory could not be loaded. Reopen agentconfig or try again later.`}
          />
        </section>
      )}
      {status === 'ok' && data && (
        <>
          <section className="page__section">
            <div className="toolbar">
              <SearchInput
                value={query}
                onChange={setQuery}
                placeholder={`Filter ${inventoryTermLower}…`}
                label={`search ${inventoryTermLower}`}
              />
              <ChipRow
                options={providerOptions}
                label="Provider filter"
                value={providerId}
                onChange={setProviderId}
              />
              <span className="meta" role="status">
                {filtered.length} installed
              </span>
            </div>
          </section>
          <section className="page__section extensions__providers">
            <h2 className="title-section">Providers</h2>
            {providers.map((provider) => (
              <div className="extensions__provider" key={provider.id}>
                <div>
                  <strong>{provider.displayName}</strong>
                  <span className="meta"> {provider.kind}</span>
                </div>
                <Pill tone={providerStateTone[provider.state]}>{provider.state}</Pill>
                {providerMessage(provider) && (
                  <p className="meta extensions__reason">{providerMessage(provider)}</p>
                )}
                <div className="extensions__caps">
                  {capabilityLabels(provider).map((capability) => (
                    <span className="chip" key={capability}>
                      {capability}
                    </span>
                  ))}
                </div>
              </div>
            ))}
            {providers.length === 0 && (
              <EmptyState instruction="No runtime providers have been configured." />
            )}
          </section>
          <section className="page__section">
            <h2 className="title-section">Installed</h2>
            {groups.length === 0 ? (
              <EmptyState
                instruction={
                  query || providerId !== 'all'
                    ? `No installed ${inventoryTermLower} match the current filters.`
                    : `No installed ${inventoryTermLower} were reported.`
                }
              />
            ) : (
              groups.map((group) => (
                <div className="extensions__group" key={`${group.provider.id}-${group.scope}`}>
                  <div className="extensions__group-head">
                    <h3>{group.provider.displayName}</h3>
                    {scopeBadge(group.scope)}
                    <span className="meta">
                      {group.extensions.length} {inventoryTermLower.slice(0, -1)}
                      {group.extensions.length === 1 ? '' : 's'}
                    </span>
                  </div>
                  <Table headers={[inventoryTerm.slice(0, -1), 'Version', 'Source', 'State']}>
                    {group.extensions.map((extension) => (
                      <tr key={`${extension.providerId}-${extension.scope}-${extension.id}`}>
                        <td>
                          <strong>{extension.name || extension.id}</strong>
                          <div className="meta mono">{extension.id}</div>
                        </td>
                        <td className="mono">{extension.version || '—'}</td>
                        <td className="mono">{extension.source || '—'}</td>
                        <td>
                          <Pill tone={extension.enabled ? 'ok' : 'off'}>
                            {extension.enabled ? 'enabled' : 'disabled'}
                          </Pill>
                        </td>
                      </tr>
                    ))}
                  </Table>
                </div>
              ))
            )}
          </section>
        </>
      )}
    </main>
  );
}
