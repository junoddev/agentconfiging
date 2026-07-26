/**
 * QuickAdd (bead agentconfig-0zm.3, SPEC §5 row 9) — the reusable quick-add
 * PRIMITIVE: a bracket button that opens a catalog picker scoped to ONE kind and
 * lists the not-yet-installed entries of that kind, each installable through the
 * same guarded dry-run → diff → COMMIT flow as the full Catalog page (it renders
 * {@link CatalogCard}s, so the discipline is inherited, never re-implemented).
 *
 * It is exported so each editor page (skills/hooks/rules/mcp/…) can drop in a
 * kind-scoped `[+ ADD <kind>]` without duplicating the install flow. Two modes:
 *   • HOSTED — the caller (Catalog page) already fetched the catalog and passes
 *     `entries` + `installed`; no extra request.
 *   • STANDALONE — a caller passes only `client`/`instance`; QuickAdd fetches the
 *     catalog itself the first time it opens and re-fetches after a commit.
 *
 * Registry text is untrusted — CatalogCard renders every field as a text node.
 */

import { useCallback, useEffect, useMemo, useState } from 'react';
import type {
  ApiClient,
  CatalogEntryMeta,
  CatalogResponse,
  InstalledRecord,
} from '../api/index.js';
import { Button, EmptyState } from '../components/core/index.js';
import { CatalogCard } from './CatalogCard.js';
import { installedByKey, quickAddCandidates } from './logic.js';

export interface QuickAddProps {
  /** The single catalog kind this picker offers (e.g. 'skill', 'mcp-server'). */
  kind: string;
  client: ApiClient;
  instance?: string;
  /** Called after a successful install so the host can refetch its own view. */
  onChanged: () => void;
  /** HOSTED mode: the already-fetched catalog entries. Omit to self-fetch. */
  entries?: CatalogEntryMeta[];
  /** HOSTED mode: the host's installed-by-key index. Omit to self-fetch. */
  installed?: Map<string, InstalledRecord>;
  /** Optional label override; defaults to `add <kind>`. */
  label?: string;
}

type FetchStatus = 'idle' | 'loading' | 'ok' | 'error';

export function QuickAdd({
  kind,
  client,
  instance,
  onChanged,
  entries,
  installed,
  label,
}: QuickAddProps) {
  const hosted = entries !== undefined;
  const [open, setOpen] = useState(false);
  const [query, setQuery] = useState('');

  // Standalone mode only: the catalog this picker fetches for itself.
  const [fetched, setFetched] = useState<CatalogResponse | undefined>();
  const [status, setStatus] = useState<FetchStatus>('idle');
  const [reloadKey, setReloadKey] = useState(0);

  useEffect(() => {
    if (hosted || !open) return;
    let cancelled = false;
    setStatus('loading');
    void (async () => {
      try {
        const res = await client.getCatalog(instance);
        if (cancelled) return;
        setFetched(res);
        setStatus('ok');
      } catch {
        if (cancelled) return;
        setStatus('error');
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [hosted, open, client, instance, reloadKey]);

  const activeEntries = hosted ? entries : (fetched?.entries ?? []);
  const activeInstalled = useMemo(
    () => installed ?? installedByKey(fetched?.installed ?? []),
    [installed, fetched],
  );

  const candidates = useMemo(
    () => quickAddCandidates(activeEntries, kind, activeInstalled, query),
    [activeEntries, kind, activeInstalled, query],
  );

  // On commit: bubble to the host, and (standalone) re-fetch so the installed
  // entry drops out of the candidate list.
  const onCardChanged = useCallback(() => {
    onChanged();
    if (!hosted) setReloadKey((k) => k + 1);
  }, [onChanged, hosted]);

  const inputId = `quickadd-${kind}`;

  if (!open) {
    return (
      <div className="quickadd">
        <Button label={label ?? `add ${kind}`} onClick={() => setOpen(true)} />
      </div>
    );
  }

  return (
    <div className="quickadd quickadd--open">
      <div className="quickadd__bar">
        <span className="quickadd__title micro-label">add {kind}</span>
        <input
          id={inputId}
          type="search"
          className="quickadd__search mono-data"
          placeholder="filter…"
          aria-label={`filter ${kind} catalog`}
          value={query}
          onChange={(e) => setQuery(e.target.value)}
        />
        <Button label="done" onClick={() => setOpen(false)} />
      </div>

      {!hosted && status === 'loading' && <p className="micro-label">loading catalog…</p>}
      {!hosted && status === 'error' && (
        <EmptyState title="NO SIGNAL" instruction="could not load the catalog" />
      )}

      {(hosted || status === 'ok') &&
        (candidates.length === 0 ? (
          <EmptyState instruction={`no ${kind} left to add`} />
        ) : (
          <>
            <p className="quickadd__count micro-label" role="status">
              {candidates.length} available
            </p>
            <ul className="catalog__list">
              {candidates.map((entry) => (
                <CatalogCard
                  key={entry.key}
                  entry={entry}
                  client={client}
                  instance={instance}
                  onChanged={onCardChanged}
                />
              ))}
            </ul>
          </>
        ))}
    </div>
  );
}
