/**
 * Shared single-file editor state machine (extracted from the common core of
 * Instructions / Rules / Skills / Memory). It owns ONE selected file's load
 * lifecycle and the redaction/read-only/dirty derivation the editors repeat.
 *
 * DELIBERATELY SMALL — the pages diverge past this core, and those parts stay
 * with the caller:
 *   - Template / "new file" mode (Rules, Skills): pass `path: undefined` and own
 *     the draft yourself via `setDraft` — while `path` is undefined the hook
 *     RELEASES the file but does NOT touch the draft, so it never clobbers a
 *     template draft. `dirty` is only meaningful for a loaded file; a template's
 *     save-enable (path present, name non-empty, …) stays in the caller's
 *     `canSave`.
 *   - Bulk load (Memory browses ALL files into a Map): this hook does not model
 *     that; Memory keeps its own loader and uses `isRedactedFile` directly.
 *   - `savePath` composition, mode/tab UI state, and the commit toast (see
 *     `useCommitToast`) remain the caller's.
 *
 * `readOnly` here SUBSUMES `lib/editable.ts#fileReadOnly` (which ignores its
 * `inherited` arg — a no-op): only redaction forces read-only, matching current
 * behavior, so the migration wave can retire that helper. `inherited` is accepted
 * for call-site symmetry and to document the decision point; it does not
 * currently change the result.
 */

import { useCallback, useEffect, useState } from 'react';
import type { FileContent } from '../api/index.js';
import { errorText } from './errors.js';
import { isRedactedFile } from './redacted.js';

export type FileEditorStatus = 'idle' | 'loading' | 'error';

export interface FileEditorOptions {
  /** The file to edit, or `undefined` (nothing selected / template mode). */
  path: string | undefined;
  /** The report's file loader (from `useAppState`). */
  getFile: (path: string) => Promise<FileContent>;
  /** Provenance for the decision point; does not currently affect `readOnly`. */
  inherited?: boolean;
}

export interface FileEditorState {
  /** The loaded (redacted) file, or undefined while unselected/loading/errored. */
  file: FileContent | undefined;
  /** The editable draft. Initialized to the loaded content; caller-owned while
   *  `path` is undefined (template mode). */
  draft: string;
  setDraft: (value: string) => void;
  status: FileEditorStatus;
  /** Honest one-line load-error voice (only meaningful when status === 'error'). */
  errMsg: string;
  /** Server `spans` OR a `[REDACTED:*]` mark in the served text. */
  redacted: boolean;
  /** Whether the editor must be read-only (currently: redacted). */
  readOnly: boolean;
  /** Draft differs from the loaded baseline (false while read-only or unloaded). */
  dirty: boolean;
  /** Silently re-fetch the current path and reset the draft to disk — call after
   *  a commit so the save button is honestly disabled post-write. No-op while
   *  `path` is undefined; a load failure here is non-fatal (ignored). */
  reload: () => void;
}

/** Encapsulate the load-on-select / reload-after-commit / read-only derivation
 *  the whole-file editors share. */
export function useFileEditor(opts: FileEditorOptions): FileEditorState {
  const { path, getFile } = opts;
  const [file, setFile] = useState<FileContent | undefined>(undefined);
  const [draft, setDraft] = useState('');
  const [status, setStatus] = useState<FileEditorStatus>('idle');
  const [errMsg, setErrMsg] = useState('');

  // Load on selection change (cancel-safe). When nothing is selected the file is
  // released but the draft is LEFT ALONE (template/create callers own it then).
  useEffect(() => {
    if (path === undefined) {
      setFile(undefined);
      setStatus('idle');
      return;
    }
    let cancelled = false;
    setStatus('loading');
    setFile(undefined);
    getFile(path)
      .then((loaded) => {
        if (cancelled) return;
        setFile(loaded);
        setDraft(loaded.content);
        setStatus('idle');
      })
      .catch((err: unknown) => {
        if (cancelled) return;
        setErrMsg(errorText(err));
        setStatus('error');
      });
    return () => {
      cancelled = true;
    };
  }, [path, getFile]);

  const reload = useCallback(() => {
    if (path === undefined) return;
    getFile(path)
      .then((loaded) => {
        setFile(loaded);
        setDraft(loaded.content);
      })
      .catch(() => {
        /* non-fatal: the commit toast already confirmed the write. */
      });
  }, [path, getFile]);

  const redacted = file ? isRedactedFile(file) : false;
  const readOnly = redacted;
  const dirty = file !== undefined && !readOnly && draft !== file.content;

  return { file, draft, setDraft, status, errMsg, redacted, readOnly, dirty, reload };
}
