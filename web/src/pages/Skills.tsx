/**
 * Skills & agents editor (rail `08`, route `#/skills`, bead agentconfig-wmc.4).
 *
 * A full editor for the instance's SKILL.md and agent .md files. The list is
 * derived from the report (agents[].files); selecting an entry loads its
 * REDACTED content via getFile. The frontmatter is parsed CLIENT-SIDE (a
 * minimal hand-rolled splitter — no yaml dep) into a visual card view, and a
 * connections view graphs which skill/agent references which tool, MCP server,
 * or other agent (this doubles as the config graph). Saves go through the
 * reusable useWriteFlow ({kind:'file'}) → diff → commit path, the only write
 * seam.
 *
 * REDACTION-SAVE TRAP (SPEC §3): getFile returns content with secrets already
 * replaced by visible `[REDACTED:*]` marks. Committing that text back would
 * overwrite the real secret on disk with the placeholder. So when a loaded file
 * carries any redaction span, the editor is READ-ONLY and saving is blocked
 * with a note. SKILL/agent files rarely hold secrets, so this is the rare case;
 * normally these files are freely editable. New files from a template are fresh
 * client text with no redaction, so they are always editable.
 *
 * All file/frontmatter content is adversarial: rendered as text nodes only,
 * never markup.
 */

import { useEffect, useMemo, useState } from 'react';
import { ApiError, type FileContent } from '../api/index.js';
import { Button, EmptyState, FileChip, SourceBadge } from '../components/core/index.js';
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

/** Parse a document's frontmatter into a display card (frontmatter may be
 *  absent — an empty card falls back to the given name). */
function cardFor(content: string, name: string) {
  const { frontmatter } = splitFrontmatter(content);
  return toCard(parseFrontmatter(frontmatter ?? ''), name);
}

export function Skills() {
  const { report, getFile } = useAppState();
  const { entries: globalDirs } = useGlobalConfig();
  const flow = useWriteFlow();

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
  // Inherited global file: kept for provenance (badge/note), but since bead
  // 71h.10 it is EDITABLE — the save goes through the same /api/write flow and
  // the WriteFlow global-scope warning. Only redaction forces read-only.
  const inherited = selection?.kind === 'file' && globalByPath.has(selection.entry.path);
  const readOnly = fileReadOnly({ redacted, inherited });
  const savePath = selection?.kind === 'template' ? newPath.trim() : selection?.entry.path;
  const draftCard = useMemo(
    () => cardFor(draft, selection?.kind === 'file' ? selection.entry.name : 'new'),
    [draft, selection],
  );

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
      <section className="page__section">
        <h1 className="title-page">
          SKILLS & AGENTS
          <span className="skills__count mono-data">
            {skills.length} SKILLS · {agents.length} AGENTS
          </span>
        </h1>
        <div className="skills__tabs">
          <Button
            label="edit"
            variant={tab === 'edit' ? 'primary' : 'default'}
            onClick={() => setTab('edit')}
          />
          <Button
            label="connections"
            variant={tab === 'connections' ? 'primary' : 'default'}
            onClick={() => setTab('connections')}
          />
        </div>
      </section>

      {tab === 'connections' ? (
        <section className="page__section">
          {graphLoading && graphFiles.size === 0 ? (
            <p className="micro-label">building graph…</p>
          ) : (
            <ConnectionsGraph graph={graph} />
          )}
        </section>
      ) : (
        <section className="page__section">
          {entries.length === 0 && globalEntries.length === 0 ? (
            <EmptyState instruction="no skills or agents detected — start from a template below" />
          ) : null}

          <div className="skills">
            <div className="skills__list">
              <div className="micro-label skills__group">SKILLS</div>
              {skills.length === 0 && <p className="micro-label skills__none">none</p>}
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

              <div className="micro-label skills__group">AGENTS</div>
              {agents.length === 0 && <p className="micro-label skills__none">none</p>}
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
                  <div className="micro-label skills__group">
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

              <div className="micro-label skills__group">TEMPLATES</div>
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

            <div className="skills__editor">
              {selection === undefined && (
                <EmptyState
                  title="SELECT"
                  instruction="choose a skill or agent, or start from a template"
                />
              )}

              {selection?.kind === 'file' && status === 'loading' && (
                <p className="micro-label">loading {selection.entry.path}…</p>
              )}
              {selection?.kind === 'file' && status === 'error' && (
                <EmptyState title="NO SIGNAL" instruction={errMsg} />
              )}

              {selection !== undefined &&
                (selection.kind === 'template' || (status === 'idle' && loaded)) && (
                  <>
                    <div className="skills__head">
                      {selection.kind === 'template' ? (
                        <label className="skills__path">
                          <span className="micro-label">new file path</span>
                          <input
                            className="mono-data skills__path-input"
                            value={newPath}
                            spellCheck={false}
                            onChange={(e) => setNewPath(e.target.value)}
                          />
                        </label>
                      ) : (
                        <span className="mono-data">{selection.entry.path}</span>
                      )}
                      {inherited && selection.kind === 'file' ? (
                        <SourceBadge
                          scope="global"
                          detail={homeRel(globalByPath.get(selection.entry.path)?.root ?? '')}
                          readOnly={redacted}
                        />
                      ) : (
                        loaded && (
                          <span className="skills__scope micro-label">
                            scope · {loaded.pathScope}
                          </span>
                        )
                      )}
                    </div>

                    {redacted && (
                      <p className="skills__redact micro-label">
                        read-only — this file contains {loaded?.spans.length} redacted secret
                        {loaded && loaded.spans.length === 1 ? '' : 's'}; saving would overwrite the
                        real value with the placeholder
                      </p>
                    )}
                    {inherited && !redacted && (
                      <p className="skills__redact micro-label">
                        inherited · edits apply to all projects on this machine
                      </p>
                    )}

                    <div className="skills__views">
                      <Button
                        label="cards"
                        variant={editorView === 'cards' ? 'primary' : 'default'}
                        onClick={() => setEditorView('cards')}
                      />
                      <Button
                        label="raw"
                        variant={editorView === 'raw' ? 'primary' : 'default'}
                        onClick={() => setEditorView('raw')}
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
                      <Button label="save" variant="primary" onClick={onSave} disabled={!canSave} />
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
