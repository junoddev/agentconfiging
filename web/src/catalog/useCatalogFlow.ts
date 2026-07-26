/**
 * useCatalogFlow — the per-entry dry-run → COMMIT flow for the CATALOG install /
 * remove surface (bead agentconfig-0zm.4). It mirrors {@link useWriteFlow}: every
 * action DRY-RUNS first (no disk touch) and shows a mandatory preview — per-file
 * unified diffs for INSTALL, the recorded files to trash for REMOVE — before
 * `commit()` writes through the guarded server endpoints. Registry content is
 * untrusted; all diff/path text is parsed and rendered by DiffPanel / plain text
 * nodes only, never markup.
 *
 * `phase` drives the UI: idle → loading → ready → committing → done, or → error.
 * The hook is single-flight: a new `begin`/`cancel` supersedes an in-flight run
 * and stale async results are dropped, so a card can never commit a superseded
 * preview or setState after unmount. A failed flow never throws out of the hook.
 */

import { useCallback, useRef, useState } from 'react';
import { ApiError, type ApiClient, type CatalogRemoveFile } from '../api/index.js';
import type { DiffHunk } from '../components/core/index.js';
import { parseDiff } from '../write/index.js';

export type CatalogAction = 'install' | 'remove';
export type CatalogFlowPhase = 'idle' | 'loading' | 'ready' | 'committing' | 'done' | 'error';

/** One install file's preview: parsed diff of the provenance-stamped content. */
export interface InstallFilePreview {
  path: string;
  willCreate: boolean;
  hunks: DiffHunk[];
}

export interface CatalogFlowController {
  phase: CatalogFlowPhase;
  action?: CatalogAction;
  /** INSTALL preview rows (present once ready on an install). */
  installFiles: InstallFilePreview[];
  /** REMOVE preview rows (present once ready on a remove). */
  removeFiles: CatalogRemoveFile[];
  /** The provenance label the install would record (dry-run only). */
  provenanceNote?: string;
  /** Terse in-panel status (error reason or success confirmation). */
  message?: string;
  begin: (action: CatalogAction) => void;
  commit: () => void;
  cancel: () => void;
}

function reason(err: unknown, context: 'preview' | 'commit'): string {
  if (err instanceof ApiError) {
    switch (err.kind) {
      case 'forbidden':
        return 'refused · a file path falls outside the writable scope';
      case 'notfound':
        return 'this entry is no longer available';
      case 'unauthorized':
        return 'session expired · relaunch to continue';
      case 'network':
        return 'cannot reach the local server';
      default:
        // 422 (unverified content) and other coarse statuses land here.
        return context === 'commit' ? 'install failed' : 'refused · content failed verification';
    }
  }
  return context === 'commit' ? 'install failed' : 'could not build preview';
}

export interface CatalogFlowOptions {
  client: ApiClient;
  entryKey: string;
  instance?: string;
  /** Called after a successful commit so the page can refetch the catalog. */
  onCommitted: () => void;
}

export function useCatalogFlow(opts: CatalogFlowOptions): CatalogFlowController {
  const { client, entryKey, instance, onCommitted } = opts;

  const [phase, setPhase] = useState<CatalogFlowPhase>('idle');
  const [action, setAction] = useState<CatalogAction | undefined>();
  const [installFiles, setInstallFiles] = useState<InstallFilePreview[]>([]);
  const [removeFiles, setRemoveFiles] = useState<CatalogRemoveFile[]>([]);
  const [provenanceNote, setProvenanceNote] = useState<string | undefined>();
  const [message, setMessage] = useState<string | undefined>();

  const runId = useRef(0);

  const begin = useCallback(
    (next: CatalogAction) => {
      const run = ++runId.current;
      setAction(next);
      setInstallFiles([]);
      setRemoveFiles([]);
      setProvenanceNote(undefined);
      setMessage(undefined);
      setPhase('loading');

      void (async () => {
        try {
          if (next === 'install') {
            const res = await client.installEntry(entryKey, { dryRun: true, instance });
            if (run !== runId.current) return;
            setInstallFiles(
              res.files.map((f) => ({
                path: f.path,
                willCreate: f.willCreate,
                hunks: parseDiff(f.diff),
              })),
            );
            setProvenanceNote(res.provenance?.note);
          } else {
            const res = await client.removeEntry(entryKey, { dryRun: true, instance });
            if (run !== runId.current) return;
            setRemoveFiles(res.files);
          }
          setPhase('ready');
        } catch (err) {
          if (run !== runId.current) return;
          setMessage(reason(err, 'preview'));
          setPhase('error');
        }
      })();
    },
    [client, entryKey, instance],
  );

  const commit = useCallback(() => {
    const current = action;
    if (!current) return;
    const run = ++runId.current;
    setPhase('committing');
    setMessage(undefined);

    void (async () => {
      try {
        if (current === 'install') {
          await client.installEntry(entryKey, { dryRun: false, instance });
        } else {
          await client.removeEntry(entryKey, { dryRun: false, instance });
        }
        if (run !== runId.current) return;
        setMessage(current === 'install' ? 'installed' : 'removed · files moved to trash');
        setPhase('done');
        onCommitted();
      } catch (err) {
        if (run !== runId.current) return;
        setMessage(reason(err, 'commit'));
        setPhase('error');
      }
    })();
  }, [action, client, entryKey, instance, onCommitted]);

  const cancel = useCallback(() => {
    runId.current += 1;
    setPhase('idle');
    setAction(undefined);
    setInstallFiles([]);
    setRemoveFiles([]);
    setProvenanceNote(undefined);
    setMessage(undefined);
  }, []);

  return {
    phase,
    action,
    installFiles,
    removeFiles,
    provenanceNote,
    message,
    begin,
    commit,
    cancel,
  };
}
