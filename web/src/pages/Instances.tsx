import { useCallback, useEffect, useMemo, useState } from 'react';
import { ApiClient, ApiError } from '../api/client.js';
import { parseTokenHash } from '../api/token.js';
import type { InstanceSummary, KnownProject, ScanResponse } from '../api/types.js';
import { Button, EmptyState } from '../components/core/index.js';
import { useAppState } from '../state/index.js';
import { annotateHits, formatScanStats } from './instances/hits.js';
import { formatKnownMeta, pruneKnownProjects } from './instances/suggestions.js';
import './instances.css';

/**
 * Workspace manager (rail `05 INSTANCES`, DESIGN §4.2 / §5 row 23). Lists the
 * hosted instances, adds a folder, scans recursively for more, and unloads /
 * removes instances. All root paths and scan-hit paths are user/filesystem data
 * and are rendered as TEXT nodes only (never HTML).
 *
 * CLIENT SEAM: mutations and the post-mutation list refresh need an ApiClient,
 * but the shell keeps its own client private and consumes the URL token on its
 * first render. We therefore capture the token at MODULE LOAD (this module is
 * imported by App before the shell renders and strips the fragment) and build a
 * dedicated client. The instance list still seeds from `useAppState().instances`
 * for the first paint; `selectInstance` remains the shell's job.
 */
const bootToken =
  typeof window !== 'undefined' ? parseTokenHash(window.location.hash).token : undefined;

export function Instances() {
  const { instances: shellInstances, currentInstance, selectInstance } = useAppState();
  const client = useMemo(() => (bootToken ? new ApiClient(bootToken) : undefined), []);

  // Local, live copy of the list: seeded from the shell, then owned by this page
  // so mutations reflect immediately (the shell does not re-fetch instances).
  const [rows, setRows] = useState<InstanceSummary[] | null>(null);
  const instances = rows ?? shellInstances;

  const [addPath, setAddPath] = useState('');
  const [addError, setAddError] = useState<string | null>(null);
  const [scanPath, setScanPath] = useState('');
  const [scanError, setScanError] = useState<string | null>(null);
  const [scan, setScan] = useState<ScanResponse | null>(null);
  const [confirmRemove, setConfirmRemove] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  // Known-project suggestions (roots seen in ~/.claude the user can one-click add).
  const [known, setKnown] = useState<KnownProject[] | null>(null);
  const [knownError, setKnownError] = useState<string | null>(null);

  const refreshList = useCallback(async () => {
    if (!client) return;
    try {
      setRows(await client.getInstances());
    } catch {
      // A refresh failure leaves the last-known list in place; the shell surfaces
      // fatal (network/unauthorized) states in the chrome.
    }
  }, [client]);

  const refreshKnown = useCallback(async () => {
    if (!client) return;
    try {
      setKnown((await client.getKnownProjects()).projects);
      setKnownError(null);
    } catch (err) {
      setKnown([]);
      setKnownError(err instanceof ApiError ? err.message : 'request failed');
    }
  }, [client]);

  useEffect(() => {
    void refreshList();
    void refreshKnown();
  }, [refreshList, refreshKnown]);

  const messageFor = (err: unknown): string =>
    err instanceof ApiError ? err.message : 'request failed';

  const onAdd = useCallback(async () => {
    const path = addPath.trim();
    if (!path || !client || busy) return;
    setBusy(true);
    setAddError(null);
    try {
      await client.addInstance(path);
      setAddPath('');
      await refreshList();
    } catch (err) {
      setAddError(messageFor(err));
    } finally {
      setBusy(false);
    }
  }, [addPath, client, busy, refreshList]);

  const onScan = useCallback(async () => {
    const path = scanPath.trim();
    if (!path || !client || busy) return;
    setBusy(true);
    setScanError(null);
    try {
      setScan(await client.scanFolder(path));
    } catch (err) {
      setScan(null);
      setScanError(messageFor(err));
    } finally {
      setBusy(false);
    }
  }, [scanPath, client, busy]);

  const onAddHit = useCallback(
    async (root: string) => {
      if (!client || busy) return;
      setBusy(true);
      setScanError(null);
      try {
        await client.addInstance(root);
        await refreshList();
      } catch (err) {
        setScanError(messageFor(err));
      } finally {
        setBusy(false);
      }
    },
    [client, busy, refreshList],
  );

  const onAddKnown = useCallback(
    async (root: string) => {
      if (!client || busy) return;
      setBusy(true);
      setKnownError(null);
      try {
        await client.addInstance(root);
        await refreshList();
        await refreshKnown();
      } catch (err) {
        setKnownError(messageFor(err));
      } finally {
        setBusy(false);
      }
    },
    [client, busy, refreshList, refreshKnown],
  );

  const onUnload = useCallback(
    async (id: string) => {
      if (!client || busy) return;
      setBusy(true);
      try {
        await client.unloadInstance(id);
        await refreshList();
      } catch {
        // non-fatal; leave the row as-is.
      } finally {
        setBusy(false);
      }
    },
    [client, busy, refreshList],
  );

  const onRemove = useCallback(
    async (id: string) => {
      if (!client || busy) return;
      setBusy(true);
      try {
        await client.removeInstance(id);
        setConfirmRemove(null);
        // If we dropped the instance we were viewing, move to the default.
        if (currentInstance?.id === id) {
          const next =
            instances.find((i) => i.id !== id && i.isDefault) ?? instances.find((i) => i.id !== id);
          if (next) selectInstance(next.id);
        }
        await refreshList();
      } catch {
        // non-fatal; leave the row in place.
      } finally {
        setBusy(false);
      }
    },
    [client, busy, refreshList, currentInstance, instances, selectInstance],
  );

  const annotated = scan
    ? annotateHits(
        scan.hits,
        instances.map((i) => i.root),
      )
    : [];
  const onlyDefault = instances.length <= 1 && instances.every((i) => i.isDefault);
  const suggestions = known
    ? pruneKnownProjects(
        known,
        instances.map((i) => i.root),
      )
    : [];

  return (
    <main className="layout-main page">
      <section className="page__section">
        <h1 className="micro-label">05 INSTANCES · WORKSPACE</h1>
        <p className="mono-data instances__count">
          {instances.length} INSTANCE{instances.length === 1 ? '' : 'S'} ·{' '}
          {instances.filter((i) => i.loaded).length} LOADED
        </p>
      </section>

      <hr className="rule-h" />

      <section className="page__section">
        {instances.length === 0 ? (
          <EmptyState instruction="add or scan a folder to begin watching" />
        ) : (
          <table className="table-hairline mono-data instances__table">
            <thead>
              <tr>
                <th scope="col" className="micro-label">
                  STATE
                </th>
                <th scope="col" className="micro-label">
                  NAME
                </th>
                <th scope="col" className="micro-label">
                  ROOT
                </th>
                <th scope="col" className="micro-label">
                  MARKERS
                </th>
                <th scope="col" className="micro-label instances__actions-head">
                  ACTIONS
                </th>
              </tr>
            </thead>
            <tbody>
              {instances.map((inst) => {
                const isCurrent = currentInstance?.id === inst.id;
                return (
                  <tr key={inst.id} className={isCurrent ? 'instances__row--current' : undefined}>
                    <td>
                      <span
                        className={inst.loaded ? 'instances__dot--on' : 'instances__dot--off'}
                        aria-hidden="true"
                      >
                        {inst.loaded ? '●' : '○'}
                      </span>{' '}
                      {inst.loaded ? 'LOADED' : 'LAZY'}
                    </td>
                    <td>
                      {inst.name}
                      {inst.isDefault && <span className="instances__tag"> DEFAULT</span>}
                      {isCurrent && (
                        <span className="instances__tag instances__tag--current"> CURRENT</span>
                      )}
                    </td>
                    <td className="instances__root">{inst.root}</td>
                    <td className="instances__markers">
                      {inst.markers.length > 0 ? inst.markers.join(' ') : '—'}
                    </td>
                    <td className="instances__actions">
                      {!isCurrent && (
                        <Button
                          label="select"
                          onClick={() => selectInstance(inst.id)}
                          disabled={busy}
                        />
                      )}
                      {inst.loaded && (
                        <Button
                          label="unload"
                          onClick={() => void onUnload(inst.id)}
                          disabled={busy}
                        />
                      )}
                      {confirmRemove === inst.id ? (
                        <>
                          <Button
                            label="confirm"
                            variant="destructive"
                            onClick={() => void onRemove(inst.id)}
                            disabled={busy}
                          />
                          <Button
                            label="cancel"
                            onClick={() => setConfirmRemove(null)}
                            disabled={busy}
                          />
                        </>
                      ) : (
                        <Button
                          label="remove"
                          variant="destructive"
                          onClick={() => setConfirmRemove(inst.id)}
                          disabled={busy}
                        />
                      )}
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        )}
        {onlyDefault && (
          <p className="micro-label instances__hint">
            no watched folders yet — add or scan one below
          </p>
        )}
      </section>

      <hr className="rule-h" />

      <section className="page__section">
        <h2 className="micro-label">ADD FOLDER</h2>
        <div className="instances__form">
          <input
            className="instances__input mono-data"
            type="text"
            placeholder="/absolute/path/to/project"
            value={addPath}
            spellCheck={false}
            onChange={(e) => setAddPath(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === 'Enter') void onAdd();
            }}
          />
          <Button
            label="add"
            variant="primary"
            onClick={() => void onAdd()}
            disabled={busy || !addPath.trim()}
          />
        </div>
        {addError && <p className="instances__error mono-data">{addError}</p>}
      </section>

      {(suggestions.length > 0 || knownError) && (
        <>
          <hr className="rule-h" />
          <section className="page__section">
            <h2 className="micro-label">SUGGESTED PROJECTS</h2>
            <p className="micro-label instances__hint">
              seen in your recent sessions · one click to watch
            </p>
            {knownError ? (
              <p className="instances__error mono-data">{knownError}</p>
            ) : (
              <ul className="instances__hits">
                {suggestions.map((sug) => (
                  <li key={sug.root} className="instances__hit">
                    <div className="instances__hit-body">
                      <span className="instances__root mono-data">{sug.root}</span>
                      <span className="micro-label instances__hit-meta">
                        {formatKnownMeta(sug)}
                      </span>
                    </div>
                    <Button
                      label="add"
                      variant="primary"
                      onClick={() => void onAddKnown(sug.root)}
                      disabled={busy}
                    />
                  </li>
                ))}
              </ul>
            )}
          </section>
        </>
      )}

      <hr className="rule-h" />

      <section className="page__section">
        <h2 className="micro-label">SCAN RECURSIVELY</h2>
        <div className="instances__form">
          <input
            className="instances__input mono-data"
            type="text"
            placeholder="/absolute/path/to/scan"
            value={scanPath}
            spellCheck={false}
            onChange={(e) => setScanPath(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === 'Enter') void onScan();
            }}
          />
          <Button label="scan" onClick={() => void onScan()} disabled={busy || !scanPath.trim()} />
        </div>
        {scanError && <p className="instances__error mono-data">{scanError}</p>}
        {scan && (
          <div className="instances__scan">
            <p className="micro-label instances__hint">
              {annotated.length} HIT{annotated.length === 1 ? '' : 'S'} ·{' '}
              {formatScanStats(scan.stats)}
            </p>
            {annotated.length === 0 ? (
              <EmptyState instruction="no agent-config markers found under that path" />
            ) : (
              <ul className="instances__hits">
                {annotated.map((hit) => (
                  <li key={hit.root} className="instances__hit">
                    <div className="instances__hit-body">
                      <span className="instances__root">{hit.root}</span>
                      <span className="micro-label instances__hit-meta">
                        {hit.runtimes.length > 0 ? hit.runtimes.join(' · ') : 'NO RUNTIME'}
                        {' · '}
                        {hit.markers.join(' ')}
                      </span>
                    </div>
                    <Button
                      label={hit.added ? 'added' : 'add'}
                      variant={hit.added ? 'default' : 'primary'}
                      onClick={() => void onAddHit(hit.root)}
                      disabled={busy || hit.added}
                    />
                  </li>
                ))}
              </ul>
            )}
          </div>
        )}
      </section>
    </main>
  );
}
