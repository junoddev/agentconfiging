/**
 * RuntimeScaffold (bead agentconfig-0zm.6, SPEC §4.5/§5) — the guided RUNTIME
 * SETUP surface on the CATALOG page. It turns the abstract `runtime-template`
 * catalog entries into a focused picker: pick a runtime (Cursor / Codex /
 * Gemini …), SEE the starter files it would scaffold and whether it is already
 * set up, then SCAFFOLD it. Console treatment: `.card` rows with status pills
 * (`scaffolded` / `detected`) and a PROJECT scope badge on scaffolded rows.
 *
 * Scaffolding IS installing a runtime-template entry — this component reuses the
 * committed guarded install path ({@link useCatalogFlow}: dry-run → mandatory
 * per-file diff → commit) verbatim; it never introduces a second write. Runtimes
 * without a seed template are shown honestly as "template coming soon" (no
 * fabricated template). Registry text (names/descriptions/paths) is UNTRUSTED and
 * rendered only as text nodes / by DiffPanel.
 */

import { useEffect } from 'react';
import { Button, DiffPanel, Pill, SourceBadge } from '../components/core/index.js';
import type { ApiClient, CatalogEntryMeta, InstalledRecord } from '../api/index.js';
import { useCatalogFlow } from './useCatalogFlow.js';
import { buildRuntimeSetups, partitionRuntimeSetups, type RuntimeSetup } from './runtimeSetup.js';

export interface RuntimeScaffoldProps {
  /** The full catalog entries (runtime-template rows are picked out here). */
  entries: CatalogEntryMeta[];
  /** Installed records indexed by entry key (drives the SCAFFOLDED state). */
  installed: Map<string, InstalledRecord>;
  /** Detector kinds present in the project report (drives the DETECTED state). */
  detected: Set<string>;
  client: ApiClient;
  instance?: string;
  /** Refetch the catalog after a successful scaffold / remove. */
  onChanged: () => void;
  /** Toast a successful commit (Console: every mutating action confirms). */
  onToast?: (message: string) => void;
}

export function RuntimeScaffold({
  entries,
  installed,
  detected,
  client,
  instance,
  onChanged,
  onToast,
}: RuntimeScaffoldProps) {
  const setups = buildRuntimeSetups(entries, installed, detected);
  const { available, comingSoon } = partitionRuntimeSetups(setups);

  return (
    <section className="page__section catalog__shelf" aria-label="runtime setup">
      <div className="catalog__shelf-head">
        <h2 className="title-section">Runtime setup</h2>
        <span className="meta">{available.length}</span>
      </div>
      <p className="catalog__shelf-note meta">
        Scaffold a runtime&apos;s starter config from a template — preview the files, then commit
        through the guarded write path.
      </p>

      {available.length > 0 && (
        <ul className="catalog__list">
          {available.map((setup) => (
            <RuntimeSetupCard
              key={setup.id}
              setup={setup}
              client={client}
              instance={instance}
              onChanged={onChanged}
              onToast={onToast}
            />
          ))}
        </ul>
      )}

      {comingSoon.length > 0 && (
        <div className="runtime-soon">
          <span className="table-header">template coming soon</span>
          <ul className="runtime-soon__list">
            {comingSoon.map((setup) => (
              <li key={setup.id} className="runtime-soon__item">
                <span className="mono-data">{setup.displayName}</span>
                {setup.detected && <Pill tone="off">detected</Pill>}
              </li>
            ))}
          </ul>
        </div>
      )}
    </section>
  );
}

interface RuntimeSetupCardProps {
  setup: RuntimeSetup;
  client: ApiClient;
  instance?: string;
  onChanged: () => void;
  onToast?: (message: string) => void;
}

/**
 * One installable runtime setup. `setup.entry` is guaranteed present (the parent
 * only renders AVAILABLE setups here). Reuses {@link useCatalogFlow} exactly as
 * {@link CatalogCard} does — dry-run preview then commit — so no second write
 * path is introduced.
 */
function RuntimeSetupCard({ setup, client, instance, onChanged, onToast }: RuntimeSetupCardProps) {
  // Non-null: parent renders this only for AVAILABLE setups (entry present).
  const entry = setup.entry as CatalogEntryMeta;
  const flow = useCatalogFlow({ client, entryKey: entry.key, instance, onCommitted: onChanged });
  const { scaffolded, detected } = setup;

  // A committed action confirms via Toast and resets the card (see CatalogCard).
  const { phase, message, cancel } = flow;
  useEffect(() => {
    if (phase === 'done' && onToast !== undefined && message !== undefined) {
      onToast(message);
      cancel();
    }
  }, [phase, message, onToast, cancel]);

  return (
    <li className="card catalog-card runtime-card">
      <div className="catalog-card__head">
        <span className="code">runtime</span>
        <span className="catalog-card__name mono">{setup.displayName}</span>
        <span className="catalog-card__state">
          {scaffolded ? (
            <>
              <Pill tone="ok">scaffolded</Pill>
              <SourceBadge scope="project" />
            </>
          ) : (
            detected && <Pill tone="off">detected</Pill>
          )}
        </span>
      </div>

      <p className="catalog-card__desc">{entry.description}</p>

      <div className="runtime-card__scaffolds">
        <span className="meta">
          scaffolds {entry.files.length} file{entry.files.length === 1 ? '' : 's'}
        </span>
        <ul className="runtime-card__files">
          {entry.files.map((path) => (
            <li key={path} className="mono-data">
              {path}
            </li>
          ))}
        </ul>
      </div>

      <div className="catalog-card__meta meta">
        <span>
          {entry.source}@{setup.installedRecord ? setup.installedRecord.version : entry.version}
        </span>
        {detected && scaffolded && <span>present in project</span>}
      </div>

      <div className="catalog-card__actions">
        {flow.phase === 'idle' &&
          (scaffolded ? (
            <Button label="Remove" variant="destructive" onClick={() => flow.begin('remove')} />
          ) : (
            <Button label="Scaffold" variant="primary" onClick={() => flow.begin('install')} />
          ))}

        {flow.phase === 'loading' && <span className="meta">Building preview…</span>}
        {flow.phase === 'committing' && (
          <span className="meta">{flow.action === 'remove' ? 'Removing…' : 'Scaffolding…'}</span>
        )}

        {flow.phase === 'ready' && (
          <>
            <Button
              label={flow.action === 'remove' ? 'Confirm remove' : 'Commit'}
              variant={flow.action === 'remove' ? 'destructive' : 'primary'}
              onClick={flow.commit}
            />
            <Button label="Discard" onClick={flow.cancel} />
          </>
        )}

        {(flow.phase === 'done' || flow.phase === 'error') && (
          <>
            <span
              className={`meta ${
                flow.phase === 'error' ? 'catalog-card__msg--error' : 'catalog-card__msg--ok'
              }`}
              role="status"
            >
              {flow.message}
            </span>
            <Button label="Close" onClick={flow.cancel} />
          </>
        )}
      </div>

      {flow.phase === 'ready' && flow.action === 'install' && (
        <div className="catalog-card__preview">
          {flow.provenanceNote !== undefined && (
            <p className="catalog-card__prov meta">+ {flow.provenanceNote}</p>
          )}
          {flow.installFiles.map((file, i) => (
            <DiffPanel
              key={file.path + String(i)}
              label={file.path + (file.willCreate ? ' · new' : '')}
              hunks={file.hunks}
            />
          ))}
        </div>
      )}

      {flow.phase === 'ready' && flow.action === 'remove' && (
        <ul className="catalog-card__trash">
          {flow.removeFiles.map((file) => (
            <li key={file.path} className="mono-data">
              {file.missing ? '· (already gone) ' : '· trash '}
              {file.path}
            </li>
          ))}
        </ul>
      )}
    </li>
  );
}
