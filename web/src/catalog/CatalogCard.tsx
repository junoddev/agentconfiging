/**
 * CatalogCard (Console §5 `.card`) — one registry entry on the CATALOG page
 * (bead agentconfig-0zm.4): name, kind chip, description, source@version, file
 * count, and the INSTALL / REMOVE affordance. An installed entry shows an
 * `installed` pill and its PROJECT scope badge (provenance rule: a row that
 * wrote files names its scope). Registry text (name/description/source/paths)
 * is UNTRUSTED — every field renders as a text node, never markup.
 *
 * INSTALL drives {@link useCatalogFlow}: a dry-run first shows the mandatory
 * per-file diff (the provenance-stamped content the user approves) via DiffPanel,
 * then COMMIT installs through the guarded server endpoint and refetches. An
 * installed entry shows REMOVE → a dry-run listing the recorded files that would
 * be trashed (recoverable) → CONFIRM. When the host passes `onToast`, a
 * successful commit confirms via Toast and the card resets to idle; without it
 * the confirmation stays inline (hosts without a ToastProvider).
 */

import { useEffect } from 'react';
import { Button, DiffPanel, Pill, SourceBadge } from '../components/core/index.js';
import type { ApiClient, CatalogEntryMeta, InstalledRecord } from '../api/index.js';
import { useCatalogFlow } from './useCatalogFlow.js';

export interface CatalogCardProps {
  entry: CatalogEntryMeta;
  /** The installed record for this entry, when agentconfig.ing installed it. */
  installed?: InstalledRecord;
  client: ApiClient;
  instance?: string;
  /** Refetch the catalog after a successful install/remove. */
  onChanged: () => void;
  /** Toast a successful commit (Console: every mutating action confirms). */
  onToast?: (message: string) => void;
}

export function CatalogCard({
  entry,
  installed,
  client,
  instance,
  onChanged,
  onToast,
}: CatalogCardProps) {
  const flow = useCatalogFlow({ client, entryKey: entry.key, instance, onCommitted: onChanged });
  const isInstalled = installed !== undefined;
  const fileCount = entry.files.length;

  // A committed action confirms via Toast and resets the card; the inline
  // confirmation only remains for hosts that pass no toast.
  const { phase, message, cancel } = flow;
  useEffect(() => {
    if (phase === 'done' && onToast !== undefined && message !== undefined) {
      onToast(message);
      cancel();
    }
  }, [phase, message, onToast, cancel]);

  return (
    <li className="card catalog-card">
      <div className="catalog-card__head">
        <span className="code">{entry.kind}</span>
        <span className="catalog-card__name mono">{entry.name}</span>
        {isInstalled && (
          <span className="catalog-card__state">
            <Pill tone="ok">installed</Pill>
            <SourceBadge scope="project" />
          </span>
        )}
      </div>

      <p className="catalog-card__desc">{entry.description}</p>

      <div className="catalog-card__meta meta">
        <span>
          {entry.source}@{installed ? installed.version : entry.version}
        </span>
        <span>
          {fileCount} file{fileCount === 1 ? '' : 's'}
        </span>
        {entry.tags.length > 0 && <span>{entry.tags.join(' · ')}</span>}
      </div>

      <div className="catalog-card__actions">
        {flow.phase === 'idle' &&
          (isInstalled ? (
            <Button label="Remove" variant="destructive" onClick={() => flow.begin('remove')} />
          ) : (
            <Button label="Install" variant="primary" onClick={() => flow.begin('install')} />
          ))}

        {flow.phase === 'loading' && <span className="meta">Building preview…</span>}
        {flow.phase === 'committing' && (
          <span className="meta">{flow.action === 'remove' ? 'Removing…' : 'Installing…'}</span>
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
