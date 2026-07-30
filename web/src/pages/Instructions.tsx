import { useEffect, useMemo, useState, type ReactNode } from 'react';
import { ApiError, type FileContent, type RedactionSpan } from '../api/index.js';
import {
  Button,
  Card,
  Dialog,
  EmptyState,
  FileChip,
  ListCard,
  ListRow,
  Notice,
  SegmentedControl,
  SourceBadge,
  useToast,
} from '../components/core/index.js';
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

/** Which scope badge a project instruction file earns (`*.local.*` = local). */
function fileScope(path: string): 'project' | 'local' {
  return path.includes('.local.') ? 'local' : 'project';
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
      <mark key={i} className="redact-mark" title={`redacted: ${span.id}`}>
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
        <p key={key} className="instr-md-h" style={{ fontSize: `${1.4 - block.level * 0.1}em` }}>
          {block.text}
        </p>
      );
    case 'code':
      return (
        <pre key={key} className="instr-md-code mono">
          {block.text}
        </pre>
      );
    case 'quote':
      return (
        <p key={key} className="instr-md-quote">
          {block.text}
        </p>
      );
    case 'list':
      return block.ordered ? (
        <ol key={key} className="instr-md-list">
          {block.items.map((item, i) => (
            <li key={i}>{item}</li>
          ))}
        </ol>
      ) : (
        <ul key={key} className="instr-md-list">
          {block.items.map((item, i) => (
            <li key={i}>{item}</li>
          ))}
        </ul>
      );
    case 'para':
      return (
        <p key={key} className="instr-md-para">
          {block.text}
        </p>
      );
  }
}

/** Safe markdown preview: light block structure over TEXT nodes only. */
function MarkdownPreview({ content }: { content: string }) {
  const blocks = useMemo(() => tokenizeMarkdown(content), [content]);
  return <div className="instr-md">{blocks.map((b, i) => renderBlock(b, i))}</div>;
}

export function Instructions() {
  // Toasts confirm through the shell-level ToastProvider (App.tsx).
  return <InstructionsPage />;
}

/**
 * Instructions editor (#/instructions, bead wmc.3; Console conversion 4u1.4).
 * Reads/writes agent instruction files at every scope — project-root and
 * `.claude/` CLAUDE.md / CLAUDE.local.md, plus the multi-runtime AGENTS.md,
 * GEMINI.md, .cursorrules. The file list is one `.list-card` per scope group
 * with a badge on every row; the editor is a Card with an EDIT/PREVIEW
 * segmented toggle. @import references open read-only in the shared Dialog
 * (which replaced the old ad-hoc role=dialog slide-in). Saves confirm via
 * Toast.
 *
 * CORRECTNESS GUARD (the redaction-save trap): GET /api/file returns REDACTED
 * content — real secrets are already replaced by visible `[REDACTED:*]` marks.
 * Editing that text and saving it would DESTROY the real secret on disk, so any
 * file flagged redacted (server `spans` or a `[REDACTED:*]` mark) is shown
 * read-only with a clear notice. Instruction files rarely hold secrets, so they
 * are normally fully editable. Saves go through the reusable `useWriteFlow`
 * dry-run→diff→commit path (the ONLY write path); nothing is written any other
 * way. All file content is rendered as TEXT NODES — never HTML.
 */
function InstructionsPage() {
  const { report, getFile } = useAppState();
  const { entries: globalEntries } = useGlobalConfig();
  const flow = useWriteFlow();
  const toast = useToast();

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

  // Import peek: the ref being viewed in the shared Dialog.
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
        /* a load failure here is non-fatal; the toast already confirmed. */
      });
    return () => {
      cancelled = true;
    };
  }, [flow.phase, selected, getFile]);

  // Every committed mutation confirms via Toast (§5), then the flow resets.
  useEffect(() => {
    if (flow.phase !== 'done') return;
    const label = flow.request?.label;
    toast(label !== undefined ? `Applied — ${label}` : 'Change applied');
    flow.cancel();
    // flow.phase is the trigger; toast + flow.cancel are stable.
  }, [flow.phase]);

  const redacted = file ? isRedacted(file) : false;
  // Inherited global file: kept for provenance (badge/notice), but since bead
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
    flow.begin({ kind: 'file', path: selected, content: draft, label: `save ${selected}` });
  }

  function onOpenImport(ref: ResolvedImport) {
    if (ref.status !== 'present') return;
    setPeek(ref);
  }

  const totalFiles = instructionFiles.length + globalFiles.length;

  return (
    <main className="layout-main">
      <div className="page-head">
        <div>
          <h1>Instructions</h1>
          <p className="page-sub">
            Standing instruction files the agent reads every session — CLAUDE.md, AGENTS.md and
            friends. {totalFiles} file{totalFiles === 1 ? '' : 's'}, provenance on every row.
          </p>
        </div>
      </div>

      {totalFiles === 0 ? (
        <EmptyState
          title="No instruction files"
          instruction="No instruction files (CLAUDE.md, AGENTS.md, …) in this instance."
        />
      ) : (
        <>
          {groups.map((group) => (
            <ListCard key={group.scope} head={group.label} headMeta={String(group.files.length)}>
              {group.files.map((path) => (
                <ListRow
                  key={path}
                  title={<span className="mono">{path}</span>}
                  badge={<SourceBadge scope={fileScope(path)} />}
                  trailing={
                    <Button label="Open" variant="ghost" onClick={() => setSelected(path)} />
                  }
                />
              ))}
            </ListCard>
          ))}
          {globalGroups.map((group) => (
            <ListCard
              key={group.root}
              head={`GLOBAL · ${homeRel(group.root)}`}
              headMeta={String(group.files.length)}
            >
              {group.files.map((gf) => (
                <ListRow
                  key={gf.path}
                  title={<span className="mono">{gf.rel}</span>}
                  badge={<SourceBadge scope="global" detail={homeRel(group.root)} />}
                  trailing={
                    <Button label="Open" variant="ghost" onClick={() => setSelected(gf.path)} />
                  }
                />
              ))}
            </ListCard>
          ))}
        </>
      )}

      {selected !== undefined && status === 'loading' && (
        <p className="meta">loading {selected} …</p>
      )}
      {selected !== undefined && status === 'error' && (
        <EmptyState title="File unavailable" instruction={errMsg} />
      )}

      {selected !== undefined && status === 'idle' && file && (
        <Card>
          <div className="instr-editor-head">
            <span className="mono">{file.path}</span>
            {inherited ? (
              <SourceBadge
                scope="global"
                detail={homeRel(globalByPath.get(selected)?.root ?? '')}
                readOnly={redacted}
              />
            ) : (
              <SourceBadge scope={fileScope(file.path)} />
            )}
            {redacted && <span className="meta">{file.spans.length} redacted</span>}
            <span className="instr-editor-spacer" />
            <Button label="Close" variant="ghost" onClick={() => setSelected(undefined)} />
          </div>

          {redacted && (
            <Notice>
              <strong>Contains redacted secrets — read-only.</strong> Edit this file on disk; saving
              the placeholder text would overwrite the real values.
            </Notice>
          )}
          {inherited && !redacted && (
            <Notice tone="info">
              <strong>Inherited.</strong> Edits apply to all projects on this machine.
            </Notice>
          )}

          <div className="instr-editor-toolbar">
            <SegmentedControl
              options={['edit', 'preview'] as const}
              value={mode}
              onChange={(v) => setMode(v as Mode)}
              label="Editor pane"
            />
            {!readOnly && (
              <Button label="Save" variant="primary" onClick={onSave} disabled={!dirty || busy} />
            )}
          </div>

          {mode === 'edit' &&
            (readOnly ? (
              <pre className="mono redact-pre">{renderRedacted(file.content, file.spans)}</pre>
            ) : (
              <textarea
                className="input mono instr-editor-raw"
                value={draft}
                spellCheck={false}
                onChange={(e) => setDraft(e.target.value)}
                aria-label={`edit ${file.path}`}
              />
            ))}

          {mode === 'preview' && <MarkdownPreview content={readOnly ? file.content : draft} />}

          {flow.phase !== 'idle' && <WriteFlow flow={flow} />}

          {imports.length > 0 && (
            <div className="instr-imports">
              <span className="meta">@imports · {imports.length}</span>
              <div className="instr-import-row">
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
                      className="code"
                      title={
                        ref.status === 'external'
                          ? 'outside this instance — cannot open'
                          : 'not found in this instance'
                      }
                    >
                      @{ref.target}{' '}
                      <span className="meta">
                        {ref.status === 'external' ? 'external' : 'broken'}
                      </span>
                    </span>
                  ),
                )}
              </div>
            </div>
          )}
        </Card>
      )}

      {/* Read-only peek at an @imported file (same redaction rule) via the
          shared Dialog. It is a reference view, not a second editor — to change
          an imported instruction file, select it in the main list. */}
      <Dialog
        open={peek?.resolved !== undefined}
        title={`@${peek?.target ?? ''}`}
        onClose={() => setPeek(undefined)}
        footer={<Button label="Close" onClick={() => setPeek(undefined)} />}
      >
        {peek?.resolved !== undefined && <ImportPeek path={peek.resolved} />}
      </Dialog>
    </main>
  );
}

/** Dialog body for an @import peek: loads and shows the file read-only. */
function ImportPeek({ path }: { path: string }) {
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
    <>
      {status === 'loading' && <p className="meta">loading {path} …</p>}
      {status === 'error' && <EmptyState title="File unavailable" instruction={errMsg} />}
      {status === 'idle' && file && (
        <>
          {redacted && (
            <Notice>
              <strong>Contains redacted secrets — read-only.</strong>
            </Notice>
          )}
          <pre className="mono redact-pre">{renderRedacted(file.content, file.spans)}</pre>
        </>
      )}
    </>
  );
}
