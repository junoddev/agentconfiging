/**
 * Rules editor (#/rules, bead agentconfig-wmc.6; Console conversion 4u1.4).
 *
 * A UNIFIED surface over the instance's contextual rules from BOTH runtimes:
 * `.claude/rules/*.md` (plain markdown, always in context) and Cursor
 * `.cursor/rules/*.mdc` (YAML frontmatter carrying `globs`/`description`/
 * `alwaysApply`). The list is one `.list-card` per source (plus inherited
 * global groups and starter templates); every row carries a scope badge and
 * its mono source path. Opening a rule shows a Card editor below with a
 * preview/edit segmented toggle. Saves go through the reusable useWriteFlow
 * ({kind:'file'}) → diff → commit path — the only write seam — and every
 * committed mutation confirms via Toast.
 *
 * REDACTION-SAVE TRAP (SPEC §3): getFile returns REDACTED content — real secrets
 * are already replaced by visible `[REDACTED:*]` marks. Committing that text
 * back would overwrite the real secret on disk. Rules rarely hold secrets, but
 * when a loaded file carries EITHER a redaction span OR a `[REDACTED:*]` mark
 * (belt-and-braces — see isRedacted), the editor is READ-ONLY and saving is
 * blocked with a notice. New files from a template are fresh client text with
 * no redaction, so they are always editable.
 *
 * All rule content (globs, description, body) is adversarial: rendered as TEXT
 * nodes only — never markup, never dangerouslySetInnerHTML.
 */

import { useEffect, useMemo, useState, type ReactNode } from 'react';
import { ApiError, type FileContent, type RedactionSpan } from '../api/index.js';
import {
  Button,
  Card,
  EmptyState,
  Field,
  Input,
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
import { RulePreview } from './rules/RulePreview.js';
import {
  collectGlobalRules,
  collectRules,
  groupGlobalRulesByRoot,
  isRedacted,
  type RuleEntry,
} from './rules/logic.js';
import { STARTER_TEMPLATES, type StarterTemplate } from './rules/templates.js';
import './rules.css';

/** Which pane of an editable rule is showing. */
type Mode = 'preview' | 'edit';

/** What the editor is pointed at: an existing rule, or a new-from-template draft. */
type Selection =
  { kind: 'file'; entry: RuleEntry } | { kind: 'template'; template: StarterTemplate } | undefined;

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
      <mark key={i} className="redact-mark" title={`redacted: ${span.id}`}>
        {content.slice(span.start, span.end)}
      </mark>,
    );
    cursor = span.end;
  });
  if (cursor < content.length) nodes.push(content.slice(cursor));
  return nodes;
}

export function Rules() {
  // Toasts confirm through the shell-level ToastProvider (App.tsx).
  return <RulesPage />;
}

function RulesPage() {
  const { report, getFile } = useAppState();
  const { entries: globalDirs } = useGlobalConfig();
  const flow = useWriteFlow();
  const toast = useToast();

  const entries = useMemo(() => collectRules(report), [report]);
  const claudeRules = entries.filter((e) => e.source === 'claude');
  const cursorRules = entries.filter((e) => e.source === 'cursor');

  // Inherited GLOBAL rules (bead 71h.5): absolute root-joined paths. Since
  // 71h.10 they are editable when served unredacted — saves take the same
  // write flow, gated by its global-scope warning. Absent/failed global data ⇒
  // empty lists and the page renders exactly as before.
  const globalRules = useMemo(() => collectGlobalRules(globalDirs), [globalDirs]);
  const globalGroups = useMemo(() => groupGlobalRulesByRoot(globalRules), [globalRules]);
  const globalByPath = useMemo(() => new Map(globalRules.map((e) => [e.path, e])), [globalRules]);

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
        /* non-fatal; the toast already confirmed the commit. */
      });
    return () => {
      cancelled = true;
    };
  }, [flow.phase, selKey, getFile]);

  // Every committed mutation confirms via Toast (§5). A template save created a
  // new file — close the editor and let the refetched report list it.
  useEffect(() => {
    if (flow.phase !== 'done') return;
    const label = flow.request?.label;
    toast(label !== undefined ? `Applied — ${label}` : 'Change applied');
    if (selection?.kind === 'template') setSelection(undefined);
    flow.cancel();
    // flow.phase is the trigger; toast + flow.cancel are stable.
  }, [flow.phase]);

  // ── Derived editor state ──────────────────────────────────────────────────
  const redacted =
    selection?.kind === 'file' && loaded !== undefined && isRedacted(loaded.spans, loaded.content);
  // Inherited global rule: kept for provenance (badge/notice), but since bead
  // 71h.10 it is EDITABLE — the save goes through the same /api/write flow and
  // the WriteFlow global-scope warning. Only redaction forces read-only.
  const inherited = selection?.kind === 'file' && globalByPath.has(selection.entry.path);
  const readOnly = fileReadOnly({ redacted, inherited });
  const savePath = selection?.kind === 'template' ? newPath.trim() : selection?.entry.path;
  const busy = flow.phase === 'loading' || flow.phase === 'committing';

  const canSave =
    selection !== undefined &&
    !readOnly &&
    savePath !== undefined &&
    savePath !== '' &&
    !busy &&
    (selection.kind === 'template' || draft !== loaded?.content);

  const onSave = () => {
    if (!canSave || savePath === undefined) return;
    flow.begin({ kind: 'file', path: savePath, content: draft, label: `save ${savePath}` });
  };

  const ruleCard = (head: string, list: RuleEntry[], badge: (e: RuleEntry) => ReactNode) => (
    <ListCard head={head} headMeta={String(list.length)}>
      {list.length === 0 && <div className="list-row muted">No rules here yet.</div>}
      {list.map((entry) => (
        <ListRow
          key={entry.path}
          title={<span className="mono">{entry.name}</span>}
          badge={badge(entry)}
          sub={<span className="mono">{entry.path}</span>}
          trailing={
            <Button
              label="Open"
              variant="ghost"
              onClick={() => setSelection({ kind: 'file', entry })}
            />
          }
        />
      ))}
    </ListCard>
  );

  return (
    <main className="layout-main">
      <div className="page-head">
        <div>
          <h1>Rules</h1>
          <p className="page-sub">
            Contextual instructions the agent follows — {claudeRules.length} Claude ·{' '}
            {cursorRules.length} Cursor. Open a rule to preview or edit it, or start from a
            template.
          </p>
        </div>
      </div>

      {entries.length === 0 && globalRules.length === 0 && (
        <EmptyState
          title="No rules yet"
          instruction="No contextual rules detected in this instance. Start from a template below."
        />
      )}

      {(entries.length > 0 || globalRules.length > 0) && (
        <>
          {ruleCard('.CLAUDE/RULES', claudeRules, () => (
            <SourceBadge scope="project" />
          ))}
          {ruleCard('.CURSOR/RULES', cursorRules, () => (
            <SourceBadge scope="project" />
          ))}
        </>
      )}
      {globalGroups.map((group) =>
        ruleCard(`GLOBAL · ${homeRel(group.root)}`, group.rules, () => (
          <SourceBadge scope="global" detail={homeRel(group.root)} />
        )),
      )}

      <ListCard head="TEMPLATES" headMeta={String(STARTER_TEMPLATES.length)}>
        {STARTER_TEMPLATES.map((template) => (
          <ListRow
            key={template.id}
            title={template.label}
            sub={<span className="mono">{template.defaultPath}</span>}
            trailing={
              <Button
                label="Use"
                variant="ghost"
                onClick={() => setSelection({ kind: 'template', template })}
              />
            }
          />
        ))}
      </ListCard>

      {selection?.kind === 'file' && status === 'loading' && (
        <p className="meta">loading {selection.entry.path} …</p>
      )}
      {selection?.kind === 'file' && status === 'error' && (
        <EmptyState title="File unavailable" instruction={errMsg} />
      )}

      {selection !== undefined &&
        (selection.kind === 'template' || (status === 'idle' && loaded)) && (
          <Card>
            <div className="rule-editor-head">
              {selection.kind === 'template' ? (
                <Field label="New rule path" htmlFor="rule-path">
                  <Input
                    id="rule-path"
                    className="mono"
                    value={newPath}
                    spellCheck={false}
                    onChange={(e) => setNewPath(e.target.value)}
                  />
                </Field>
              ) : (
                <span className="mono">{selection.entry.path}</span>
              )}
              {selection.kind === 'file' &&
                (inherited ? (
                  <SourceBadge
                    scope="global"
                    detail={homeRel(globalByPath.get(selection.entry.path)?.root ?? '')}
                    readOnly={redacted}
                  />
                ) : (
                  loaded && (
                    <SourceBadge scope={loaded.pathScope === 'local' ? 'local' : 'project'} />
                  )
                ))}
              <span className="rule-editor-spacer" />
              <Button label="Close" variant="ghost" onClick={() => setSelection(undefined)} />
            </div>

            {redacted && (
              <Notice>
                <strong>
                  Read-only — this file contains {loaded?.spans.length ?? 0} redacted secret
                  {loaded && loaded.spans.length === 1 ? '' : 's'}.
                </strong>{' '}
                Saving would overwrite the real value with the placeholder.
              </Notice>
            )}
            {inherited && !redacted && (
              <Notice tone="info">
                <strong>Inherited.</strong> Edits apply to all projects on this machine.
              </Notice>
            )}

            <div className="rule-editor-toolbar">
              <SegmentedControl
                options={['preview', 'edit'] as const}
                value={mode}
                onChange={(v) => setMode(v as Mode)}
                label="Editor pane"
              />
              {!readOnly && (
                <Button label="Save" variant="primary" onClick={onSave} disabled={!canSave} />
              )}
            </div>

            {mode === 'preview' && <RulePreview content={draft} />}

            {mode === 'edit' &&
              (readOnly && loaded ? (
                <pre className="mono redact-pre">
                  {renderRedacted(loaded.content, loaded.spans)}
                </pre>
              ) : (
                <textarea
                  className="input mono rule-editor-raw"
                  value={draft}
                  spellCheck={false}
                  onChange={(e) => setDraft(e.target.value)}
                  aria-label="raw rule editor"
                />
              ))}

            <WriteFlow flow={flow} />
          </Card>
        )}
    </main>
  );
}
