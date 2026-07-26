/**
 * useWriteFlow — the reusable dry-run-diff → COMMIT flow (bead agentconfig-wmc.1).
 * This is the E5 foundation every config editor (wmc.2-10) saves through, and
 * what the Findings page drives for one-click APPLY. It owns the state machine;
 * DiffPanel (via {@link WriteFlow}) owns the rendering.
 *
 * CONTRACT (what wmc.2-10 reuse)
 * ------------------------------
 * `begin(request)` starts a flow:
 *   - { kind: 'fix', findingId }        → dry-runs the finding's machine fix
 *                                         (server recomputes + guards the patch;
 *                                         the client never holds it).
 *   - { kind: 'file', path, content }   → dry-runs writing `content` to `path`
 *                                         (the editor save path).
 * It always DRY-RUNS first: no write happens until `commit()`. The resulting
 * `previews` (one per edit, parsed diff hunks) are what DiffPanel shows.
 *
 * `commit()` applies the pending request through the SAME guarded server path,
 * then refetches the report so the finding disappears / the file updates live
 * (the WS push does this too; the explicit refetch makes it deterministic).
 * `cancel()` discards the pending flow.
 *
 * `phase` drives the UI: idle → loading → ready → committing → done, or → error
 * at any step. Errors are terse in-panel `message`s (403 out-of-scope fix, 404
 * gone, network) — a failed flow never throws out of the hook or crashes a page.
 * The hook is single-flight: a new `begin` (or `cancel`) supersedes any in-flight
 * request, and stale async results are dropped.
 */

import { useCallback, useRef, useState } from 'react';
import { ApiError } from '../api/client.js';
import type { DiffHunk } from '../components/core/index.js';
import { useAppState } from '../state/index.js';
import { parseDiff } from './parseDiff.js';

/** What to write: an existing finding's fix, or an editor's proposed file body. */
export type WriteRequest =
  | { kind: 'fix'; findingId: string; label?: string }
  | { kind: 'file'; path: string; content: string; label?: string };

/** One edit's preview: the parsed diff plus whether it creates or modifies. */
export interface WritePreview {
  path: string;
  pathScope?: string;
  willCreate: boolean;
  willModify: boolean;
  hunks: DiffHunk[];
}

export type WriteFlowPhase = 'idle' | 'loading' | 'ready' | 'committing' | 'done' | 'error';

export interface WriteFlowController {
  phase: WriteFlowPhase;
  /** The request currently being previewed/committed (undefined when idle). */
  request?: WriteRequest;
  /** One entry per edit once phase is 'ready'. */
  previews: WritePreview[];
  /** Terse in-panel status: the error reason, or the success confirmation. */
  message?: string;
  begin: (request: WriteRequest) => void;
  commit: () => void;
  cancel: () => void;
}

/** Map any thrown value to a terse, human in-panel message (§7 voice). */
function reason(err: unknown, context: 'preview' | 'commit'): string {
  if (err instanceof ApiError) {
    switch (err.kind) {
      case 'forbidden':
        return 'refused · edit falls outside the writable scope';
      case 'notfound':
        return 'this fix is no longer available';
      case 'conflict':
        return 'refused · the file changed since the scan';
      case 'unauthorized':
        return 'session expired · relaunch to continue';
      case 'network':
        return 'cannot reach the local server';
      case 'badrequest':
        return err.message;
      default:
        return context === 'commit' ? 'write failed' : 'could not build preview';
    }
  }
  return context === 'commit' ? 'write failed' : 'could not build preview';
}

export function useWriteFlow(): WriteFlowController {
  const { applyFix, writeFile, refetch } = useAppState();

  const [phase, setPhase] = useState<WriteFlowPhase>('idle');
  const [request, setRequest] = useState<WriteRequest | undefined>();
  const [previews, setPreviews] = useState<WritePreview[]>([]);
  const [message, setMessage] = useState<string | undefined>();

  // Single-flight guard: each begin/commit/cancel bumps this; async results whose
  // run is no longer current are dropped (no setState after supersede/unmount).
  const runId = useRef(0);

  const begin = useCallback(
    (req: WriteRequest) => {
      const run = ++runId.current;
      setRequest(req);
      setPreviews([]);
      setMessage(undefined);
      setPhase('loading');

      void (async () => {
        try {
          let next: WritePreview[];
          if (req.kind === 'fix') {
            const res = await applyFix(req.findingId, { dryRun: true });
            next = res.edits.map((e) => ({
              path: e.path,
              pathScope: e.pathScope,
              willCreate: e.willCreate,
              willModify: e.willModify,
              hunks: parseDiff(e.diff),
            }));
          } else {
            const res = await writeFile(req.path, req.content, true);
            next = [
              {
                path: res.path ?? req.path,
                pathScope: res.pathScope,
                willCreate: res.willCreate ?? false,
                willModify: res.willModify ?? false,
                hunks: parseDiff(res.diff),
              },
            ];
          }
          if (run !== runId.current) return;
          setPreviews(next);
          setPhase('ready');
        } catch (err) {
          if (run !== runId.current) return;
          setMessage(reason(err, 'preview'));
          setPhase('error');
        }
      })();
    },
    [applyFix, writeFile],
  );

  const commit = useCallback(() => {
    const req = request;
    if (!req) return;
    const run = ++runId.current;
    setPhase('committing');
    setMessage(undefined);

    void (async () => {
      try {
        if (req.kind === 'fix') {
          const res = await applyFix(req.findingId, { dryRun: false });
          if (run !== runId.current) return;
          if (res.committed === false) {
            const failed = res.edits.find((e) => e.committed === false);
            setMessage(failed ? `partly applied · ${failed.path} failed` : 'write failed');
            setPhase('error');
            refetch();
            return;
          }
        } else {
          await writeFile(req.path, req.content, false);
          if (run !== runId.current) return;
        }
        setMessage('applied · report updated');
        setPhase('done');
        // Pull the fresh report so the resolved finding drops out / the file
        // reflects the write (the WS push will also trigger this).
        refetch();
      } catch (err) {
        if (run !== runId.current) return;
        setMessage(reason(err, 'commit'));
        setPhase('error');
      }
    })();
  }, [request, applyFix, writeFile, refetch]);

  const cancel = useCallback(() => {
    runId.current += 1; // supersede any in-flight request
    setPhase('idle');
    setRequest(undefined);
    setPreviews([]);
    setMessage(undefined);
  }, []);

  return { phase, request, previews, message, begin, commit, cancel };
}
