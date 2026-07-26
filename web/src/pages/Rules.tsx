/**
 * Rules editor (rail `10 RULES`, route `#/rules`, bead agentconfig-wmc.6).
 *
 * A UNIFIED surface over the instance's contextual rules from BOTH runtimes:
 * `.claude/rules/*.md` (plain markdown, always in context) and Cursor
 * `.cursor/rules/*.mdc` (YAML frontmatter carrying `globs`/`description`/
 * `alwaysApply`). The list is derived from the report (agents[].files); each
 * rule shows its PATH FILTERS as badges, its description, and a rendered
 * markdown preview. Saves go through the reusable useWriteFlow ({kind:'file'})
 * → diff → commit path — the only write seam. Starter templates prefill a
 * new-rule create.
 *
 * REDACTION-SAVE TRAP (SPEC §3): getFile returns REDACTED content — real secrets
 * are already replaced by visible `[REDACTED:*]` marks. Committing that text
 * back would overwrite the real secret on disk with the placeholder. Rules
 * rarely hold secrets, but when a loaded file carries EITHER a redaction span
 * OR a `[REDACTED:*]` mark (belt-and-braces — see isRedacted), the editor is
 * READ-ONLY and saving is blocked with a note. New files from a template are
 * fresh client text with no redaction, so they are always editable.
 *
 * All rule content (globs, description, body) is adversarial: rendered as TEXT
 * nodes only — never markup, never dangerouslySetInnerHTML.
 */

import { useEffect, useMemo, useState, type ReactNode } from 'react';
import { ApiError, type FileContent, type RedactionSpan } from '../api/index.js';
import { Button, EmptyState, FileChip } from '../components/core/index.js';
import { useAppState } from '../state/index.js';
import { WriteFlow, useWriteFlow } from '../write/index.js';
import { RulePreview } from './rules/RulePreview.js';
import { collectRules, isRedacted, type RuleEntry, type RuleSource } from './rules/logic.js';
import { STARTER_TEMPLATES, type StarterTemplate } from './rules/templates.js';
import './rules.css';

/** Which pane of an editable rule is showing. */
type Mode = 'edit' | 'preview';

/** What the editor is pointed at: an existing rule, or a new-from-template draft. */
type Selection =
  { kind: 'file'; entry: RuleEntry } | { kind: 'template'; template: StarterTemplate } | undefined;

const SOURCE_LABEL: Record<RuleSource, string> = {
  claude: '.CLAUDE/RULES',
  cursor: '.CURSOR/RULES',
};

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
      <mark key={i} className="rules__redact-mark" title={`redacted: ${span.id}`}>
        {content.slice(span.start, span.end)}
      </mark>,
    );
    cursor = span.end;
  });
  if (cursor < content.length) nodes.push(content.slice(cursor));
  return nodes;
}

export function Rules() {
  const { report, getFile } = useAppState();
  const flow = useWriteFlow();

  const entries = useMemo(() => collectRules(report), [report]);
  const claudeRules = entries.filter((e) => e.source === 'claude');
  const cursorRules = entries.filter((e) => e.source === 'cursor');

  const [selection, setSelection] = useState<Selection>(undefined);
  const [mode, setMode] = useState<Mode>('preview');

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
    setMode('preview');
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

  // After our own commit lands, reload so the draft baseline matches disk
  // (keeps the save button honestly disabled post-write).
  useEffect(() => {
    if (flow.phase !== 'done' || selection?.kind !== 'file') return;
    let cancelled = false;
    getFile(selection.entry.path)
      .then((file) => {
        if (cancelled) return;
        setLoaded(file);
        setDraft(file.content);
      })
      .catch(() => {
        /* non-fatal; the WriteFlow already confirmed the commit. */
      });
    return () => {
      cancelled = true;
    };
  }, [flow.phase, selKey, getFile]);

  // ── Derived editor state ──────────────────────────────────────────────────
  const redacted =
    selection?.kind === 'file' && loaded !== undefined && isRedacted(loaded.spans, loaded.content);
  const savePath = selection?.kind === 'template' ? newPath.trim() : selection?.entry.path;
  const busy = flow.phase === 'loading' || flow.phase === 'committing';

  const canSave =
    selection !== undefined &&
    !redacted &&
    savePath !== undefined &&
    savePath !== '' &&
    !busy &&
    (selection.kind === 'template' || draft !== loaded?.content);

  const onSave = () => {
    if (!canSave || savePath === undefined) return;
    flow.begin({ kind: 'file', path: savePath, content: draft, label: savePath });
  };

  const renderList = (label: string, list: RuleEntry[]) => (
    <div className="rules__group">
      <span className="micro-label rules__group-label">{label}</span>
      {list.length === 0 && <p className="micro-label rules__none">none</p>}
      {list.map((entry) => (
        <span
          key={entry.path}
          {...(selection?.kind === 'file' && selection.entry.path === entry.path
            ? { 'aria-current': 'true' }
            : {})}
        >
          <FileChip path={entry.name} onClick={() => setSelection({ kind: 'file', entry })} />
        </span>
      ))}
    </div>
  );

  return (
    <main className="layout-main page">
      <section className="page__section">
        <h1 className="title-page">
          RULES
          <span className="rules__count mono-data">
            {claudeRules.length} CLAUDE · {cursorRules.length} CURSOR
          </span>
        </h1>
      </section>

      <section className="page__section">
        <div className="rules">
          <div className="rules__list">
            {entries.length === 0 && (
              <p className="micro-label rules__none">
                no contextual rules detected — start from a template
              </p>
            )}
            {renderList(SOURCE_LABEL.claude, claudeRules)}
            {renderList(SOURCE_LABEL.cursor, cursorRules)}

            <div className="rules__group">
              <span className="micro-label rules__group-label">TEMPLATES</span>
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
          </div>

          <div className="rules__editor">
            {selection === undefined && (
              <EmptyState
                title="SELECT"
                instruction="choose a rule to view and edit, or start from a template"
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
                  <div className="rules__head">
                    {selection.kind === 'template' ? (
                      <label className="rules__path">
                        <span className="micro-label">new rule path</span>
                        <input
                          className="mono-data rules__path-input"
                          value={newPath}
                          spellCheck={false}
                          onChange={(e) => setNewPath(e.target.value)}
                          aria-label="new rule path"
                        />
                      </label>
                    ) : (
                      <span className="mono-data">{selection.entry.path}</span>
                    )}
                    {loaded && (
                      <span className="rules__scope micro-label">scope · {loaded.pathScope}</span>
                    )}
                  </div>

                  {redacted && (
                    <p className="rules__redact micro-label">
                      read-only — this file contains {loaded?.spans.length ?? 0} redacted secret
                      {loaded && loaded.spans.length === 1 ? '' : 's'}; saving would overwrite the
                      real value with the placeholder
                    </p>
                  )}

                  <div className="rules__toolbar">
                    <Button
                      label="preview"
                      variant={mode === 'preview' ? 'primary' : 'default'}
                      onClick={() => setMode('preview')}
                    />
                    <Button
                      label={redacted ? 'source' : 'edit'}
                      variant={mode === 'edit' ? 'primary' : 'default'}
                      onClick={() => setMode('edit')}
                    />
                    <span className="rules__toolbar-spacer" />
                    {!redacted && (
                      <Button label="save" variant="primary" onClick={onSave} disabled={!canSave} />
                    )}
                  </div>

                  {mode === 'preview' && <RulePreview content={draft} />}

                  {mode === 'edit' &&
                    (redacted && loaded ? (
                      <pre className="rules__source mono-data">
                        {renderRedacted(loaded.content, loaded.spans)}
                      </pre>
                    ) : (
                      <textarea
                        className="mono-data rules__raw"
                        value={draft}
                        spellCheck={false}
                        onChange={(e) => setDraft(e.target.value)}
                        aria-label="raw rule editor"
                      />
                    ))}

                  <WriteFlow flow={flow} />
                </>
              )}
          </div>
        </div>
      </section>
    </main>
  );
}
