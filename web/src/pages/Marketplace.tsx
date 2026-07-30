/**
 * Marketplace (route `#/marketplace`) — the Claude Code PLUGIN MARKETPLACE
 * surface (SPEC §4.5, §5 row 9, bead 0zm.5): browse + search the marketplace
 * (install counts, version, source), one-click INSTALL, and the installed list
 * (version/scope/date), alongside our own registry CATALOG. The server SHELLS
 * OUT to the `claude` CLI; every plugin field is that subprocess's UNTRUSTED
 * output — rendered here as TEXT NODES only, never markup. Console treatment
 * (opendesign/DESIGN.md §5): `.toolbar` search, installed `.ds-table` with
 * scope badges, `.card` plugin entries with an `installed` pill; an install
 * confirms via Toast.
 *
 * CLI-ABSENT: the server degrades to `{ available:false, reason }` (a 200), which
 * this page renders as a capability-gap `.notice` — never a crash, never a
 * failure toast.
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
import { bootstrapToken } from '../api/token.js';
import {
  Button,
  EmptyState,
  Notice,
  Pill,
  SearchInput,
  SourceBadge,
  Table,
  useToast,
  type SourceScope,
} from '../components/core/index.js';
import {
  filterPlugins,
  formatInstallCount,
  installedKeys,
  isPluginInstalled,
} from './marketplace/logic.js';
import './marketplace.css';

const bootToken = typeof window !== 'undefined' ? bootstrapToken() : undefined;

type LoadStatus = 'loading' | 'ok' | 'error';

function loadError(err: unknown): string {
  if (err instanceof ApiError) {
    if (err.kind === 'unauthorized') return 'Session expired — reopen from the CLI.';
    if (err.kind === 'network') return 'Cannot reach the local server.';
  }
  return 'Could not load the marketplace.';
}

/** Claude's scope words → our badge scopes ('user' wears the GLOBAL badge). */
const PLUGIN_SCOPES: Record<string, SourceScope> = {
  project: 'project',
  local: 'local',
  user: 'global',
  global: 'global',
};

/** A scope badge when the CLI's scope word maps, mono text otherwise. */
function PluginScope({ scope }: { scope: string }) {
  const mapped = PLUGIN_SCOPES[scope.trim().toLowerCase()];
  if (mapped !== undefined) return <SourceBadge scope={mapped} />;
  return <span className="mono">{scope || '—'}</span>;
}

/** One plugin card. Each field is untrusted CLI output → text node. */
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
  const toast = useToast();
  const [phase, setPhase] = useState<'idle' | 'installing' | 'error'>('idle');
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
        if (res.installed) {
          toast('Plugin installed');
          setPhase('idle');
          onChanged();
          return;
        }
        setMessage(res.message || 'install failed');
        setPhase('error');
      } catch (err) {
        setMessage(loadError(err));
        setPhase('error');
      }
    })();
  }, [client, plugin.id, onChanged, toast]);

  return (
    <li className="card mkt-card">
      <div className="mkt-card__head">
        <span className="mkt-card__name mono">{plugin.name}</span>
        {installed && (
          <span className="mkt-card__state">
            <Pill tone="ok">installed</Pill>
          </span>
        )}
      </div>

      <p className="mkt-card__desc">{plugin.description}</p>

      <div className="mkt-card__meta meta">
        <span>{plugin.marketplace}</span>
        {plugin.version !== '' && <span>{plugin.version}</span>}
        <span>{formatInstallCount(plugin.installCount)} installs</span>
        {plugin.source !== '' && <span className="mkt-card__source">{plugin.source}</span>}
      </div>

      <div className="mkt-card__actions">
        {!installed && phase === 'idle' && (
          <Button label="Install" variant="primary" onClick={install} />
        )}
        {phase === 'installing' && <span className="meta">Installing…</span>}
        {phase === 'error' && (
          <span className="meta mkt-card__msg--error" role="status">
            {message}
          </span>
        )}
      </div>
    </li>
  );
}

function MarketplacePage() {
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
      setErrMsg('Session token missing.');
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
        <h1 className="title-page">Marketplace</h1>
        <p className="page-sub">
          Browse &amp; install Claude Code plugins from the marketplace — install counts, versions,
          one-click install via the claude CLI.
        </p>
      </section>

      {status === 'loading' && (
        <section className="page__section">
          <p className="meta">Loading marketplace…</p>
        </section>
      )}
      {status === 'error' && (
        <section className="page__section">
          <EmptyState title="No marketplace" instruction={errMsg} />
        </section>
      )}

      {status === 'ok' && data && !data.available && (
        <section className="page__section">
          <Notice>
            Claude CLI not found — install it to browse the plugin marketplace.
            {data.reason !== '' && (
              <>
                {' '}
                <span className="meta">{data.reason}</span>
              </>
            )}
          </Notice>
        </section>
      )}

      {status === 'ok' && available && client && (
        <>
          <section className="page__section">
            <div className="toolbar">
              <SearchInput
                value={query}
                onChange={setQuery}
                placeholder="Filter by name, description, marketplace…"
                label="search marketplace"
              />
              <span className="meta" role="status">
                {query.trim() !== ''
                  ? `${filtered.length} of ${plugins.length} plugins`
                  : `${plugins.length} plugins`}
                {' · '}
                {installed.length} installed
              </span>
            </div>
          </section>

          {installed.length > 0 && (
            <section className="page__section">
              <h2 className="title-section mkt__shelf-title">Installed</h2>
              <Table headers={['Plugin', 'Version', 'Scope', 'Installed']}>
                {installed.map((rec: InstalledPlugin) => (
                  <tr key={rec.id}>
                    <td className="mono">{rec.name}</td>
                    <td className="mono">{rec.version || '—'}</td>
                    <td>
                      <PluginScope scope={rec.scope} />
                    </td>
                    <td className="mono muted">{rec.installedAt || '—'}</td>
                  </tr>
                ))}
              </Table>
            </section>
          )}

          <section className="page__section">
            <h2 className="title-section mkt__shelf-title">Available</h2>
            {filtered.length === 0 ? (
              <EmptyState instruction={`No plugins match "${query}".`} />
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

export function Marketplace() {
  // Toasts confirm through the shell-level ToastProvider (App.tsx).
  return <MarketplacePage />;
}
