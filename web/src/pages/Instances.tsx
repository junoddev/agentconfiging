import { useCallback, useEffect, useState } from 'react';
import { ApiError } from '../api/client.js';
import type { KnownProject, ScanResponse } from '../api/types.js';
import {
  Button,
  Card,
  EmptyState,
  Input,
  ListCard,
  ListRow,
  Notice,
  Pill,
  SourceBadge,
  Table,
  useToast,
} from '../components/core/index.js';
import { useAppState } from '../state/index.js';
import { annotateHits, formatScanStats } from './instances/hits.js';
import { formatKnownMeta, pruneKnownProjects } from './instances/suggestions.js';
import './instances.css';

/**
 * Folders — the application-context manager (Console page, E13.5).
 * Lists the hosted instances in a `.table-card`, adds a folder, scans
 * recursively for more (scan states as `.pill`s), and unloads / removes
 * instances. All root paths and scan-hit paths are user/filesystem data and are
 * rendered as TEXT nodes only (never HTML). Every mutation confirms via Toast.
 *
 * CLIENT SEAM: mutations need an ApiClient. Rather than bootstrap a private one,
 * the page reads the shared, token-bearing client off the app-state context (the
 * same injectable seam the provider uses). The list itself also lives in the
 * SHARED app-state so an add/remove here refreshes the top-bar FOLDER chooser:
 * mutations dispatch through the shell's `refreshInstances` rather than a
 * page-local copy (the old private list left the chooser stale after an add).
 * `selectInstance` remains the shell's job.
 */

function InstancesBody() {
  const {
    instances,
    currentInstance,
    selectInstance,
    refreshInstances: refreshList,
    client,
  } = useAppState();
  const toast = useToast();

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
      toast('Folder added');
    } catch (err) {
      setAddError(messageFor(err));
    } finally {
      setBusy(false);
    }
  }, [addPath, client, busy, refreshList, toast]);

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
        toast('Folder added');
      } catch (err) {
        setScanError(messageFor(err));
      } finally {
        setBusy(false);
      }
    },
    [client, busy, refreshList, toast],
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
        toast('Folder added');
      } catch (err) {
        setKnownError(messageFor(err));
      } finally {
        setBusy(false);
      }
    },
    [client, busy, refreshList, refreshKnown, toast],
  );

  const onUnload = useCallback(
    async (id: string) => {
      if (!client || busy) return;
      setBusy(true);
      try {
        await client.unloadInstance(id);
        await refreshList();
        toast('Instance unloaded');
      } catch {
        // non-fatal; leave the row as-is.
      } finally {
        setBusy(false);
      }
    },
    [client, busy, refreshList, toast],
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
        toast('Instance removed');
      } catch {
        // non-fatal; leave the row in place.
      } finally {
        setBusy(false);
      }
    },
    [client, busy, refreshList, currentInstance, instances, selectInstance, toast],
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
      <div className="page-head">
        <div>
          <h1>Folders</h1>
          <p className="page-sub">
            the workspace folders agentconfig.ing watches — add one, scan for more, unload or remove
          </p>
        </div>
        <span className="meta">
          {instances.length} folder{instances.length === 1 ? '' : 's'} ·{' '}
          {instances.filter((i) => i.loaded).length} loaded
        </span>
      </div>

      <section className="page__section">
        {instances.length === 0 ? (
          <EmptyState instruction="No folders yet. Add or scan a folder below to begin watching." />
        ) : (
          <Table headers={['State', 'Name', 'Root', 'Markers', 'Actions']}>
            {instances.map((inst) => {
              const isCurrent = currentInstance?.id === inst.id;
              return (
                <tr key={inst.id} {...(isCurrent ? { 'aria-current': 'true' } : {})}>
                  <td>
                    <Pill tone={inst.loaded ? 'ok' : 'off'}>{inst.loaded ? 'loaded' : 'lazy'}</Pill>
                  </td>
                  <td>
                    <span className="instances__name">
                      {inst.name}
                      {inst.isDefault && <SourceBadge scope="default" />}
                      {isCurrent && <Pill tone="ok">current</Pill>}
                    </span>
                  </td>
                  <td className="mono instances__root">{inst.root}</td>
                  <td className="mono muted">
                    {inst.markers.length > 0 ? inst.markers.join(' ') : '—'}
                  </td>
                  <td>
                    <span className="instances__actions">
                      {!isCurrent && (
                        <Button
                          label="Select"
                          variant="ghost"
                          onClick={() => selectInstance(inst.id)}
                          disabled={busy}
                        />
                      )}
                      {inst.loaded && (
                        <Button
                          label="Unload"
                          variant="ghost"
                          onClick={() => void onUnload(inst.id)}
                          disabled={busy}
                        />
                      )}
                      {confirmRemove === inst.id ? (
                        <>
                          <Button
                            label="Confirm remove"
                            variant="destructive"
                            onClick={() => void onRemove(inst.id)}
                            disabled={busy}
                          />
                          <Button
                            label="Cancel"
                            variant="ghost"
                            onClick={() => setConfirmRemove(null)}
                            disabled={busy}
                          />
                        </>
                      ) : (
                        <Button
                          label="Remove"
                          variant="destructive"
                          onClick={() => setConfirmRemove(inst.id)}
                          disabled={busy}
                        />
                      )}
                    </span>
                  </td>
                </tr>
              );
            })}
          </Table>
        )}
        {onlyDefault && (
          <p className="meta instances__hint">no watched folders yet — add or scan one below</p>
        )}
      </section>

      <section className="page__section">
        <Card title="Add folder">
          <div className="instances__form">
            <Input
              type="text"
              className="mono"
              placeholder="/absolute/path/to/project"
              value={addPath}
              spellCheck={false}
              aria-label="folder to add"
              onChange={(e) => setAddPath(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === 'Enter') void onAdd();
              }}
            />
            <Button
              label="Add"
              variant="primary"
              onClick={() => void onAdd()}
              disabled={busy || !addPath.trim()}
            />
          </div>
          {addError !== null && <p className="instances__error mono-data">{addError}</p>}
        </Card>
      </section>

      {(suggestions.length > 0 || knownError !== null) && (
        <section className="page__section">
          {knownError !== null ? (
            <Notice>could not load suggested projects — {knownError}</Notice>
          ) : (
            <ListCard head="SUGGESTED PROJECTS" headMeta="seen in your recent sessions">
              {suggestions.map((sug) => (
                <ListRow
                  key={sug.root}
                  title={<span className="mono-data instances__root">{sug.root}</span>}
                  sub={formatKnownMeta(sug)}
                  trailing={
                    <Button label="Add" onClick={() => void onAddKnown(sug.root)} disabled={busy} />
                  }
                />
              ))}
            </ListCard>
          )}
        </section>
      )}

      <section className="page__section">
        <Card title="Scan recursively">
          <div className="instances__form">
            <Input
              type="text"
              className="mono"
              placeholder="/absolute/path/to/scan"
              value={scanPath}
              spellCheck={false}
              aria-label="folder to scan"
              onChange={(e) => setScanPath(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === 'Enter') void onScan();
              }}
            />
            <Button
              label="Scan"
              onClick={() => void onScan()}
              disabled={busy || !scanPath.trim()}
            />
          </div>
          {scanError !== null && <p className="instances__error mono-data">{scanError}</p>}
        </Card>

        {scan &&
          (annotated.length === 0 ? (
            <div className="instances__scan">
              <EmptyState instruction="No agent-config markers found under that path." />
            </div>
          ) : (
            <div className="instances__scan">
              <ListCard
                head="SCAN HITS"
                headMeta={`${annotated.length} hit${annotated.length === 1 ? '' : 's'} · ${formatScanStats(scan.stats)}`}
              >
                {annotated.map((hit) => (
                  <ListRow
                    key={hit.root}
                    title={<span className="mono-data instances__root">{hit.root}</span>}
                    badge={
                      <Pill tone={hit.added ? 'off' : 'ok'}>{hit.added ? 'added' : 'new'}</Pill>
                    }
                    sub={`${hit.runtimes.length > 0 ? hit.runtimes.join(' · ') : 'no runtime'} · ${hit.markers.join(' ')}`}
                    trailing={
                      <Button
                        label="Add"
                        onClick={() => void onAddHit(hit.root)}
                        disabled={busy || hit.added}
                      />
                    }
                  />
                ))}
              </ListCard>
            </div>
          ))}
      </section>
    </main>
  );
}

export function Instances() {
  // Toasts confirm through the shell-level ToastProvider (App.tsx).
  return <InstancesBody />;
}
