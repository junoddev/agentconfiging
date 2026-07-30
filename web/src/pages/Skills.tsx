/**
 * Skills & agents editor (#/skills, Console page, E13.5).
 *
 * A full editor for the instance's SKILL.md and agent .md files. The list is
 * derived from the report (agents[].files); selecting an entry loads its
 * REDACTED content via getFile. The frontmatter is parsed CLIENT-SIDE (a
 * minimal hand-rolled splitter — no yaml dep) into a visual card view, and a
 * connections view graphs which skill/agent references which tool, MCP server,
 * or other agent (this doubles as the config graph). Saves go through the
 * reusable useWriteFlow ({kind:'file'}) → diff → commit path, the only write
 * seam, and confirm via Toast.
 *
 * REDACTION-SAVE TRAP (SPEC §3): getFile returns content with secrets already
 * replaced by visible `[REDACTED:*]` marks. Committing that text back would
 * overwrite the real secret on disk with the placeholder. So when a loaded file
 * carries any redaction span, the editor is READ-ONLY and saving is blocked
 * with a notice. SKILL/agent files rarely hold secrets, so this is the rare
 * case; normally these files are freely editable. New files from a template are
 * fresh client text with no redaction, so they are always editable.
 *
 * All file/frontmatter content is adversarial: rendered as text nodes only,
 * never markup.
 */

import { useEffect, useMemo, useState } from 'react';
import { ApiError, type FileContent } from '../api/index.js';
import {
  Button,
  EmptyState,
  Field,
  FileChip,
  Input,
  Notice,
  SegmentedControl,
  SourceBadge,
  useToast,
  type SourceScope,
} from '../components/core/index.js';
import { fileReadOnly } from '../lib/editable.js';
import { homeRel } from '../lib/format.js';
import { useAppState, useGlobalConfig } from '../state/index.js';
import { WriteFlow, useWriteFlow } from '../write/index.js';
import { ConnectionsGraph } from './skills/ConnectionsGraph.js';
import { FrontmatterCards } from './skills/FrontmatterCards.js';
import { parseFrontmatter, splitFrontmatter } from './skills/frontmatter.js';
import {
  collectEntries,
  collectGlobalEntries,
  deriveGraph,
  toCard,
  type SkillEntry,
} from './skills/logic.js';
import { STARTER_TEMPLATES, type StarterTemplate } from './skills/templates.js';
import './skills.css';

type Tab = 'edit' | 'connections';
type EditorView = 'cards' | 'raw';

const TABS: readonly Tab[] = ['edit', 'connections'];
const EDITOR_VIEWS: readonly EditorView[] = ['cards', 'raw'];

/** What the editor is pointed at: an existing file, or a new-from-template draft. */
type Selection =
  { kind: 'file'; entry: SkillEntry } | { kind: 'template'; template: StarterTemplate } | undefined;

/** Honest one-line error voice per API failure kind (matches Artifacts). */
function errorText(err: unknown): string {
  if (err instanceof ApiError) {
    if (err.kind === 'notfound') return 'file not found';
    if (err.kind === 'forbidden') return 'file out of scope';
    if (err.kind === 'unauthorized') return 'session expired — reopen from the CLI';
    if (err.kind === 'network') return 'cannot reach the local server';
  }
  return 'could not load file';
}

/** Map the server's free-form pathScope onto a badge scope; anything unknown
 *  falls back to plain mono text (never a wrong badge). */
function badgeScope(pathScope: string): SourceScope | undefined {
  return pathScope === 'project' || pathScope === 'global' || pathScope === 'local'
    ? pathScope
    : undefined;
}

/** Parse a document's frontmatter into a display card (frontmatter may be
 *  absent — an empty card falls back to the given name). */
function cardFor(content: string, name: string) {
  const { frontmatter } = splitFrontmatter(content);
  return toCard(parseFrontmatter(frontmatter ?? ''), name);
}

function SkillsBody() {
  const { report, getFile } = useAppState();
  const { entries: globalDirs } = useGlobalConfig();
  const flow = useWriteFlow();
  const toast = useToast();

  const entries = useMemo(() => collectEntries(report), [report]);
  const entriesKey = entries.map((e) => e.path).join('|');
  const skills = entries.filter((e) => e.kind === 'skill');
  const agents = entries.filter((e) => e.kind === 'agent');

  // Inherited GLOBAL skills/agents (bead 71h.5): absolute root-joined paths.
  // Since 71h.10 they are editable when served unredacted — saves take the same
  // write flow, gated by its global-scope warning. They stay EXCLUDED from the
  // connections graph (the graph maps THIS instance's config; the bulk loader
  // stays project-only). Absent global data ⇒ [] and the page is unchanged.
  const globalEntries = useMemo(() => collectGlobalEntries(globalDirs), [globalDirs]);
  const globalByPath = useMemo(
    () => new Map(globalEntries.map((e) => [e.path, e])),
    [globalEntries],
  );

  const [tab, setTab] = useState<Tab>('edit');
  const [selection, setSelection] = useState<Selection>(undefined);
  const [editorView, setEditorView] = useState<EditorView>('cards');

  // Loaded existing-file state (template mode has no server file).
  const [loaded, setLoaded] = useState<FileContent | undefined>();
  const [status, setStatus] = useState<'idle' | 'loading' | 'error'>('idle');
  const [errMsg, setErrMsg] = useState('');

  // The editable draft + (template mode only) the new file's path.
  const [draft, setDraft] = useState('');
  const [newPath, setNewPath] = useState('');

  const selKey =
    selection?.kind === 'file'
      ? `file:${selection.entry.path}`
      : selection?.kind === 'template'
        ? `tpl:${selection.template.id}`
        : 'none';

  // Load / initialize the editor whenever the selection changes.
  useEffect(() => {
    flow.cancel();
    setEditorView('cards');
    if (selection === undefined) {
      setLoaded(undefined);
      setStatus('idle');
      setDraft('');
      return;
    }
    if (selection.kind === 'template') {
      setLoaded(undefined);
      setStatus('idle');
      setDraft(selection.template.content);
      setNewPath(selection.template.defaultPath);
      return;
    }
    let cancelled = false;
    setStatus('loading');
    setLoaded(undefined);
    getFile(selection.entry.path)
      .then((file) => {
        if (cancelled) return;
        setLoaded(file);
        setDraft(file.content);
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
    // selKey captures the meaningful selection identity; flow.cancel is stable.
  }, [selKey, getFile]);

  // §5: every mutating action confirms via Toast — a committed save toasts.
  useEffect(() => {
    if (flow.phase === 'done') toast('Saved');
  }, [flow.phase, toast]);

  // ── Connections graph: bulk-load every entry's file, then derive. ─────────
  const [graphFiles, setGraphFiles] = useState<Map<string, FileContent>>(new Map());
  const [graphLoading, setGraphLoading] = useState(false);

  useEffect(() => {
    if (tab !== 'connections') return;
    let cancelled = false;
    setGraphLoading(true);
    const paths = entriesKey === '' ? [] : entriesKey.split('|');
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
      setGraphFiles(map);
      setGraphLoading(false);
    });
    return () => {
      cancelled = true;
    };
  }, [tab, entriesKey, getFile]);

  const graph = useMemo(() => {
    const cards = entries
      .filter((e) => graphFiles.has(e.path))
      .map((entry) => ({
        entry,
        card: cardFor(graphFiles.get(entry.path)?.content ?? '', entry.name),
      }));
    return deriveGraph(cards);
  }, [entries, graphFiles]);

  // ── Editor derived state ──────────────────────────────────────────────────
  // Spans OR literal [REDACTED:*] marks — belt-and-braces parity with the
  // sibling editors, load-bearing since the 71h.10 global unlock.
  const redacted =
    selection?.kind === 'file' &&
    loaded !== undefined &&
    (loaded.spans.length > 0 || loaded.content.includes('[REDACTED:'));
  // Inherited global file: kept for provenance (badge/notice), but since bead
  // 71h.10 it is EDITABLE — the save goes through the same /api/write flow and
  // the WriteFlow global-scope warning. Only redaction forces read-only.
  const inherited = selection?.kind === 'file' && globalByPath.has(selection.entry.path);
  const readOnly = fileReadOnly({ redacted, inherited });
  const savePath = selection?.kind === 'template' ? newPath.trim() : selection?.entry.path;
  const draftCard = useMemo(
    () => cardFor(draft, selection?.kind === 'file' ? selection.entry.name : 'new'),
    [draft, selection],
  );
  const loadedScope = loaded ? badgeScope(loaded.pathScope) : undefined;

  const canSave =
    selection !== undefined &&
    !readOnly &&
    savePath !== undefined &&
    savePath !== '' &&
    flow.phase !== 'loading' &&
    flow.phase !== 'committing';

  const onSave = () => {
    if (!canSave || savePath === undefined) return;
    flow.begin({ kind: 'file', path: savePath, content: draft, label: savePath });
  };

  return (
    <main className="layout-main page">
      <div className="page-head">
        <div>
          <h1>Skills &amp; agents</h1>
          <p className="page-sub">edit SKILL.md and agent files, or map what each one references</p>
        </div>
        <span className="meta">
          {skills.length} skills · {agents.length} agents
        </span>
      </div>

      <div className="skills__tabs">
        <SegmentedControl
          options={TABS}
          value={tab}
          onChange={(v) => setTab(v === 'connections' ? 'connections' : 'edit')}
          label="Skills view"
        />
      </div>

      {tab === 'connections' ? (
        <section className="page__section">
          {graphLoading && graphFiles.size === 0 ? (
            <p className="meta">building graph…</p>
          ) : (
            <ConnectionsGraph graph={graph} />
          )}
        </section>
      ) : (
        <section className="page__section">
          {entries.length === 0 && globalEntries.length === 0 ? (
            <EmptyState instruction="No skills or agents detected — start from a template below." />
          ) : null}

          <div className="skills">
            <div className="skills__list">
              <div className="table-header skills__group">SKILLS</div>
              {skills.length === 0 && <p className="meta skills__none">none</p>}
              {skills.map((entry) => (
                <span
                  key={entry.path}
                  {...(selection?.kind === 'file' && selection.entry.path === entry.path
                    ? { 'aria-current': 'true' }
                    : {})}
                >
                  <FileChip
                    path={entry.name}
                    onClick={() => setSelection({ kind: 'file', entry })}
                  />
                </span>
              ))}

              <div className="table-header skills__group">AGENTS</div>
              {agents.length === 0 && <p className="meta skills__none">none</p>}
              {agents.map((entry) => (
                <span
                  key={entry.path}
                  {...(selection?.kind === 'file' && selection.entry.path === entry.path
                    ? { 'aria-current': 'true' }
                    : {})}
                >
                  <FileChip
                    path={entry.name}
                    onClick={() => setSelection({ kind: 'file', entry })}
                  />
                </span>
              ))}

              {globalEntries.length > 0 && (
                <>
                  <div className="skills__group">
                    <SourceBadge scope="global" detail={homeRel(globalEntries[0]?.root ?? '')} />
                  </div>
                  {globalEntries.map((entry) => (
                    <span
                      key={entry.path}
                      {...(selection?.kind === 'file' && selection.entry.path === entry.path
                        ? { 'aria-current': 'true' }
                        : {})}
                    >
                      <FileChip
                        path={entry.name}
                        onClick={() => setSelection({ kind: 'file', entry })}
                      />
                    </span>
                  ))}
                </>
              )}

              <div className="table-header skills__group">TEMPLATES</div>
              {STARTER_TEMPLATES.map((template) => (
                <span
                  key={template.id}
                  {...(selection?.kind === 'template' && selection.template.id === template.id
                    ? { 'aria-current': 'true' }
                    : {})}
                >
                  <FileChip
                    path={`+ ${template.label}`}
                    onClick={() => setSelection({ kind: 'template', template })}
                  />
                </span>
              ))}
            </div>

            <div className="card skills__editor">
              {selection === undefined && (
                <EmptyState
                  title="Select"
                  instruction="Choose a skill or agent, or start from a template."
                />
              )}

              {selection?.kind === 'file' && status === 'loading' && (
                <p className="meta">loading {selection.entry.path}…</p>
              )}
              {selection?.kind === 'file' && status === 'error' && (
                <EmptyState title="File unavailable" instruction={errMsg} />
              )}

              {selection !== undefined &&
                (selection.kind === 'template' || (status === 'idle' && loaded)) && (
                  <>
                    <div className="skills__head">
                      {selection.kind === 'template' ? (
                        <div className="skills__path">
                          <Field label="New file path" htmlFor="skills-new-path">
                            <Input
                              id="skills-new-path"
                              className="mono"
                              value={newPath}
                              spellCheck={false}
                              onChange={(e) => setNewPath(e.target.value)}
                            />
                          </Field>
                        </div>
                      ) : (
                        <span className="mono-data skills__path-text">{selection.entry.path}</span>
                      )}
                      {inherited && selection.kind === 'file' ? (
                        <SourceBadge
                          scope="global"
                          detail={homeRel(globalByPath.get(selection.entry.path)?.root ?? '')}
                          readOnly={redacted}
                        />
                      ) : (
                        loaded &&
                        (loadedScope !== undefined ? (
                          <SourceBadge scope={loadedScope} />
                        ) : (
                          <span className="meta">scope · {loaded.pathScope}</span>
                        ))
                      )}
                    </div>

                    {redacted && (
                      <Notice>
                        Read-only — this file contains {loaded?.spans.length} redacted secret
                        {loaded && loaded.spans.length === 1 ? '' : 's'}; saving would overwrite the
                        real value with the placeholder.
                      </Notice>
                    )}
                    {inherited && !redacted && (
                      <Notice tone="info">
                        Inherited — edits apply to all projects on this machine.
                      </Notice>
                    )}

                    <div className="skills__views">
                      <SegmentedControl
                        options={EDITOR_VIEWS}
                        value={editorView}
                        onChange={(v) => setEditorView(v === 'raw' ? 'raw' : 'cards')}
                        label="Editor view"
                      />
                    </div>

                    {editorView === 'cards' ? (
                      <FrontmatterCards card={draftCard} />
                    ) : (
                      <textarea
                        className="mono-data skills__raw"
                        value={draft}
                        readOnly={readOnly}
                        spellCheck={false}
                        onChange={(e) => setDraft(e.target.value)}
                        aria-label="raw file editor"
                      />
                    )}

                    <div className="skills__actions">
                      <Button label="Save" variant="primary" onClick={onSave} disabled={!canSave} />
                    </div>

                    <WriteFlow flow={flow} />
                  </>
                )}
            </div>
          </div>
        </section>
      )}
    </main>
  );
}

export function Skills() {
  // Toasts confirm through the shell-level ToastProvider (App.tsx).
  return <SkillsBody />;
}
