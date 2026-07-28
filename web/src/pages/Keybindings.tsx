/**
 * Keybindings editor (rail `13 KEYBINDINGS`, route `#/keybindings`, bead
 * agentconfig-wmc.9). A visual editor for the PROJECT's .claude/keybindings.json
 * (the write target): it lists each binding's combo (chords shown as ordered
 * steps), command and condition, and offers add / edit / remove plus a
 * reset-to-starter action — every write going out through the reusable
 * useWriteFlow dry-run-diff → commit path. The inherited machine-global
 * ~/.claude/keybindings.json is ALSO shown, strictly read-only with a GLOBAL
 * SourceBadge (bead 71h.4) — it never joins the write path.
 *
 * SCHEMA IS UNCERTAIN. fixtures/README flags this file's shape as
 * "plausible-but-unofficial", so ./keybindings/logic parses it as structured
 * JSON (a `bindings` array under a wrapper object, OR a top-level array) and
 * renders whatever fields are present. Unmodeled keys — per-binding extras and
 * any non-`bindings` wrapper keys — round-trip untouched on save.
 *
 * SAFETY
 *  - Every binding value (combo, command, condition) is adversarial config data
 *    rendered as a TEXT NODE only — never markup, never executed.
 *  - REDACTION-SAVE TRAP: keybindings.json normally holds no secrets, but for
 *    consistency the file is shown READ-ONLY when EITHER the server flagged
 *    redaction spans OR the raw text carries a `[REDACTED:*]` mark — writing the
 *    placeholder back would clobber a real value.
 *  - RESET writes a documented STARTER set (clearly NOT the official defaults,
 *    which are unpublished) through the same dry-run diff — never a silent
 *    overwrite.
 */

import { useCallback, useEffect, useMemo, useState, type ReactNode } from 'react';
import { ApiError, type FileContent } from '../api/index.js';
import type { GlobalEntry } from '../api/types.js';
import { Button, EmptyState, SourceBadge } from '../components/core/index.js';
import { homeRel } from '../lib/format.js';
import { useAppState, useGlobalConfig } from '../state/index.js';
import { WriteFlow, useWriteFlow } from '../write/index.js';
import { BindingCard } from './keybindings/BindingCard.js';
import { BindingForm } from './keybindings/BindingForm.js';
import {
  buildResetContent,
  contentHasRedactionMarks,
  isRedacted,
  parseKeybindings,
  removeBinding,
  serializeKeybindings,
  upsertBinding,
  type Binding,
  type ParsedKeybindings,
} from './keybindings/logic.js';
import './keybindings.css';

/** The file this editor manages — the PROJECT scope's keybindings (writable). */
const KEYBINDINGS_PATH = '.claude/keybindings.json';

/** The inherited global keybindings file, when a ~/.claude home is known. */
export interface GlobalKeybindingsSource {
  /** Absolute root of the global config dir (e.g. '/Users/x/.claude'). */
  root: string;
  /** Absolute path of its keybindings.json — pass to getFile as-is. */
  path: string;
}

/**
 * Derive the global keybindings source from the machine-global report's
 * entries (bead 71h.4). Only the `.claude` home dir is relevant; a missing
 * entry (or a later 404 on the file) means no global section at all. The
 * result is ALWAYS read-only for callers — never a write target.
 */
export function globalKeybindingsSource(
  entries: readonly Pick<GlobalEntry, 'root' | 'dir'>[],
): GlobalKeybindingsSource | undefined {
  const claude = entries.find((e) => e.dir === '.claude');
  return claude ? { root: claude.root, path: `${claude.root}/keybindings.json` } : undefined;
}

/** Load + parse state for the inherited global file. Undefined = no source /
 *  file absent → silently no global section. */
interface GlobalKbState {
  status: 'loading' | 'ready' | 'error';
  parsed?: ParsedKeybindings;
  message?: string;
}

type SourceStatus = 'loading' | 'ready' | 'absent' | 'error';

/** Load + parse state for keybindings.json. */
interface SourceState {
  status: SourceStatus;
  file?: FileContent;
  parsed?: ParsedKeybindings;
  /** True when served content is redacted (dual signal) → edits refused. */
  redacted: boolean;
  message?: string;
}

/** An in-progress add/edit session. `index` addresses the binding being edited. */
interface Draft {
  mode: 'add' | 'edit';
  initial?: Binding;
  index?: number;
}

function Frame({ children }: { children: ReactNode }) {
  return (
    <main className="layout-main page">
      <section className="page__section">{children}</section>
    </main>
  );
}

export function Keybindings() {
  const { getFile, report, loading, error } = useAppState();
  const { entries: globalEntries } = useGlobalConfig();
  const flow = useWriteFlow();

  const [source, setSource] = useState<SourceState>({ status: 'loading', redacted: false });
  const [globalKb, setGlobalKb] = useState<GlobalKbState | undefined>(undefined);
  const [draft, setDraft] = useState<Draft | null>(null);

  // Load + parse the file whenever the report changes (a WS push → refetch bumps
  // `report`, giving live reactivity after each commit). A 404 is a normal
  // "absent" state — the editor can still author a fresh file.
  useEffect(() => {
    let cancelled = false;
    setSource({ status: 'loading', redacted: false });
    void (async () => {
      try {
        const file = await getFile(KEYBINDINGS_PATH);
        if (cancelled) return;
        const redacted = isRedacted(file.spans) || contentHasRedactionMarks(file.content);
        setSource({ status: 'ready', file, parsed: parseKeybindings(file.content), redacted });
      } catch (err) {
        if (cancelled) return;
        if (err instanceof ApiError && err.kind === 'notfound') {
          setSource({ status: 'absent', redacted: false });
          return;
        }
        setSource({
          status: 'error',
          redacted: false,
          message: err instanceof ApiError ? err.message : 'could not load file',
        });
      }
    })();
    return () => {
      cancelled = true;
    };
    // `report` is intentionally a dep so a live refetch re-pulls the file.
  }, [getFile, report]);

  // Load the inherited global keybindings file, read-only (bead 71h.4). No
  // global .claude entry or a 404 ⇒ silently no global section; other failures
  // surface as a per-source note.
  const globalSrc = useMemo(() => globalKeybindingsSource(globalEntries), [globalEntries]);
  useEffect(() => {
    if (!globalSrc) {
      setGlobalKb(undefined);
      return;
    }
    let cancelled = false;
    setGlobalKb({ status: 'loading' });
    getFile(globalSrc.path)
      .then((file) => {
        if (!cancelled) setGlobalKb({ status: 'ready', parsed: parseKeybindings(file.content) });
      })
      .catch((err: unknown) => {
        if (cancelled) return;
        if (err instanceof ApiError && err.kind === 'notfound') {
          setGlobalKb(undefined);
          return;
        }
        setGlobalKb({
          status: 'error',
          message: err instanceof ApiError ? err.message : 'could not load file',
        });
      });
    return () => {
      cancelled = true;
    };
  }, [getFile, globalSrc]);

  // A committed write clears the draft; the refetch reloads the file fresh.
  useEffect(() => {
    if (flow.phase === 'done') setDraft(null);
  }, [flow.phase]);

  const parsed = source.parsed;
  const bindings = parsed?.bindings ?? [];
  const parseError = parsed?.parseError ?? false;

  // Writable when the file parsed cleanly and is not redacted. An absent file is
  // writable too (the write creates it).
  const writable =
    !source.redacted && !parseError && (source.status === 'ready' || source.status === 'absent');

  // The container to serialize against (absent ⇒ fresh object shape).
  const container = useMemo(
    () => ({ shape: parsed?.shape ?? ('object' as const), doc: parsed?.doc ?? null }),
    [parsed],
  );

  const previewBindings = useCallback(
    (next: readonly Binding[], label: string) => {
      const content = serializeKeybindings(container, next);
      flow.begin({ kind: 'file', path: KEYBINDINGS_PATH, content, label });
    },
    [container, flow],
  );

  const onFormPreview = useCallback(
    (binding: Binding) => {
      if (!draft) return;
      const next = upsertBinding(bindings, binding, draft.index);
      previewBindings(next, draft.mode === 'edit' ? `edit ${binding.key}` : `add ${binding.key}`);
    },
    [draft, bindings, previewBindings],
  );

  const onRemove = useCallback(
    (index: number) => {
      if (!writable) return;
      previewBindings(
        removeBinding(bindings, index),
        `remove ${bindings[index]?.key ?? 'binding'}`,
      );
    },
    [writable, bindings, previewBindings],
  );

  const onReset = useCallback(() => {
    if (!writable) return;
    flow.begin({
      kind: 'file',
      path: KEYBINDINGS_PATH,
      content: buildResetContent(container),
      label: 'reset to starter set',
    });
  }, [writable, container, flow]);

  function startAdd() {
    if (!writable) return;
    setDraft({ mode: 'add' });
  }
  function startEdit(index: number) {
    if (!writable) return;
    setDraft({ mode: 'edit', initial: bindings[index], index });
  }
  function cancelDraft() {
    setDraft(null);
    flow.cancel();
  }

  // ── Load gates (mirroring the other E4 pages) ─────────────────────────────
  if (error && !report) {
    return (
      <Frame>
        <EmptyState instruction={error.message} />
      </Frame>
    );
  }
  if (!report) {
    return (
      <Frame>
        <EmptyState
          title="ACQUIRING"
          instruction={loading ? 'scanning config …' : 'awaiting report'}
        />
      </Frame>
    );
  }

  const count = bindings.length;

  return (
    <main className="layout-main page">
      <section className="page__section">
        <h1 className="title-page">
          KEYBINDINGS
          <span className="kb__count mono-data">
            {count} BINDING{count === 1 ? '' : 'S'}
          </span>
        </h1>
        <p className="kb__path micro-label">{KEYBINDINGS_PATH}</p>
      </section>

      {/* Editor: the add/edit form + the mandatory dry-run diff before any write. */}
      {(draft || flow.phase !== 'idle') && (
        <section className="page__section kb__editor">
          {draft && (
            <BindingForm
              mode={draft.mode}
              initial={draft.initial}
              onPreview={onFormPreview}
              onCancel={cancelDraft}
            />
          )}
          <WriteFlow flow={flow} />
        </section>
      )}

      <section className="page__section">
        {source.status === 'loading' && <p className="micro-label">loading keybindings …</p>}

        {source.status === 'error' && (
          <EmptyState instruction={source.message ?? 'could not load keybindings'} />
        )}

        {source.redacted && (
          <p className="kb__note micro-label kb__ro">
            this file contains redacted content — editing is disabled here so a masked placeholder
            is never written over a real value
          </p>
        )}

        {parseError && (
          <p className="kb__note micro-label">could not parse JSON — this file is not editable</p>
        )}

        {writable && (
          <div className="kb__toolbar">
            <Button label="add binding" variant="primary" onClick={startAdd} />
            <Button label="reset to starter set" onClick={onReset} />
          </div>
        )}
        {writable && (
          <p className="kb__note micro-label">
            reset writes a small starter set — a convenience, NOT the official Claude Code defaults
            (those are unpublished). You review the exact diff before it is applied.
          </p>
        )}

        {(source.status === 'ready' || source.status === 'absent') &&
          !parseError &&
          count === 0 && <EmptyState instruction="no keybindings configured in this instance" />}

        <div className="kb__cards">
          {bindings.map((binding, index) => (
            <BindingCard
              key={index}
              binding={binding}
              {...(writable
                ? { onEdit: () => startEdit(index), onRemove: () => onRemove(index) }
                : {})}
            />
          ))}
        </div>
      </section>

      {/* Inherited global keybindings (bead 71h.4) — strictly read-only. */}
      {globalSrc && globalKb && (
        <section className="page__section">
          <div className="kb__global-head">
            <SourceBadge scope="global" detail={homeRel(globalSrc.root)} readOnly />
            <span className="kb__path micro-label">{homeRel(globalSrc.path)}</span>
          </div>
          <p className="kb__note micro-label">
            inherited bindings shown read-only — this page writes only the project file above (how
            the two combine is undocumented, so no precedence order is claimed)
          </p>

          {globalKb.status === 'loading' && (
            <p className="micro-label">loading global keybindings …</p>
          )}
          {globalKb.status === 'error' && (
            <p className="kb__note micro-label kb__ro">
              {homeRel(globalSrc.path)} · {globalKb.message ?? 'could not load'}
            </p>
          )}
          {globalKb.status === 'ready' && globalKb.parsed?.parseError === true && (
            <p className="kb__note micro-label">could not parse JSON — bindings not shown</p>
          )}
          {globalKb.status === 'ready' &&
            globalKb.parsed !== undefined &&
            !globalKb.parsed.parseError &&
            (globalKb.parsed.bindings.length === 0 ? (
              <p className="kb__note micro-label">no bindings in this file</p>
            ) : (
              <div className="kb__cards">
                {globalKb.parsed.bindings.map((binding, index) => (
                  <BindingCard key={index} binding={binding} />
                ))}
              </div>
            ))}
        </section>
      )}
    </main>
  );
}
