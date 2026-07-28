/**
 * Memory browser & editor (rail `11 MEMORY`, route `#/memory`, bead
 * agentconfig-wmc.7). Browses the instance's memory files — the markdown notes
 * under a `memory/` directory (`.claude/memory/…` and
 * `~/.claude/projects/<slug>/memory/…`) whose frontmatter carries a `type`,
 * `name`, and `description`, with the body holding the fact itself.
 *
 * The grid is a CARD per file: a colour-coded type badge, the name, the
 * description, and a one-line body preview. Frontmatter is parsed CLIENT-SIDE
 * (a hand-rolled splitter — no yaml dep; resilient to malformed input). Cards
 * bulk-load their (redacted) content from getFile; the list itself is derived
 * live from the report, so a WS-driven refetch keeps the grid current.
 *
 * Selecting a card opens a small FIELD EDITOR (type / name / description + the
 * body); a CREATE flow authors a brand-new note. Both serialize back to file
 * content and save through the reusable useWriteFlow ({kind:'file'}) → diff →
 * commit path — the ONLY write seam.
 *
 * REDACTION-SAVE TRAP (SPEC §3): getFile returns content with secrets already
 * replaced by visible `[REDACTED:*]` marks. A memory note can quote a secret, so
 * a redacted file (server `spans` OR a `[REDACTED:*]` mark — BOTH signals) is
 * shown READ-ONLY; committing the placeholder text would overwrite the real
 * on-disk value. All file / frontmatter content is adversarial and rendered as
 * TEXT NODES only — never markup, never eval.
 */

import { useEffect, useMemo, useState, type ReactNode } from 'react';
import { type FileContent, type RedactionSpan } from '../api/index.js';
import { Button, EmptyState, SourceBadge } from '../components/core/index.js';
import { homeRel } from '../lib/format.js';
import { useAppState, useGlobalConfig } from '../state/index.js';
import { WriteFlow, useWriteFlow } from '../write/index.js';
import {
  buildCard,
  collectGlobalMemoryFiles,
  collectMemoryFiles,
  isRedacted,
  MEMORY_TYPES,
  parseMemory,
  serializeMemory,
  suggestPath,
  type MemoryCard,
  type MemoryFields,
} from './memory/logic.js';
import './memory.css';

/** Known type → badge class; anything else gets the neutral badge. */
function badgeClass(type: string): string {
  const t = type.toLowerCase();
  return (MEMORY_TYPES as readonly string[]).includes(t) ? `mem__badge--${t}` : 'mem__badge--other';
}

/** Redacted `content` + mark `spans` → text nodes with styled `[REDACTED:*]`
 *  marks. Everything is a TEXT node — never markup; marks are already redacted
 *  server-side so no secret is present to leak. */
function renderRedacted(content: string, spans: readonly RedactionSpan[]): ReactNode[] {
  const nodes: ReactNode[] = [];
  let cursor = 0;
  spans.forEach((span, i) => {
    if (span.start < cursor || span.end > content.length) return;
    if (span.start > cursor) nodes.push(content.slice(cursor, span.start));
    nodes.push(
      <mark key={i} className="mem__redact" title={`redacted: ${span.id}`}>
        {content.slice(span.start, span.end)}
      </mark>,
    );
    cursor = span.end;
  });
  if (cursor < content.length) nodes.push(content.slice(cursor));
  return nodes;
}

/** What the editor is pointed at. */
type Mode = { kind: 'browse' } | { kind: 'edit'; path: string } | { kind: 'create' };

const EMPTY_FIELDS: MemoryFields = {
  type: 'user',
  name: '',
  description: '',
  body: '',
  extra: [],
};

export function Memory() {
  const { report, getFile } = useAppState();
  const { entries: globalDirs } = useGlobalConfig();
  const flow = useWriteFlow();

  const memoryPaths = useMemo(() => collectMemoryFiles(report), [report]);
  // Inherited GLOBAL memory files (bead 71h.5): absolute root-joined paths,
  // read via getFile only — never a write target. A failed global load only
  // drops those cards (the bulk loader already tolerates per-file failures);
  // absent global data ⇒ empty list and the page renders exactly as before.
  const globalFiles = useMemo(() => collectGlobalMemoryFiles(globalDirs), [globalDirs]);
  const globalByPath = useMemo(
    () => new Map(globalFiles.map((f) => [f.path, f.root])),
    [globalFiles],
  );
  const allPaths = useMemo(
    () => [...memoryPaths, ...globalFiles.map((f) => f.path)],
    [memoryPaths, globalFiles],
  );
  const pathsKey = allPaths.join('|');
  // A cheap live-reactivity key: the report's timestamp changes on every
  // (re)scan, so an edit/create that keeps the same path set still re-loads.
  const stamp = report?.generatedAt ?? '';

  // Bulk-load every memory file's (redacted) content, then build the cards.
  const [files, setFiles] = useState<Map<string, FileContent>>(new Map());
  const [status, setStatus] = useState<'idle' | 'loading' | 'error'>('idle');

  useEffect(() => {
    if (pathsKey === '') {
      setFiles(new Map());
      setStatus('idle');
      return;
    }
    let cancelled = false;
    setStatus('loading');
    const paths = pathsKey.split('|');
    Promise.all(
      paths.map((p) =>
        getFile(p)
          .then((f) => [p, f] as const)
          .catch(() => null),
      ),
    ).then((results) => {
      if (cancelled) return;
      const map = new Map<string, FileContent>();
      for (const r of results) if (r) map.set(r[0], r[1]);
      setFiles(map);
      // Every load failing (not merely an empty instance) is the error state.
      setStatus(map.size === 0 ? 'error' : 'idle');
    });
    return () => {
      cancelled = true;
    };
  }, [pathsKey, stamp, getFile]);

  const cards = useMemo<MemoryCard[]>(
    () =>
      allPaths.filter((p) => files.has(p)).map((p) => buildCard(p, files.get(p) as FileContent)),
    [allPaths, files],
  );

  // ── Editor / create state ──────────────────────────────────────────────────
  const [mode, setMode] = useState<Mode>({ kind: 'browse' });
  const [draft, setDraft] = useState<MemoryFields>(EMPTY_FIELDS);
  const [baseline, setBaseline] = useState<MemoryFields>(EMPTY_FIELDS);
  const [createPath, setCreatePath] = useState('');
  const [pathTouched, setPathTouched] = useState(false);

  const activeFile = mode.kind === 'edit' ? files.get(mode.path) : undefined;
  const redacted = activeFile ? isRedacted(activeFile) : false;
  // Inherited global file ⇒ read-only regardless of content: its absolute path
  // must never reach the write flow from a project view.
  const inherited = mode.kind === 'edit' && globalByPath.has(mode.path);
  const readOnly = redacted || inherited;

  // Re-baseline an open editor after our own commit lands (files reloads via the
  // stamp-keyed effect above), so the save button falls honestly idle.
  useEffect(() => {
    if (flow.phase !== 'done' || mode.kind !== 'edit') return;
    const f = files.get(mode.path);
    if (!f) return;
    const fields = parseMemory(f.content);
    setDraft(fields);
    setBaseline(fields);
  }, [flow.phase, files, mode]);

  function openEdit(path: string) {
    const f = files.get(path);
    if (!f) return;
    flow.cancel();
    const fields = parseMemory(f.content);
    setDraft(fields);
    setBaseline(fields);
    setMode({ kind: 'edit', path });
  }

  function openCreate() {
    flow.cancel();
    setDraft(EMPTY_FIELDS);
    setBaseline(EMPTY_FIELDS);
    setCreatePath('');
    setPathTouched(false);
    setMode({ kind: 'create' });
  }

  function closeEditor() {
    flow.cancel();
    setMode({ kind: 'browse' });
  }

  const effectivePath =
    mode.kind === 'create'
      ? pathTouched
        ? createPath.trim()
        : suggestPath(draft.name)
      : mode.kind === 'edit'
        ? mode.path
        : '';

  const busy = flow.phase === 'loading' || flow.phase === 'committing';
  const dirty = JSON.stringify(draft) !== JSON.stringify(baseline);
  const canSave =
    !busy &&
    effectivePath !== '' &&
    (mode.kind === 'create' ? draft.name.trim() !== '' : !readOnly && dirty);

  function onSave() {
    if (!canSave) return;
    flow.begin({
      kind: 'file',
      path: effectivePath,
      content: serializeMemory(draft),
      label: effectivePath,
    });
  }

  const editorOpen = mode.kind === 'edit' || mode.kind === 'create';

  return (
    <main className="layout-main page">
      <section className="page__section">
        <h1 className="title-page">
          MEMORY
          <span className="mem__count mono-data">{allPaths.length} FILES</span>
        </h1>
        <div className="mem__tabs">
          <Button
            label="+ new memory"
            variant={mode.kind === 'create' ? 'primary' : 'default'}
            onClick={openCreate}
          />
        </div>
      </section>

      <section className="page__section">
        {allPaths.length === 0 ? (
          <EmptyState
            title="NO MEMORY"
            instruction="no memory files yet — create one to capture a persistent fact"
          />
        ) : status === 'loading' && cards.length === 0 ? (
          <p className="micro-label">loading memory…</p>
        ) : status === 'error' ? (
          <EmptyState title="NO SIGNAL" instruction="could not load memory files" />
        ) : (
          <div className="mem__grid">
            {cards.map((card) => (
              <button
                key={card.path}
                type="button"
                className="mem__card"
                onClick={() => openEdit(card.path)}
                {...(mode.kind === 'edit' && mode.path === card.path
                  ? { 'aria-current': 'true' }
                  : {})}
              >
                <div className="mem__card-head">
                  <span className={`mem__badge micro-label ${badgeClass(card.type)}`}>
                    {card.type === '' ? 'untyped' : card.type}
                  </span>
                  {card.redacted && <span className="mem__redact-tag micro-label">redacted</span>}
                  {globalByPath.has(card.path) && <SourceBadge scope="global" readOnly />}
                </div>
                <span className="mem__card-name">{card.name}</span>
                {card.description !== '' && <p className="mem__card-desc">{card.description}</p>}
                {card.preview !== '' && (
                  <p className="mem__card-preview mono-data">{card.preview}</p>
                )}
              </button>
            ))}
          </div>
        )}
      </section>

      {editorOpen && (
        <section className="page__section">
          <div className="mem__editor">
            <div className="mem__editor-head">
              <span className="mono-data">
                {mode.kind === 'create' ? 'new memory' : (mode.kind === 'edit' && mode.path) || ''}
              </span>
              {inherited && mode.kind === 'edit' ? (
                <SourceBadge
                  scope="global"
                  detail={homeRel(globalByPath.get(mode.path) ?? '')}
                  readOnly
                />
              ) : (
                activeFile && (
                  <span className="mem__scope micro-label">scope · {activeFile.pathScope}</span>
                )
              )}
              <span className="mem__editor-spacer" />
              <Button label="close" onClick={closeEditor} />
            </div>

            {readOnly ? (
              <>
                <p className="mem__note micro-label">
                  {redacted
                    ? 'contains redacted secrets — read-only; edit this file on disk'
                    : 'inherited · read-only'}
                </p>
                <pre className="mem__source mono-data">
                  {activeFile && renderRedacted(activeFile.content, activeFile.spans)}
                </pre>
              </>
            ) : (
              <>
                {mode.kind === 'create' && (
                  <label className="mem__field">
                    <span className="micro-label mem__label">file path</span>
                    <input
                      className="mono-data mem__input"
                      value={pathTouched ? createPath : suggestPath(draft.name)}
                      spellCheck={false}
                      onChange={(e) => {
                        setPathTouched(true);
                        setCreatePath(e.target.value);
                      }}
                      aria-label="new memory file path"
                    />
                  </label>
                )}

                <div className="mem__fields-row">
                  <label className="mem__field mem__field--type">
                    <span className="micro-label mem__label">type</span>
                    <select
                      className="mono-data mem__select"
                      value={draft.type}
                      onChange={(e) => setDraft({ ...draft, type: e.target.value })}
                      aria-label="memory type"
                    >
                      {/* Preserve an existing off-list type (e.g. the fixtures'
                          `context`) so editing never silently rewrites it. */}
                      {draft.type !== '' &&
                        !(MEMORY_TYPES as readonly string[]).includes(draft.type) && (
                          <option value={draft.type}>{draft.type}</option>
                        )}
                      {MEMORY_TYPES.map((t) => (
                        <option key={t} value={t}>
                          {t}
                        </option>
                      ))}
                    </select>
                  </label>

                  <label className="mem__field mem__field--name">
                    <span className="micro-label mem__label">name</span>
                    <input
                      className="mono-data mem__input"
                      value={draft.name}
                      spellCheck={false}
                      onChange={(e) => setDraft({ ...draft, name: e.target.value })}
                      aria-label="memory name"
                    />
                  </label>
                </div>

                <label className="mem__field">
                  <span className="micro-label mem__label">description</span>
                  <input
                    className="mem__input"
                    value={draft.description}
                    onChange={(e) => setDraft({ ...draft, description: e.target.value })}
                    aria-label="memory description"
                  />
                </label>

                <label className="mem__field">
                  <span className="micro-label mem__label">fact (body)</span>
                  <textarea
                    className="mono-data mem__textarea"
                    value={draft.body}
                    spellCheck={false}
                    onChange={(e) => setDraft({ ...draft, body: e.target.value })}
                    aria-label="memory body"
                  />
                </label>

                <div className="mem__actions">
                  <Button label="save" variant="primary" onClick={onSave} disabled={!canSave} />
                </div>
              </>
            )}

            <WriteFlow flow={flow} />
          </div>
        </section>
      )}
    </main>
  );
}
