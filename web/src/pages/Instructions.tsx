import { useEffect, useMemo, useState, type ReactNode } from 'react';
import {
  AlsoAgents,
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
import { homeRel } from '../lib/format.js';
import { tokenizeMarkdown, type MarkdownBlock } from '../lib/markdown.js';
import { renderRedacted } from '../lib/redacted.js';
import { useCommitToast } from '../lib/useCommitToast.js';
import { useFileEditor } from '../lib/useFileEditor.js';
import {
  displayNameForKind,
  otherAgentKinds,
  scopedAgents,
  useAppState,
  useGlobalConfig,
} from '../state/index.js';
import { WriteFlow, useWriteFlow } from '../write/index.js';
import {
  collectGlobalInstructionFiles,
  collectInstructionFiles,
  extractImports,
  groupByScope,
  groupGlobalByRoot,
  resolveImports,
  type ResolvedImport,
} from './instructions/logic.js';
import './instructions.css';

/** Which pane of an editable file is showing. */
type Mode = 'edit' | 'preview';

/** Which scope badge a project instruction file earns (`*.local.*` = local). */
function fileScope(path: string): 'project' | 'local' {
  return path.includes('.local.') ? 'local' : 'project';
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
  const { report, getFile, agentScopeKind } = useAppState();
  const { entries: globalEntries } = useGlobalConfig();
  const flow = useWriteFlow();
  const toast = useToast();
  const agentKind = agentScopeKind;

  // Every instance file (not just instruction files) — the set an @import is
  // resolved against to decide present vs broken.
  const knownFiles = useMemo(() => {
    const set = new Set<string>();
    for (const agent of report?.agents ?? []) for (const f of agent.files) set.add(f);
    return set;
  }, [report]);

  // Scoped to the ACTIVE agent (bead a6y); each row notes the other detected
  // agents that read the same file via the AlsoAgents badge.
  const instructionFiles = useMemo(
    () => collectInstructionFiles(scopedAgents(report?.agents ?? [], agentKind)),
    [report, agentKind],
  );
  const groups = useMemo(() => groupByScope(instructionFiles), [instructionFiles]);

  // Inherited GLOBAL instruction files (bead 71h.5): absolute root-joined paths.
  // Since 71h.10 they are editable when served unredacted — saves take the same
  // write flow, gated by its global-scope warning. Absent/failed global data ⇒
  // empty lists and the page renders exactly as before. Scoped like the project
  // list: only the active agent's global homes contribute.
  const scopedGlobalEntries = useMemo(
    () => globalEntries.map((e) => ({ ...e, agents: scopedAgents(e.agents, agentKind) })),
    [globalEntries, agentKind],
  );
  const globalFiles = useMemo(
    () => collectGlobalInstructionFiles(scopedGlobalEntries),
    [scopedGlobalEntries],
  );
  const globalGroups = useMemo(() => groupGlobalByRoot(globalFiles), [globalFiles]);
  const globalByPath = useMemo(() => new Map(globalFiles.map((f) => [f.path, f])), [globalFiles]);

  const [selected, setSelected] = useState<string | undefined>(undefined);
  const [mode, setMode] = useState<Mode>('edit');

  // Import peek: the ref being viewed in the shared Dialog.
  const [peek, setPeek] = useState<ResolvedImport | undefined>(undefined);

  // Inherited global file: kept for provenance (badge/notice), but since bead
  // 71h.10 it is EDITABLE — the save goes through the same /api/write flow and
  // the WriteFlow global-scope warning. Only redaction forces read-only.
  const inherited = selected !== undefined && globalByPath.has(selected);

  // Shared single-file editor: load-on-select, redacted/readOnly/dirty
  // derivation, and reload-after-commit. The page keeps its own `mode` and
  // @import navigation on top (below), which the hook does not model.
  const { file, draft, setDraft, status, errMsg, redacted, readOnly, dirty, reload } =
    useFileEditor({ path: selected, getFile, inherited });

  // The hook releases the file on selection change but leaves the pane mode
  // alone; reset it to EDIT on every selection so a new file opens in edit.
  useEffect(() => {
    setMode('edit');
  }, [selected]);

  // Every committed mutation confirms via Toast (§5), reloads the file so the
  // draft baseline matches disk (save stays honestly disabled), then resets.
  useCommitToast(flow, toast, { onDone: reload });

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
            Standing instruction files {agentKind ? displayNameForKind(agentKind) : 'the agent'}{' '}
            reads every session — CLAUDE.md, AGENTS.md and friends. {totalFiles} file
            {totalFiles === 1 ? '' : 's'}, provenance on every row.
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
                  badge={
                    <>
                      <SourceBadge scope={fileScope(path)} />
                      <AlsoAgents kinds={otherAgentKinds(report?.agents ?? [], path, agentKind)} />
                    </>
                  }
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
  const { file, status, errMsg, redacted } = useFileEditor({ path, getFile });

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
