import { useEffect, useMemo, useState, type ReactNode } from 'react';
import { ApiError, type FileContent, type RedactionSpan } from '../api/index.js';
import { Button, EmptyState, FileChip, SourceBadge } from '../components/core/index.js';
import { fileReadOnly } from '../lib/editable.js';
import { homeRel } from '../lib/format.js';
import { useAppState, useGlobalConfig } from '../state/index.js';
import { WriteFlow, useWriteFlow } from '../write/index.js';
import {
  collectGlobalInstructionFiles,
  collectInstructionFiles,
  extractImports,
  groupByScope,
  groupGlobalByRoot,
  hasRedactionMarks,
  resolveImports,
  tokenizeMarkdown,
  type MarkdownBlock,
  type ResolvedImport,
} from './instructions/logic.js';
import './instructions.css';

/** Which pane of an editable file is showing. */
type Mode = 'edit' | 'preview';

/** Honest one-line error voice per API failure kind (§7). */
function errorText(err: unknown): string {
  if (err instanceof ApiError) {
    if (err.kind === 'notfound') return 'file not found';
    if (err.kind === 'forbidden') return 'file out of scope';
    if (err.kind === 'unauthorized') return 'session expired — reopen from the CLI';
    if (err.kind === 'network') return 'cannot reach the local server';
  }
  return 'could not load file';
}

/** A file is redacted when the server marked spans OR the text carries a
 *  `[REDACTED:*]` placeholder. Either way the editor must stay read-only so a
 *  save can never overwrite the real on-disk secret with the placeholder. */
function isRedacted(file: FileContent): boolean {
  return file.spans.length > 0 || hasRedactionMarks(file.content);
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
      <mark key={i} className="instr__redact" title={`redacted: ${span.id}`}>
        {content.slice(span.start, span.end)}
      </mark>,
    );
    cursor = span.end;
  });
  if (cursor < content.length) nodes.push(content.slice(cursor));
  return nodes;
}

/** One safe preview block → a text-node element. No HTML is ever interpreted;
 *  the tokenizer already stripped structure to plain strings. */
function renderBlock(block: MarkdownBlock, key: number): ReactNode {
  switch (block.kind) {
    case 'heading':
      return (
        <p key={key} className="instr__h" style={{ fontSize: `${1.4 - block.level * 0.1}em` }}>
          {block.text}
        </p>
      );
    case 'code':
      return (
        <pre key={key} className="instr__code mono-data">
          {block.text}
        </pre>
      );
    case 'quote':
      return (
        <p key={key} className="instr__quote">
          {block.text}
        </p>
      );
    case 'list':
      return block.ordered ? (
        <ol key={key} className="instr__list-md">
          {block.items.map((item, i) => (
            <li key={i}>{item}</li>
          ))}
        </ol>
      ) : (
        <ul key={key} className="instr__list-md">
          {block.items.map((item, i) => (
            <li key={i}>{item}</li>
          ))}
        </ul>
      );
    case 'para':
      return (
        <p key={key} className="instr__source">
          {block.text}
        </p>
      );
  }
}

/** Safe markdown preview: light block structure over TEXT nodes only. */
function MarkdownPreview({ content }: { content: string }) {
  const blocks = useMemo(() => tokenizeMarkdown(content), [content]);
  return <div className="instr__preview">{blocks.map((b, i) => renderBlock(b, i))}</div>;
}

/**
 * Instructions editor (rail `07 INSTRUCTIONS`, route `#/instructions`, bead
 * wmc.3). Reads/writes agent instruction files at every scope — project-root and
 * `.claude/` CLAUDE.md / CLAUDE.local.md, plus the multi-runtime AGENTS.md,
 * GEMINI.md, .cursorrules. EDIT/PREVIEW toggle; @import references open in a
 * read-only slide-in.
 *
 * CORRECTNESS GUARD (the redaction-save trap): GET /api/file returns REDACTED
 * content — real secrets are already replaced by visible `[REDACTED:*]` marks.
 * Editing that text and saving it would DESTROY the real secret on disk, so any
 * file flagged redacted (server `spans` or a `[REDACTED:*]` mark) is shown
 * read-only with a clear note. Instruction files rarely hold secrets, so they
 * are normally fully editable. Saves go through the reusable `useWriteFlow`
 * dry-run→diff→commit path (the ONLY write path); nothing is written any other
 * way. All file content is rendered as TEXT NODES — never HTML.
 */
export function Instructions() {
  const { report, getFile } = useAppState();
  const { entries: globalEntries } = useGlobalConfig();
  const flow = useWriteFlow();

  // Every instance file (not just instruction files) — the set an @import is
  // resolved against to decide present vs broken.
  const knownFiles = useMemo(() => {
    const set = new Set<string>();
    for (const agent of report?.agents ?? []) for (const f of agent.files) set.add(f);
    return set;
  }, [report]);

  const instructionFiles = useMemo(() => collectInstructionFiles(report?.agents ?? []), [report]);
  const groups = useMemo(() => groupByScope(instructionFiles), [instructionFiles]);

  // Inherited GLOBAL instruction files (bead 71h.5): absolute root-joined paths.
  // Since 71h.10 they are editable when served unredacted — saves take the same
  // write flow, gated by its global-scope warning. Absent/failed global data ⇒
  // empty lists and the page renders exactly as before.
  const globalFiles = useMemo(() => collectGlobalInstructionFiles(globalEntries), [globalEntries]);
  const globalGroups = useMemo(() => groupGlobalByRoot(globalFiles), [globalFiles]);
  const globalByPath = useMemo(() => new Map(globalFiles.map((f) => [f.path, f])), [globalFiles]);

  const [selected, setSelected] = useState<string | undefined>(undefined);
  const [file, setFile] = useState<FileContent | undefined>(undefined);
  const [draft, setDraft] = useState<string>('');
  const [status, setStatus] = useState<'idle' | 'loading' | 'error'>('idle');
  const [errMsg, setErrMsg] = useState<string>('');
  const [mode, setMode] = useState<Mode>('edit');

  // Import slide-in: the ref being peeked plus its own read-only load state.
  const [peek, setPeek] = useState<ResolvedImport | undefined>(undefined);

  // Load the selected file's redacted content. Mirrors the Artifacts browser:
  // reload on selection change only (a WS-driven report refetch never clobbers
  // an in-progress draft); our own commit reload is handled separately below.
  useEffect(() => {
    if (selected === undefined) {
      setFile(undefined);
      setStatus('idle');
      return;
    }
    let cancelled = false;
    setStatus('loading');
    setFile(undefined);
    setMode('edit');
    getFile(selected)
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
  }, [selected, getFile]);

  // After our own commit lands, reload the file so the draft baseline matches
  // what is now on disk (keeps the save button honestly disabled post-write).
  useEffect(() => {
    if (flow.phase !== 'done' || selected === undefined) return;
    let cancelled = false;
    getFile(selected)
      .then((loaded) => {
        if (cancelled) return;
        setFile(loaded);
        setDraft(loaded.content);
      })
      .catch(() => {
        /* a load failure here is non-fatal; the WriteFlow already confirmed. */
      });
    return () => {
      cancelled = true;
    };
  }, [flow.phase, selected, getFile]);

  const redacted = file ? isRedacted(file) : false;
  // Inherited global file: kept for provenance (badge/note), but since bead
  // 71h.10 it is EDITABLE — the save goes through the same /api/write flow and
  // the WriteFlow global-scope warning. Only redaction forces read-only.
  const inherited = selected !== undefined && globalByPath.has(selected);
  const readOnly = fileReadOnly({ redacted, inherited });
  const dirty = file !== undefined && !readOnly && draft !== file.content;
  const busy = flow.phase === 'loading' || flow.phase === 'committing';

  const imports = useMemo<ResolvedImport[]>(() => {
    // Global files' relative imports resolve against THEIR root, not the
    // project file set — resolving here would only show misleading BROKEN
    // chips, so inherited files render without the imports strip.
    if (!file || selected === undefined || inherited) return [];
    return resolveImports(extractImports(file.content), selected, knownFiles);
  }, [file, selected, knownFiles, inherited]);

  function onSave() {
    if (selected === undefined || !dirty) return;
    flow.begin({ kind: 'file', path: selected, content: draft, label: selected });
  }

  function onOpenImport(ref: ResolvedImport) {
    if (ref.status !== 'present') return;
    setPeek(ref);
  }

  return (
    <main className="layout-main page">
      <section className="page__section">
        <h1 className="title-page">
          INSTRUCTIONS
          <span className="instr__count mono-data">
            {instructionFiles.length + globalFiles.length} FILES
          </span>
        </h1>
      </section>

      <section className="page__section">
        {instructionFiles.length === 0 && globalFiles.length === 0 ? (
          <EmptyState instruction="no instruction files (CLAUDE.md, AGENTS.md, …) in this instance" />
        ) : (
          <div className="instr">
            <div className="instr__list">
              {groups.map((group) => (
                <div key={group.scope} className="instr__group">
                  <span className="instr__group-label micro-label">{group.label}</span>
                  {group.files.map((path) => (
                    <span key={path} {...(path === selected ? { 'aria-current': 'true' } : {})}>
                      <FileChip path={path} onClick={() => setSelected(path)} />
                    </span>
                  ))}
                </div>
              ))}
              {globalGroups.map((group) => (
                <div key={group.root} className="instr__group">
                  <span className="instr__group-label">
                    <SourceBadge scope="global" detail={homeRel(group.root)} />
                  </span>
                  {group.files.map((gf) => (
                    <span
                      key={gf.path}
                      {...(gf.path === selected ? { 'aria-current': 'true' } : {})}
                    >
                      <FileChip path={gf.rel} onClick={() => setSelected(gf.path)} />
                    </span>
                  ))}
                </div>
              ))}
            </div>

            <div className="instr__detail">
              {selected === undefined && (
                <EmptyState title="SELECT" instruction="choose an instruction file to edit" />
              )}
              {selected !== undefined && status === 'loading' && (
                <p className="micro-label">loading {selected}…</p>
              )}
              {selected !== undefined && status === 'error' && (
                <EmptyState title="NO SIGNAL" instruction={errMsg} />
              )}
              {selected !== undefined && status === 'idle' && file && (
                <>
                  <div className="instr__head">
                    <span className="mono-data">{file.path}</span>
                    {inherited ? (
                      <SourceBadge
                        scope="global"
                        detail={homeRel(globalByPath.get(selected)?.root ?? '')}
                        readOnly={redacted}
                      />
                    ) : (
                      <span className="instr__scope micro-label">scope · {file.pathScope}</span>
                    )}
                    {redacted && (
                      <span className="instr__scope micro-label">{file.spans.length} redacted</span>
                    )}
                  </div>

                  <div className="instr__toolbar">
                    <Button
                      label={readOnly ? 'source' : 'edit'}
                      variant={mode === 'edit' ? 'primary' : 'default'}
                      onClick={() => setMode('edit')}
                    />
                    <Button
                      label="preview"
                      variant={mode === 'preview' ? 'primary' : 'default'}
                      onClick={() => setMode('preview')}
                    />
                    <span className="instr__toolbar-spacer" />
                    {!readOnly && (
                      <Button
                        label="save"
                        variant="primary"
                        onClick={onSave}
                        disabled={!dirty || busy}
                      />
                    )}
                  </div>

                  {redacted && (
                    <p className="instr__note micro-label">
                      contains redacted secrets — read-only; edit this file on disk
                    </p>
                  )}
                  {inherited && !redacted && (
                    <p className="instr__note micro-label">
                      inherited · edits apply to all projects on this machine
                    </p>
                  )}

                  {mode === 'edit' &&
                    (readOnly ? (
                      <pre className="instr__source mono-data">
                        {renderRedacted(file.content, file.spans)}
                      </pre>
                    ) : (
                      <textarea
                        className="instr__editor mono-data"
                        value={draft}
                        spellCheck={false}
                        onChange={(e) => setDraft(e.target.value)}
                        aria-label={`edit ${file.path}`}
                      />
                    ))}

                  {mode === 'preview' && (
                    <MarkdownPreview content={readOnly ? file.content : draft} />
                  )}

                  {flow.phase !== 'idle' && <WriteFlow flow={flow} />}

                  {imports.length > 0 && (
                    <div className="instr__imports">
                      <span className="instr__imports-label micro-label">
                        @imports · {imports.length}
                      </span>
                      <div className="instr__import-row">
                        {imports.map((ref, i) =>
                          ref.status === 'present' ? (
                            <FileChip
                              key={`${ref.target}-${i}`}
                              path={`@${ref.target}`}
                              onClick={() => onOpenImport(ref)}
                            />
                          ) : (
                            <span
                              key={`${ref.target}-${i}`}
                              className="chip mono-data instr__import--broken"
                              title={
                                ref.status === 'external'
                                  ? 'outside this instance — cannot open'
                                  : 'not found in this instance'
                              }
                            >
                              @{ref.target}{' '}
                              <span className="instr__import-tag micro-label">
                                {ref.status === 'external' ? 'EXTERNAL' : 'BROKEN'}
                              </span>
                            </span>
                          ),
                        )}
                      </div>
                    </div>
                  )}
                </>
              )}
            </div>
          </div>
        )}
      </section>

      {peek?.resolved !== undefined && (
        <ImportPanel path={peek.resolved} target={peek.target} onClose={() => setPeek(undefined)} />
      )}
    </main>
  );
}

/** Read-only slide-in that peeks an @imported file (same redaction rule). It is
 *  a reference view, not a second editor — to change an imported instruction
 *  file, select it in the main list. */
function ImportPanel({
  path,
  target,
  onClose,
}: {
  path: string;
  target: string;
  onClose: () => void;
}) {
  const { getFile } = useAppState();
  const [file, setFile] = useState<FileContent | undefined>(undefined);
  const [status, setStatus] = useState<'loading' | 'idle' | 'error'>('loading');
  const [errMsg, setErrMsg] = useState<string>('');

  useEffect(() => {
    let cancelled = false;
    setStatus('loading');
    setFile(undefined);
    getFile(path)
      .then((loaded) => {
        if (cancelled) return;
        setFile(loaded);
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

  const redacted = file ? isRedacted(file) : false;

  return (
    <aside className="instr__slide surface" role="dialog" aria-label={`import ${target}`}>
      <div className="instr__slide-head">
        <span className="mono-data">@{target}</span>
        <Button label="close" onClick={onClose} />
      </div>
      {status === 'loading' && <p className="micro-label">loading {path}…</p>}
      {status === 'error' && <EmptyState title="NO SIGNAL" instruction={errMsg} />}
      {status === 'idle' && file && (
        <>
          {redacted && (
            <p className="instr__note micro-label">contains redacted secrets — read-only</p>
          )}
          <pre className="instr__source mono-data">{renderRedacted(file.content, file.spans)}</pre>
        </>
      )}
    </aside>
  );
}
