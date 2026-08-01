import { useCallback, useEffect, useMemo, useState } from 'react';
import { ApiError, type FileContent } from '../api/index.js';
import {
  Button,
  Dialog,
  EmptyState,
  Frame,
  ListCard,
  ListRow,
  Notice,
  SourceBadge,
  useToast,
  type SourceScope,
} from '../components/core/index.js';
import { homeRel } from '../lib/format.js';
import {
  displayNameForKind,
  sectionApplies,
  useAppState,
  useGlobalConfig,
} from '../state/index.js';
import { WriteFlow, useWriteFlow } from '../write/index.js';
import { HookForm } from './hooks/HookForm.js';
import { HOOK_EVENTS } from './hooks/events.js';
import {
  addHookToSettings,
  canRemoveHookEntry,
  contentHasRedactionMarks,
  draftFromTemplate,
  emptyDraft,
  globalAddViaWholeFile,
  globalHookSource,
  hookWriteTargets,
  isDraftValid,
  isRedacted,
  parseHooksBlock,
  removeHookFromSettings,
  type GlobalHookStatus,
  type HookDraft,
  type HookEntry,
  type HooksParse,
} from './hooks/logic.js';
import './hooks.css';

/** The two settings files that can carry a `hooks` block, in write-priority order. */
const SETTINGS_PATHS = ['.claude/settings.json', '.claude/settings.local.json'] as const;

/** Per-file load + parse state for the manager. */
interface SourceState {
  path: string;
  status: 'loading' | 'ready' | 'absent' | 'error';
  file?: FileContent;
  parse?: HooksParse;
  /** True when the served content is redacted → edits are refused (save trap). */
  redacted: boolean;
  message?: string;
}

/** One configured hook as a list row: the parsed entry plus its provenance. */
interface Row {
  entry: HookEntry;
  /** Display path of the owning file (project-relative or ~-relative). */
  sourcePath: string;
  scope: SourceScope;
  /** SourceBadge detail (the global root), when applicable. */
  detail?: string;
  /** Present when this row can be removed (writable file / structured global op). */
  onRemove?: () => void;
}

function initialSources(): SourceState[] {
  return SETTINGS_PATHS.map((path) => ({ path, status: 'loading', redacted: false }));
}

/** Which scope badge a project settings file earns. */
function projectScope(path: string): SourceScope {
  return path.includes('.local.') ? 'local' : 'project';
}

/** Load + parse state for the inherited ~/.claude settings file (bead 71h.4).
 *  Undefined = no global `.claude` home at all; 'absent' = the home exists but
 *  settings.json does not (an ADD can create it — bead 71h.10). */
interface GlobalSourceState {
  status: GlobalHookStatus;
  parse?: HooksParse;
  message?: string;
}

export function Hooks() {
  // Toasts confirm through the shell-level ToastProvider (App.tsx).
  return <HooksPage />;
}

/**
 * Hooks manager (route `#/hooks`, Console conversion bead agentconfig-4u1.4).
 *
 * Hooks render as one `.list-card` per lifecycle event (lc-head = event name +
 * count); each row is matcher + scope badge, the command as the muted mono
 * sub-line, and trailing meta + a ghost Remove. The create form lives in the
 * shared Dialog; every committed mutation confirms via Toast.
 *
 * WRITES go out through useWriteFlow only: a create/remove builds the next
 * settings.json content client-side (./hooks/logic) and begins a dry-run → diff →
 * commit. Every hook value (matcher, command) is adversarial config rendered as a
 * TEXT NODE, never markup, and never executed.
 *
 * REDACTION-SAVE TRAP: settings.json can hold secrets in `env`, so the server
 * serves it REDACTED. Serializing redacted content back would clobber those
 * secrets, so a redacted file is READ-ONLY here (its rows show, but create/remove
 * into it is disabled with a notice). Only files served without redaction marks
 * are writable.
 *
 * INHERITED GLOBAL HOOKS (beads 71h.4 / 71h.10): the machine-global
 * ~/.claude/settings.json (from useGlobalConfig) is ALSO shown — its hooks fire
 * for this project too — under GLOBAL scope badges, and it is EDITABLE: rows
 * carry Remove (hidden for command-less entries) and the create form can target
 * it. Both ops drive the STRUCTURED /api/hooks/edit endpoint (server bead 71h.9)
 * through the SAME dry-run → diff → commit flow — the server re-reads the RAW
 * file, so even a redacted global settings.json is editable without the save
 * trap; the flow's GLOBAL-SCOPE warning flags every commit as affecting all
 * projects/agents. An ABSENT global settings.json is created via the whole-file
 * /api/write fallback instead (the structured endpoint 404s on absent files).
 */
function HooksPage() {
  const { getFile, report, currentInstance, activeAgent } = useAppState();
  const { entries: globalEntries } = useGlobalConfig();
  const flow = useWriteFlow();
  const toast = useToast();

  const [sources, setSources] = useState<SourceState[]>(initialSources);
  const [globalState, setGlobalState] = useState<GlobalSourceState | undefined>(undefined);
  const [dialogOpen, setDialogOpen] = useState(false);
  const [draft, setDraft] = useState<HookDraft>(() => emptyDraft(HOOK_EVENTS[0]?.name ?? 'Stop'));
  const [target, setTarget] = useState<string>(SETTINGS_PATHS[0]);
  const [buildError, setBuildError] = useState<string | undefined>(undefined);

  // Load both settings files whenever the instance or its report changes (a WS
  // push → refetch bumps `report`, giving live reactivity). A 404 is a normal
  // "absent" state, not an error.
  const instanceId = currentInstance?.id;
  useEffect(() => {
    let cancelled = false;
    setSources(initialSources());
    void Promise.all(
      SETTINGS_PATHS.map(async (path): Promise<SourceState> => {
        try {
          const file = await getFile(path);
          const redacted = isRedacted(file.spans) || contentHasRedactionMarks(file.content);
          return { path, status: 'ready', file, parse: parseHooksBlock(file.content), redacted };
        } catch (err) {
          if (err instanceof ApiError && err.kind === 'notfound') {
            return { path, status: 'absent', redacted: false };
          }
          return {
            path,
            status: 'error',
            redacted: false,
            message: err instanceof ApiError ? err.message : 'could not load file',
          };
        }
      }),
    ).then((next) => {
      if (!cancelled) setSources(next);
    });
    return () => {
      cancelled = true;
    };
    // `report` is intentionally a dep so a live refetch re-pulls the files.
  }, [getFile, instanceId, report]);

  // The inherited ~/.claude settings.json (bead 71h.4) — instance-independent.
  // No global `.claude` home ⇒ silently no global section; a 404 on the file is
  // the 'absent' state (an ADD can create it — bead 71h.10); any other failure
  // shows a notice. A committed global op refetches the global report
  // (useWriteFlow), which re-runs this load.
  const globalSrc = useMemo(() => globalHookSource(globalEntries), [globalEntries]);
  useEffect(() => {
    if (!globalSrc) {
      setGlobalState(undefined);
      return;
    }
    let cancelled = false;
    setGlobalState({ status: 'loading' });
    getFile(globalSrc.path)
      .then((file) => {
        if (!cancelled) setGlobalState({ status: 'ready', parse: parseHooksBlock(file.content) });
      })
      .catch((err: unknown) => {
        if (cancelled) return;
        if (err instanceof ApiError && err.kind === 'notfound') {
          setGlobalState({ status: 'absent' });
          return;
        }
        setGlobalState({
          status: 'error',
          message: err instanceof ApiError ? err.message : 'could not load file',
        });
      });
    return () => {
      cancelled = true;
    };
  }, [getFile, globalSrc]);

  // Files we can safely write to: served without redaction. An absent file is
  // writable (the write creates it); a ready-but-redacted file is not.
  const writable = useMemo(
    () => sources.filter((s) => s.status === 'absent' || (s.status === 'ready' && !s.redacted)),
    [sources],
  );
  const writablePaths = useMemo(() => writable.map((s) => s.path), [writable]);

  // Base content each writable path serializes from (absent ⇒ empty object).
  const baseContent = useMemo(() => {
    const map = new Map<string, string>();
    for (const s of writable) map.set(s.path, s.file?.content ?? '{}');
    return map;
  }, [writable]);

  // Create-form targets: the writable project files plus the global one when
  // usable (loaded or absent-and-creatable) — bead 71h.10.
  const targets = useMemo(
    () => hookWriteTargets(writablePaths, globalSrc, globalState?.status),
    [writablePaths, globalSrc, globalState],
  );

  // Keep the write target valid as availability changes.
  useEffect(() => {
    if (targets.length > 0 && !targets.some((t) => t.path === target)) {
      setTarget(targets[0]!.path);
    }
  }, [targets, target]);

  const removeProjectEntry = useCallback(
    (path: string, entry: HookEntry) => {
      setBuildError(undefined);
      const base = baseContent.get(path);
      if (base === undefined) {
        setBuildError('this file is read-only');
        return;
      }
      try {
        const content = removeHookFromSettings(
          base,
          entry.event,
          entry.groupIndex,
          entry.hookIndex,
        );
        flow.begin({ kind: 'file', path, content, label: `remove ${entry.event} hook` });
      } catch (err) {
        setBuildError(err instanceof Error ? err.message : 'could not build change');
      }
    },
    [baseContent, flow],
  );

  // GLOBAL row removal (bead 71h.10): the STRUCTURED remove op, addressed by
  // the row's own parseHooksBlock coordinates with the command pinned as the
  // server-side precondition (stale view ⇒ 409, file untouched). Callers gate
  // on canRemoveHookEntry — a command-less entry would 400.
  const removeGlobalEntry = useCallback(
    (entry: HookEntry) => {
      if (!globalSrc || entry.command === undefined) return;
      setBuildError(undefined);
      flow.begin({
        kind: 'hooks-edit',
        edit: {
          path: globalSrc.path,
          op: 'remove',
          address: { event: entry.event, groupIndex: entry.groupIndex, hookIndex: entry.hookIndex },
          expected: { command: entry.command },
        },
        label: `remove ${entry.event} hook`,
      });
    },
    [globalSrc, flow],
  );

  // All rows across the project files plus the inherited global file, in one
  // provenance-badged pool (grouped by event below).
  const rows = useMemo<Row[]>(() => {
    const out: Row[] = [];
    for (const s of sources) {
      if (s.status !== 'ready' || !s.parse?.ok) continue;
      for (const entry of s.parse.entries) {
        out.push({
          entry,
          sourcePath: s.path,
          scope: projectScope(s.path),
          ...(s.redacted ? {} : { onRemove: () => removeProjectEntry(s.path, entry) }),
        });
      }
    }
    if (globalSrc && globalState?.status === 'ready' && globalState.parse?.ok) {
      for (const entry of globalState.parse.entries) {
        out.push({
          entry,
          sourcePath: homeRel(globalSrc.path),
          scope: 'global',
          detail: homeRel(globalSrc.root),
          ...(canRemoveHookEntry(entry) ? { onRemove: () => removeGlobalEntry(entry) } : {}),
        });
      }
    }
    return out;
  }, [sources, globalSrc, globalState, removeProjectEntry, removeGlobalEntry]);

  // One list-card per event, tracked events first (data-file order), then any
  // events the config carries that we don't track.
  const grouped = useMemo<[string, Row[]][]>(() => {
    const byEvent = new Map<string, Row[]>();
    for (const ev of HOOK_EVENTS) byEvent.set(ev.name, []);
    for (const row of rows) {
      const list = byEvent.get(row.entry.event);
      if (list) list.push(row);
      else byEvent.set(row.entry.event, [row]);
    }
    return [...byEvent.entries()].filter(([, list]) => list.length > 0);
  }, [rows]);

  const totalCount = rows.length;
  const anyLoading = sources.some((s) => s.status === 'loading');
  const anyRedacted = sources.some((s) => s.status === 'ready' && s.redacted);
  const flowBusy = flow.phase === 'loading' || flow.phase === 'committing';

  const beginCreate = useCallback(() => {
    setBuildError(undefined);

    // GLOBAL target (bead 71h.10): a present file takes the STRUCTURED
    // /api/hooks/edit add (works even when redacted — the server edits the raw
    // file); an absent one is CREATED whole via /api/write (the structured
    // endpoint 404s on absent files; nothing redacted in a file that isn't).
    if (globalSrc !== undefined && target === globalSrc.path) {
      const status = globalState?.status;
      if (status !== 'ready' && status !== 'absent') {
        setBuildError('global settings file is not available');
        return;
      }
      if (globalAddViaWholeFile(status)) {
        try {
          const content = addHookToSettings('{}', draft);
          flow.begin({
            kind: 'file',
            path: globalSrc.path,
            content,
            label: `add ${draft.event} hook`,
            // Absence justified this whole-file create; if the dry-run finds
            // the file now exists, the flow refuses rather than replace it.
            expectCreate: true,
          });
        } catch (err) {
          setBuildError(err instanceof Error ? err.message : 'could not build change');
        }
        return;
      }
      if (draft.type.trim() !== 'command') {
        setBuildError('global hooks support type "command" only');
        return;
      }
      flow.begin({
        kind: 'hooks-edit',
        edit: {
          path: globalSrc.path,
          op: 'add',
          event: draft.event,
          ...(draft.matcher.trim() !== '' ? { matcher: draft.matcher } : {}),
          hook: { type: 'command', command: draft.command },
        },
        label: `add ${draft.event} hook`,
      });
      return;
    }

    const base = baseContent.get(target);
    if (base === undefined) {
      setBuildError('no writable settings file');
      return;
    }
    try {
      const content = addHookToSettings(base, draft);
      flow.begin({ kind: 'file', path: target, content, label: `add ${draft.event} hook` });
    } catch (err) {
      setBuildError(err instanceof Error ? err.message : 'could not build change');
    }
  }, [baseContent, target, draft, flow, globalSrc, globalState]);

  const openForm = useCallback(() => {
    setBuildError(undefined);
    flow.cancel();
    setDraft(emptyDraft(HOOK_EVENTS[0]?.name ?? 'Stop'));
    setDialogOpen(true);
  }, [flow]);

  const closeForm = useCallback(() => {
    setBuildError(undefined);
    flow.cancel();
    setDialogOpen(false);
  }, [flow]);

  // Every committed mutation confirms via Toast (§5), then the flow resets and
  // the dialog (if open) closes. Declared after the loads so the refetch-driven
  // effects above observe the 'done' phase first.
  useEffect(() => {
    if (flow.phase !== 'done') return;
    const label = flow.request?.label;
    toast(label !== undefined ? `Applied — ${label}` : 'Change applied');
    setDialogOpen(false);
    flow.cancel();
    // flow.phase is the trigger; toast + flow.cancel are stable.
  }, [flow.phase]);

  // Claude-only surface (bead a6y): lifecycle hooks live in .claude/settings*.json,
  // which only Claude Code reads — any other active agent gets an honest
  // not-applicable state. Placed AFTER every hook call so hook order never changes.
  const notApplicable = activeAgent !== undefined && !sectionApplies('hooks', activeAgent.kind);
  if (notApplicable) {
    return (
      <Frame>
        <div className="page-head">
          <div>
            <h1>Hooks</h1>
            <p className="page-sub">Commands that run on agent lifecycle events.</p>
          </div>
        </div>
        <Notice tone="info">
          <strong>Not applicable to {displayNameForKind(activeAgent.kind)}.</strong> Lifecycle hooks
          live in .claude/settings.json and .claude/settings.local.json — Claude Code surfaces.
          Switch the Agent picker to Claude Code to view or edit them.
        </Notice>
      </Frame>
    );
  }

  // Fetch error before anything loaded (unauthorized handled by the shell).
  if (!report && !currentInstance) {
    return (
      <Frame>
        <EmptyState title="No instance yet" instruction="Waiting for the first scan." />
      </Frame>
    );
  }

  return (
    <Frame>
      <div className="page-head">
        <div>
          <h1>Hooks</h1>
          <p className="page-sub">
            Commands that run on agent lifecycle events. {totalCount} configured across settings
            files — provenance on every row.
          </p>
        </div>
        <div>
          <Button
            label="Add hook"
            variant="primary"
            disabled={targets.length === 0}
            onClick={openForm}
          />
        </div>
      </div>

      {anyRedacted && (
        <Notice>
          <strong>A settings file is redacted (contains secrets).</strong> Its hooks are shown
          read-only so a save can never overwrite the real values with placeholders.
        </Notice>
      )}
      {targets.length === 0 && !anyLoading && (
        <Notice>
          <strong>No writable settings file.</strong> Every hooks-bearing file is redacted, so
          adding is disabled here.
        </Notice>
      )}

      {!dialogOpen && flow.phase !== 'idle' && <WriteFlow flow={flow} />}
      {!dialogOpen && buildError !== undefined && (
        <Notice>
          <strong>Could not build the change.</strong> {buildError}
        </Notice>
      )}

      {anyLoading ? (
        <p className="meta">loading settings …</p>
      ) : totalCount === 0 ? (
        <EmptyState
          title="No hooks yet"
          instruction="This project defines no hooks. Add one to run commands on lifecycle events."
        />
      ) : (
        grouped.map(([event, list]) => (
          <ListCard key={event} head={event} headMeta={String(list.length)}>
            {list.map((row) => (
              <ListRow
                key={`${row.sourcePath}:${row.entry.event}:${row.entry.groupIndex}:${row.entry.hookIndex}`}
                title={
                  <span className="mono">
                    {row.entry.matcher !== undefined && row.entry.matcher !== ''
                      ? row.entry.matcher
                      : 'all'}
                  </span>
                }
                badge={
                  <SourceBadge scope={row.scope} {...(row.detail ? { detail: row.detail } : {})} />
                }
                sub={
                  <span className="mono" title={row.entry.command}>
                    {row.entry.command ?? row.entry.type ?? '—'}
                  </span>
                }
                trailing={
                  <>
                    <span className="meta">
                      {row.entry.type ?? '—'}
                      {row.entry.timeout !== undefined ? ` · ${row.entry.timeout}s` : ''}
                    </span>
                    <span className="meta">{row.sourcePath}</span>
                    {row.onRemove && (
                      <Button
                        label="Remove"
                        variant="ghost"
                        onClick={row.onRemove}
                        disabled={flowBusy}
                      />
                    )}
                  </>
                }
              />
            ))}
          </ListCard>
        ))
      )}

      {sources
        .filter((s) => s.status === 'error')
        .map((s) => (
          <Notice key={s.path}>
            <strong>{s.path}</strong> — {s.message ?? 'could not load'}
          </Notice>
        ))}
      {sources.some((s) => s.status === 'ready' && s.parse?.ok === false) && (
        <Notice>
          <strong>A settings file has a malformed hooks block.</strong> Fix it in Artifacts.
        </Notice>
      )}
      {globalSrc && globalState?.status === 'error' && (
        <Notice>
          <strong>{homeRel(globalSrc.path)}</strong> — {globalState.message ?? 'could not load'}
        </Notice>
      )}
      {globalSrc && globalState?.status === 'ready' && globalState.parse?.ok === false && (
        <Notice>
          <strong>{homeRel(globalSrc.path)} has a malformed hooks block.</strong> Its hooks are not
          shown.
        </Notice>
      )}

      <Dialog
        open={dialogOpen}
        title="Add hook"
        onClose={closeForm}
        footer={
          <>
            <Button label="Cancel" onClick={closeForm} disabled={flowBusy} />
            <Button
              label="Preview change"
              variant="primary"
              onClick={beginCreate}
              disabled={!isDraftValid(draft) || flowBusy}
            />
          </>
        }
      >
        <HookForm
          draft={draft}
          onChange={setDraft}
          onTemplate={(t) => {
            setBuildError(undefined);
            setDraft(draftFromTemplate(t));
          }}
          targets={targets}
          target={target}
          onTargetChange={setTarget}
          busy={flowBusy}
        />
        {buildError !== undefined && (
          <Notice>
            <strong>Could not build the change.</strong> {buildError}
          </Notice>
        )}
        {dialogOpen && flow.phase !== 'idle' && <WriteFlow flow={flow} />}
      </Dialog>
    </Frame>
  );
}
