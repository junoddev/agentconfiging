import { useCallback, useEffect, useMemo, useState, type ReactNode } from 'react';
import { ApiError, type FileContent } from '../api/index.js';
import { EmptyState, SourceBadge } from '../components/core/index.js';
import { homeRel } from '../lib/format.js';
import { useAppState, useGlobalConfig } from '../state/index.js';
import { WriteFlow, useWriteFlow } from '../write/index.js';
import { HookCard } from './hooks/HookCard.js';
import { HookForm } from './hooks/HookForm.js';
import { HOOK_EVENTS } from './hooks/events.js';
import {
  addHookToSettings,
  canRemoveHookEntry,
  contentHasRedactionMarks,
  draftFromTemplate,
  emptyDraft,
  globalAddViaWholeFile,
  globalHookCards,
  globalHookSource,
  hookWriteTargets,
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

/** A parsed card plus the file it belongs to. */
interface CardRef {
  entry: HookEntry;
  source: string;
  /** True when the owning file is redacted (card is display-only). */
  readOnly: boolean;
}

function initialSources(): SourceState[] {
  return SETTINGS_PATHS.map((path) => ({ path, status: 'loading', redacted: false }));
}

/** Load + parse state for the inherited ~/.claude settings file (bead 71h.4).
 *  Undefined = no global `.claude` home at all; 'absent' = the home exists but
 *  settings.json does not (an ADD can create it — bead 71h.10). */
interface GlobalSourceState {
  status: GlobalHookStatus;
  parse?: HooksParse;
  message?: string;
}

/**
 * Hooks manager (rail `09 HOOKS`, route `#/hooks`, bead agentconfig-wmc.5).
 *
 * Left: the tracked Claude Code hook events (data file ./hooks/events.ts) as a
 * filterable sidebar with live counts. Right: each configured hook as a
 * collapsible card, plus a visual create form with four quick-add templates.
 *
 * WRITES go out through useWriteFlow only: a create/remove builds the next
 * settings.json content client-side (./hooks/logic) and begins a dry-run → diff →
 * commit. Every hook value (matcher, command) is adversarial config rendered as a
 * TEXT NODE, never markup, and never executed.
 *
 * REDACTION-SAVE TRAP: settings.json can hold secrets in `env`, so the server
 * serves it REDACTED. Serializing redacted content back would clobber those
 * secrets, so a redacted file is READ-ONLY here (its cards show, but create/remove
 * into it is disabled with a note). Only files served without redaction marks are
 * writable.
 *
 * INHERITED GLOBAL HOOKS (beads 71h.4 / 71h.10): the machine-global
 * ~/.claude/settings.json (from useGlobalConfig) is ALSO shown — its hooks fire
 * for this project too — under a GLOBAL SourceBadge, and since 71h.10 it is
 * EDITABLE: cards carry [REMOVE] (hidden for command-less entries) and the
 * create form can target it. Both ops drive the STRUCTURED /api/hooks/edit
 * endpoint (server bead 71h.9) through the SAME dry-run → diff → commit flow —
 * the server re-reads the RAW file, so even a redacted global settings.json is
 * editable without the save trap; the flow's GLOBAL-SCOPE warning flags every
 * commit as affecting all projects/agents. An ABSENT global settings.json is
 * created via the whole-file /api/write fallback instead (the structured
 * endpoint 404s on absent files). The whole-file project editors above stay
 * trap-gated exactly as before.
 */
export function Hooks() {
  const { getFile, report, currentInstance } = useAppState();
  const { entries: globalEntries } = useGlobalConfig();
  const flow = useWriteFlow();

  const [sources, setSources] = useState<SourceState[]>(initialSources);
  const [globalState, setGlobalState] = useState<GlobalSourceState | undefined>(undefined);
  const [selectedEvent, setSelectedEvent] = useState<string>('all');
  const [creating, setCreating] = useState(false);
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
  // shows the page's normal per-source error note. A committed global op
  // refetches the global report (useWriteFlow), which re-runs this load.
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

  // All cards across ready files, redacted files contributing read-only cards.
  const cards = useMemo<CardRef[]>(() => {
    const out: CardRef[] = [];
    for (const s of sources) {
      if (s.status !== 'ready' || !s.parse?.ok) continue;
      for (const entry of s.parse.entries) {
        out.push({ entry, source: s.path, readOnly: s.redacted });
      }
    }
    return out;
  }, [sources]);

  // Inherited global hooks as ALWAYS-read-only cards (never write targets).
  const globalCards = useMemo(
    () =>
      globalSrc && globalState?.status === 'ready'
        ? globalHookCards(globalState.parse, homeRel(globalSrc.path))
        : [],
    [globalSrc, globalState],
  );

  const totalCount = cards.length + globalCards.length;

  // Live per-event counts for the sidebar — global hooks fire too, so they count.
  const countByEvent = useMemo(() => {
    const counts = new Map<string, number>();
    for (const c of [...cards, ...globalCards]) {
      counts.set(c.entry.event, (counts.get(c.entry.event) ?? 0) + 1);
    }
    return counts;
  }, [cards, globalCards]);

  const visibleCards = useMemo(
    () => (selectedEvent === 'all' ? cards : cards.filter((c) => c.entry.event === selectedEvent)),
    [cards, selectedEvent],
  );
  const visibleGlobalCards = useMemo(
    () =>
      selectedEvent === 'all'
        ? globalCards
        : globalCards.filter((c) => c.entry.event === selectedEvent),
    [globalCards, selectedEvent],
  );

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

  const removeCard = useCallback(
    (card: CardRef) => {
      setBuildError(undefined);
      const base = baseContent.get(card.source);
      if (base === undefined) {
        setBuildError('this file is read-only');
        return;
      }
      try {
        const content = removeHookFromSettings(
          base,
          card.entry.event,
          card.entry.groupIndex,
          card.entry.hookIndex,
        );
        flow.begin({
          kind: 'file',
          path: card.source,
          content,
          label: `remove ${card.entry.event} hook`,
        });
      } catch (err) {
        setBuildError(err instanceof Error ? err.message : 'could not build change');
      }
    },
    [baseContent, flow],
  );

  // GLOBAL card removal (bead 71h.10): the STRUCTURED remove op, addressed by
  // the card's own parseHooksBlock coordinates with the command pinned as the
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

  const openForm = useCallback(() => {
    setBuildError(undefined);
    flow.cancel();
    setDraft(
      emptyDraft(selectedEvent === 'all' ? (HOOK_EVENTS[0]?.name ?? 'Stop') : selectedEvent),
    );
    setCreating(true);
  }, [flow, selectedEvent]);

  const closeForm = useCallback(() => {
    setBuildError(undefined);
    flow.cancel();
    setCreating(false);
  }, [flow]);

  // Fetch error before anything loaded (unauthorized handled by the shell).
  if (!report && !currentInstance) {
    return (
      <Frame>
        <EmptyState title="ACQUIRING" instruction="awaiting instance" />
      </Frame>
    );
  }

  return (
    <Frame>
      <h1 className="title-page">
        HOOKS
        <span className="hooks__count mono-data">{totalCount} CONFIGURED</span>
      </h1>

      {anyRedacted && (
        <p className="hooks__note micro-label" role="note">
          a settings file is redacted (contains secrets) — its hooks are read-only to avoid
          clobbering them on save
        </p>
      )}

      <div className="hooks">
        <nav className="hooks__events" aria-label="hook events">
          <button
            type="button"
            className="hooks__event"
            aria-current={selectedEvent === 'all' ? 'true' : undefined}
            onClick={() => setSelectedEvent('all')}
          >
            <span className="mono-data">all events</span>
            <span className="hooks__event-count micro-label">{totalCount}</span>
          </button>
          {HOOK_EVENTS.map((ev) => {
            const n = countByEvent.get(ev.name) ?? 0;
            return (
              <button
                key={ev.name}
                type="button"
                className="hooks__event"
                aria-current={selectedEvent === ev.name ? 'true' : undefined}
                title={ev.description}
                onClick={() => setSelectedEvent(ev.name)}
              >
                <span className="mono-data">{ev.name}</span>
                <span className="hooks__event-count micro-label">{n > 0 ? n : ''}</span>
              </button>
            );
          })}
        </nav>

        <div className="hooks__detail">
          <div className="hooks__toolbar">
            {!creating && (
              <button
                type="button"
                className="hooks__add"
                disabled={targets.length === 0}
                onClick={openForm}
              >
                [+ NEW HOOK]
              </button>
            )}
            {targets.length === 0 && !anyLoading && (
              <span className="hooks__note micro-label">no writable settings file</span>
            )}
          </div>

          {creating && (
            <>
              <HookForm
                draft={draft}
                onChange={setDraft}
                onTemplate={(t) => {
                  setBuildError(undefined);
                  setDraft(draftFromTemplate(t));
                }}
                onSubmit={beginCreate}
                onCancel={closeForm}
                targets={targets}
                target={target}
                onTargetChange={setTarget}
                busy={flowBusy}
              />
              {buildError !== undefined && (
                <p className="hooks__note hooks__error micro-label" role="alert">
                  {buildError}
                </p>
              )}
              {flow.phase !== 'idle' && <WriteFlow flow={flow} />}
            </>
          )}

          {!creating && flow.phase !== 'idle' && <WriteFlow flow={flow} />}
          {!creating && buildError !== undefined && (
            <p className="hooks__note hooks__error micro-label" role="alert">
              {buildError}
            </p>
          )}

          {anyLoading ? (
            <p className="micro-label">loading settings …</p>
          ) : totalCount === 0 ? (
            <EmptyState instruction="no hooks configured · add one to begin" />
          ) : visibleCards.length === 0 && visibleGlobalCards.length === 0 ? (
            <EmptyState instruction={`no hooks for ${selectedEvent}`} />
          ) : (
            <>
              {visibleCards.length > 0 && (
                <div className="hooks__cards">
                  {visibleCards.map((card) => (
                    <HookCard
                      key={`${card.source}:${card.entry.event}:${card.entry.groupIndex}:${card.entry.hookIndex}`}
                      entry={card.entry}
                      source={card.source}
                      readOnly={card.readOnly}
                      onRemove={card.readOnly ? undefined : () => removeCard(card)}
                    />
                  ))}
                </div>
              )}
              {globalSrc && visibleGlobalCards.length > 0 && (
                <div className="hooks__global">
                  <SourceBadge scope="global" detail={homeRel(globalSrc.root)} />
                  <div className="hooks__cards">
                    {visibleGlobalCards.map((card) => (
                      <HookCard
                        key={`global:${card.entry.event}:${card.entry.groupIndex}:${card.entry.hookIndex}`}
                        entry={card.entry}
                        source={card.source}
                        {...(canRemoveHookEntry(card.entry)
                          ? { onRemove: () => removeGlobalEntry(card.entry) }
                          : {})}
                      />
                    ))}
                  </div>
                </div>
              )}
            </>
          )}

          {sources
            .filter((s) => s.status === 'error')
            .map((s) => (
              <p key={s.path} className="hooks__note hooks__error micro-label">
                {s.path} · {s.message ?? 'could not load'}
              </p>
            ))}
          {sources.some((s) => s.status === 'ready' && s.parse?.ok === false) && (
            <p className="hooks__note hooks__error micro-label">
              a settings file has a malformed hooks block — fix it in ARTIFACTS
            </p>
          )}
          {globalSrc && globalState?.status === 'error' && (
            <p className="hooks__note hooks__error micro-label">
              {homeRel(globalSrc.path)} · {globalState.message ?? 'could not load'}
            </p>
          )}
          {globalSrc && globalState?.status === 'ready' && globalState.parse?.ok === false && (
            <p className="hooks__note hooks__error micro-label">
              {homeRel(globalSrc.path)} has a malformed hooks block — its hooks are not shown
            </p>
          )}
        </div>
      </div>
    </Frame>
  );
}

/** Shared page chassis so every state renders in the same main/section shell. */
function Frame({ children }: { children: ReactNode }) {
  return (
    <main className="layout-main page">
      <section className="page__section">{children}</section>
    </main>
  );
}
