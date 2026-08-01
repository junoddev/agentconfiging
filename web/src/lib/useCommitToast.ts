/**
 * Shared "toast on commit done" effect (extracted from the ~7 editor pages that
 * each wired the same `flow.phase === 'done'` → toast → reset). When the write
 * flow reaches `done`, it toasts a confirmation, runs an optional side-effect
 * (e.g. close the editor), and by default cancels the flow to reset it.
 *
 * The pages diverge only in the message and the side-effect, both parameterized
 * here; the trigger and reset are the common core.
 */

import { useEffect } from 'react';
import type { WriteFlowController } from '../write/index.js';

export interface CommitToastOptions {
  /** Build the toast text from the committed request's `label`. Default:
   *  `label ? \`Applied — ${label}\` : 'Change applied'`. */
  message?: (label: string | undefined) => string;
  /** Extra side-effect on done, after the toast (e.g. close the dialog / clear
   *  the selection). Runs before the flow is cancelled. */
  onDone?: () => void;
  /** Reset the flow (`flow.cancel()`) after toasting. Default true; pass false
   *  for a page that leaves the WriteFlow panel showing its own done state. */
  cancelOnDone?: boolean;
}

const defaultMessage = (label: string | undefined): string =>
  label !== undefined ? `Applied — ${label}` : 'Change applied';

/**
 * Fire a confirmation toast (and reset the flow) whenever `flow.phase` becomes
 * `'done'`. `flow.phase` is the sole trigger — matching the pages' existing
 * effect, whose `toast` / `flow.cancel` are stable.
 */
export function useCommitToast(
  flow: WriteFlowController,
  toast: (message: string) => void,
  opts: CommitToastOptions = {},
): void {
  const { message = defaultMessage, onDone, cancelOnDone = true } = opts;
  useEffect(() => {
    if (flow.phase !== 'done') return;
    toast(message(flow.request?.label));
    onDone?.();
    if (cancelOnDone) flow.cancel();
    // flow.phase is the trigger; toast / message / onDone / flow are stable.
  }, [flow.phase]);
}
