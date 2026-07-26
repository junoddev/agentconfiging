/**
 * Marketplace (rail `16 MARKETPLACE`, route `#/marketplace`) — the Claude Code
 * PLUGIN MARKETPLACE surface (SPEC §4.5, §5 row 9, bead 0zm.5): browse + search
 * the marketplace (install counts, version, source), one-click INSTALL, and the
 * installed list (version/scope/date), alongside our own registry CATALOG (rail
 * 15). The server SHELLS OUT to the `claude` CLI; every plugin field is that
 * subprocess's UNTRUSTED output — rendered here as TEXT NODES only, never markup.
 *
 * CLI-ABSENT: the server degrades to `{ available:false, reason }` (a 200), which
 * this page renders as a clear EmptyState — never a crash, never a failure toast.
 *
 * CLIENT SEAM: like Catalog/Settings, the shell keeps its ApiClient private, so
 * this page captures the launch token at module load and builds its own client.
 */

import { useCallback, useEffect, useMemo, useState } from 'react';
import {
  ApiClient,
  ApiError,
  type InstalledPlugin,
  type MarketplacePlugin,
  type MarketplaceResponse,
} from '../api/index.js';
import { parseTokenHash } from '../api/token.js';
import { Button, EmptyState } from '../components/core/index.js';
import {
  filterPlugins,
  formatInstallCount,
  installedKeys,
  isPluginInstalled,
} from './marketplace/logic.js';
import './marketplace.css';

const bootToken =
  typeof window !== 'undefined' ? parseTokenHash(window.location.hash).token : undefined;

type LoadStatus = 'loading' | 'ok' | 'error';

function loadError(err: unknown): string {
  if (err instanceof ApiError) {
    if (err.kind === 'unauthorized') return 'session expired — reopen from the CLI';
    if (err.kind === 'network') return 'cannot reach the local server';
  }
  return 'could not load the marketplace';
}

/** One plugin row. Each field is untrusted CLI output → text node. */
function PluginCard({
  plugin,
  installed,
  client,
  onChanged,
}: {
  plugin: MarketplacePlugin;
  installed: boolean;
  client: ApiClient;
  onChanged: () => void;
}) {
  const [phase, setPhase] = useState<'idle' | 'installing' | 'done' | 'error'>('idle');
  const [message, setMessage] = useState('');

  const install = useCallback(() => {
    setPhase('installing');
    void (async () => {
      try {
        const res = await client.installPlugin(plugin.id);
        if (!res.available) {
          setMessage(res.reason);
          setPhase('error');
          return;
        }
        setMessage(res.installed ? 'installed' : res.message || 'install failed');
        setPhase(res.installed ? 'done' : 'error');
        if (res.installed) onChanged();
      } catch (err) {
        setMessage(loadError(err));
        setPhase('error');
      }
    })();
  }, [client, plugin.id, onChanged]);

  return (
    <li className="mkt-card surface">
      <div className="mkt-card__head">
        <span className="mkt-card__name mono-data">{plugin.name}</span>
        {installed && <span className="mkt-card__installed micro-label">INSTALLED</span>}
      </div>

      <p className="mkt-card__desc">{plugin.description}</p>

      <div className="mkt-card__meta micro-label">
        <span>{plugin.marketplace}</span>
        {plugin.version !== '' && <span>{plugin.version}</span>}
        <span>{formatInstallCount(plugin.installCount)} installs</span>
        {plugin.source !== '' && <span className="mkt-card__source">{plugin.source}</span>}
      </div>

      <div className="mkt-card__actions">
        {!installed && phase === 'idle' && (
          <Button label="install" variant="primary" onClick={install} />
        )}
        {phase === 'installing' && <span className="micro-label">installing…</span>}
        {(phase === 'done' || phase === 'error') && (
          <span
            className={`micro-label ${phase === 'error' ? 'mkt-card__msg--error' : 'mkt-card__msg--ok'}`}
            role="status"
          >
            {message}
          </span>
        )}
      </div>
    </li>
  );
}

function InstalledRow({ rec }: { rec: InstalledPlugin }) {
  return (
    <li className="mkt-installed__row">
      <span className="mono-data">{rec.name}</span>
      <span className="micro-label">{rec.version || '—'}</span>
      <span className="micro-label">{rec.scope || '—'}</span>
      <span className="micro-label">{rec.installedAt || '—'}</span>
    </li>
  );
}

export function Marketplace() {
  const client = useMemo(() => (bootToken ? new ApiClient(bootToken) : undefined), []);

  const [data, setData] = useState<MarketplaceResponse | undefined>();
  const [status, setStatus] = useState<LoadStatus>('loading');
  const [errMsg, setErrMsg] = useState('');
  const [reloadKey, setReloadKey] = useState(0);
  const [query, setQuery] = useState('');

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
        const res = await client.getMarketplace();
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
  }, [client, reloadKey]);

  const onChanged = useCallback(() => setReloadKey((k) => k + 1), []);

  const available = data?.available === true;
  const plugins = available ? data.plugins : [];
  const installed = available ? data.installed : [];
  const keys = useMemo(() => installedKeys(installed), [installed]);
  const filtered = useMemo(() => filterPlugins(plugins, query), [plugins, query]);

  return (
    <main className="layout-main page">
      <section className="page__section">
        <h1 className="title-page">MARKETPLACE</h1>
        <p className="mkt__lede micro-label">
          browse &amp; install Claude Code plugins from the marketplace — install counts, versions,
          one-click install via the claude CLI
        </p>
      </section>

      {status === 'loading' && (
        <section className="page__section">
          <p className="micro-label">loading marketplace…</p>
        </section>
      )}
      {status === 'error' && (
        <section className="page__section">
          <EmptyState title="NO SIGNAL" instruction={errMsg} />
        </section>
      )}

      {status === 'ok' && data && !data.available && (
        <section className="page__section">
          <EmptyState
            title="NO CLI"
            instruction="Claude CLI not found — install it to browse the plugin marketplace"
          />
          <p className="mkt__reason micro-label">{data.reason}</p>
        </section>
      )}

      {status === 'ok' && available && client && (
        <>
          <section className="page__section mkt__controls">
            <input
              type="search"
              className="mkt__search mono-data"
              placeholder="search name, description, marketplace…"
              aria-label="search marketplace"
              value={query}
              onChange={(e) => setQuery(e.target.value)}
            />
            <p className="mkt__summary micro-label" role="status">
              {query.trim() !== ''
                ? `${filtered.length} of ${plugins.length} plugins`
                : `${plugins.length} plugins`}
              {' · '}
              {installed.length} installed
            </p>
          </section>

          {installed.length > 0 && (
            <section className="page__section mkt-installed">
              <h2 className="mkt__shelf-title">INSTALLED</h2>
              <div className="mkt-installed__head micro-label">
                <span>plugin</span>
                <span>version</span>
                <span>scope</span>
                <span>date</span>
              </div>
              <ul className="mkt-installed__list">
                {installed.map((rec) => (
                  <InstalledRow key={rec.id} rec={rec} />
                ))}
              </ul>
            </section>
          )}

          <section className="page__section">
            <h2 className="mkt__shelf-title">AVAILABLE</h2>
            {filtered.length === 0 ? (
              <EmptyState instruction="no plugins match this search" />
            ) : (
              <ul className="mkt__list">
                {filtered.map((plugin) => (
                  <PluginCard
                    key={plugin.id}
                    plugin={plugin}
                    installed={isPluginInstalled(plugin, keys)}
                    client={client}
                    onChanged={onChanged}
                  />
                ))}
              </ul>
            )}
          </section>
        </>
      )}
    </main>
  );
}
