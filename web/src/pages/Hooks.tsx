import { useCallback, useEffect, useMemo, useState, type ReactNode } from 'react';
import { ApiError, type FileContent } from '../api/index.js';
import { EmptyState } from '../components/core/index.js';
import { useAppState } from '../state/index.js';
import { WriteFlow, useWriteFlow } from '../write/index.js';
import { HookCard } from './hooks/HookCard.js';
import { HookForm } from './hooks/HookForm.js';
import { HOOK_EVENTS } from './hooks/events.js';
import {
  addHookToSettings,
  contentHasRedactionMarks,
  draftFromTemplate,
  emptyDraft,
  isRedacted,
  parseHooksBlock,
  removeHookFromSettings,
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
 */
export function Hooks() {
  const { getFile, report, currentInstance } = useAppState();
  const flow = useWriteFlow();

  const [sources, setSources] = useState<SourceState[]>(initialSources);
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

  // Keep the write target valid as availability changes.
  useEffect(() => {
    if (writablePaths.length > 0 && !writablePaths.includes(target)) {
      setTarget(writablePaths[0]!);
    }
  }, [writablePaths, target]);

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

  // Live per-event counts for the sidebar.
  const countByEvent = useMemo(() => {
    const counts = new Map<string, number>();
    for (const c of cards) counts.set(c.entry.event, (counts.get(c.entry.event) ?? 0) + 1);
    return counts;
  }, [cards]);

  const visibleCards = useMemo(
    () => (selectedEvent === 'all' ? cards : cards.filter((c) => c.entry.event === selectedEvent)),
    [cards, selectedEvent],
  );

  const anyLoading = sources.some((s) => s.status === 'loading');
  const anyRedacted = sources.some((s) => s.status === 'ready' && s.redacted);
  const flowBusy = flow.phase === 'loading' || flow.phase === 'committing';

  const beginCreate = useCallback(() => {
    setBuildError(undefined);
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
  }, [baseContent, target, draft, flow]);

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
        <span className="hooks__count mono-data">{cards.length} CONFIGURED</span>
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
            <span className="hooks__event-count micro-label">{cards.length}</span>
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
                disabled={writablePaths.length === 0}
                onClick={openForm}
              >
                [+ NEW HOOK]
              </button>
            )}
            {writablePaths.length === 0 && !anyLoading && (
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
                targets={writablePaths}
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
          ) : cards.length === 0 ? (
            <EmptyState instruction="no hooks configured · add one to begin" />
          ) : visibleCards.length === 0 ? (
            <EmptyState instruction={`no hooks for ${selectedEvent}`} />
          ) : (
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
