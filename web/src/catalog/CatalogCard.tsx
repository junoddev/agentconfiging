/**
 * CatalogCard (DESIGN §6) — one registry entry on the CATALOG page (bead
 * agentconfig-0zm.4): name, kind badge, description, source@version, file count,
 * and the INSTALL / REMOVE affordance. Registry text (name/description/source/
 * paths) is UNTRUSTED — every field renders as a text node, never markup.
 *
 * INSTALL drives {@link useCatalogFlow}: a dry-run first shows the mandatory
 * per-file diff (the provenance-stamped content the user approves) via DiffPanel,
 * then COMMIT installs through the guarded server endpoint and refetches. An
 * installed entry shows REMOVE → a dry-run listing the recorded files that would
 * be trashed (recoverable) → CONFIRM.
 */

import { Button, DiffPanel } from '../components/core/index.js';
import type { ApiClient, CatalogEntryMeta, InstalledRecord } from '../api/index.js';
import { useCatalogFlow } from './useCatalogFlow.js';

export interface CatalogCardProps {
  entry: CatalogEntryMeta;
  /** The installed record for this entry, when agentconfig installed it. */
  installed?: InstalledRecord;
  client: ApiClient;
  instance?: string;
  /** Refetch the catalog after a successful install/remove. */
  onChanged: () => void;
}

export function CatalogCard({ entry, installed, client, instance, onChanged }: CatalogCardProps) {
  const flow = useCatalogFlow({ client, entryKey: entry.key, instance, onCommitted: onChanged });
  const isInstalled = installed !== undefined;
  const fileCount = entry.files.length;

  return (
    <li className="catalog-card surface">
      <div className="catalog-card__head">
        <span className="catalog-card__badge micro-label">{entry.kind}</span>
        <span className="catalog-card__name mono-data">{entry.name}</span>
        {isInstalled && <span className="catalog-card__installed micro-label">INSTALLED</span>}
      </div>

      <p className="catalog-card__desc">{entry.description}</p>

      <div className="catalog-card__meta micro-label">
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
            <Button label="remove" variant="destructive" onClick={() => flow.begin('remove')} />
          ) : (
            <Button label="install" variant="primary" onClick={() => flow.begin('install')} />
          ))}

        {flow.phase === 'loading' && <span className="micro-label">building preview…</span>}
        {flow.phase === 'committing' && (
          <span className="micro-label">
            {flow.action === 'remove' ? 'removing…' : 'installing…'}
          </span>
        )}

        {flow.phase === 'ready' && (
          <>
            <Button
              label={flow.action === 'remove' ? 'confirm remove' : 'commit'}
              variant={flow.action === 'remove' ? 'destructive' : 'primary'}
              onClick={flow.commit}
            />
            <Button label="discard" onClick={flow.cancel} />
          </>
        )}

        {(flow.phase === 'done' || flow.phase === 'error') && (
          <>
            <span
              className={`micro-label ${
                flow.phase === 'error' ? 'catalog-card__msg--error' : 'catalog-card__msg--ok'
              }`}
              role="status"
            >
              {flow.message}
            </span>
            <Button label="close" onClick={flow.cancel} />
          </>
        )}
      </div>

      {flow.phase === 'ready' && flow.action === 'install' && (
        <div className="catalog-card__preview">
          {flow.provenanceNote !== undefined && (
            <p className="catalog-card__prov micro-label">+ {flow.provenanceNote}</p>
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
