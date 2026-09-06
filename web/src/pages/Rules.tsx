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
 * (belt-and-braces — see lib isRedactedFile), the editor is READ-ONLY and saving
 * is blocked with a notice. New files from a template are fresh client text with
 * no redaction, so they are always editable.
 *
 * All rule content (globs, description, body) is adversarial: rendered as TEXT
 * nodes only — never markup, never dangerouslySetInnerHTML.
 */

import { useEffect, useMemo, useState, type ReactNode } from 'react';
import {
  AlsoAgents,
  Button,
  Card,
  EmptyRow,
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
import { homeRel } from '../lib/format.js';
import { renderRedacted } from '../lib/redacted.js';
import { useCommitToast } from '../lib/useCommitToast.js';
import { useFileEditor } from '../lib/useFileEditor.js';
import {
  displayNameForKind,
  otherAgentKinds,
  scopedAgents,
  scopeReport,
  sectionApplies,
  useAppState,
  useGlobalConfig,
} from '../state/index.js';
import { WriteFlow, useWriteFlow } from '../write/index.js';
import { RulePreview } from './rules/RulePreview.js';
import {
  collectGlobalRules,
  collectRules,
  groupGlobalRulesByRoot,
  type RuleEntry,
} from './rules/logic.js';
import { STARTER_TEMPLATES, type StarterTemplate } from './rules/templates.js';
import './rules.css';

/** Which pane of an editable rule is showing. */
type Mode = 'preview' | 'edit';

/** What the editor is pointed at: an existing rule, or a new-from-template draft. */
type Selection =
  { kind: 'file'; entry: RuleEntry } | { kind: 'template'; template: StarterTemplate } | undefined;

export function Rules() {
  // Toasts confirm through the shell-level ToastProvider (App.tsx).
  return <RulesPage />;
}

function RulesPage() {
  const { report, getFile, agentScopeKind } = useAppState();
  const { entries: globalDirs } = useGlobalConfig();
  const flow = useWriteFlow();
  const toast = useToast();
  const agentKind = agentScopeKind;

  // Scoped to the ACTIVE agent (bead a6y); each row notes the other detected
  // agents that read the same file via the AlsoAgents badge.
  const entries = useMemo(
    () => collectRules(report ? scopeReport(report, agentKind) : undefined),
    [report, agentKind],
  );
  const claudeRules = entries.filter((e) => e.source === 'claude');
  const cursorRules = entries.filter((e) => e.source === 'cursor');

  // Inherited GLOBAL rules (bead 71h.5): absolute root-joined paths. Since
  // 71h.10 they are editable when served unredacted — saves take the same
  // write flow, gated by its global-scope warning. Absent/failed global data ⇒
  // empty lists and the page renders exactly as before.
  const scopedGlobalDirs = useMemo(
    () => globalDirs.map((e) => ({ ...e, agents: scopedAgents(e.agents, agentKind) })),
    [globalDirs, agentKind],
  );
  const globalRules = useMemo(() => collectGlobalRules(scopedGlobalDirs), [scopedGlobalDirs]);
  const globalGroups = useMemo(() => groupGlobalRulesByRoot(globalRules), [globalRules]);
  const globalByPath = useMemo(() => new Map(globalRules.map((e) => [e.path, e])), [globalRules]);

  const [selection, setSelection] = useState<Selection>(undefined);
  const [mode, setMode] = useState<Mode>('preview');
  // Template mode only: the new file's path. The loaded-file machine (draft
  // included) lives in useFileEditor below.
  const [newPath, setNewPath] = useState('');

  // Inherited global rule: kept for provenance (badge/notice), but since bead
  // 71h.10 it is EDITABLE — the save goes through the same /api/write flow and
  // the WriteFlow global-scope warning. Only redaction forces read-only.
  const inherited = selection?.kind === 'file' && globalByPath.has(selection.entry.path);

  // The shared single-file load / reload / redaction machine. Template mode
  // passes `path: undefined` so the hook releases the file and LEAVES the draft
  // alone — the template body seeded below is never clobbered.
  const { file, draft, setDraft, status, errMsg, redacted, readOnly, dirty, reload } =
    useFileEditor({
      path: selection?.kind === 'file' ? selection.entry.path : undefined,
      getFile,
      inherited,
    });

  const selKey =
    selection?.kind === 'file'
      ? `file:${selection.entry.path}`
      : selection?.kind === 'template'
        ? `tpl:${selection.template.id}`
        : 'none';

  // On every selection change reset the pane and cancel any in-flight write; in
  // template mode seed the draft + suggested path (useFileEditor owns the draft
  // only for a real file).
  useEffect(() => {
    flow.cancel();
    setMode('preview');
    if (selection?.kind === 'template') {
      setDraft(selection.template.content);
      setNewPath(selection.template.defaultPath);
    }
    // selKey captures the meaningful selection identity; flow.cancel / setDraft are stable.
  }, [selKey]);

  // After our own commit lands, confirm via Toast (§5) and settle the editor: a
  // template save created a new file — close it and let the refetched report
  // list it; a file save reloads so the draft baseline matches disk.
  useCommitToast(flow, toast, {
    onDone: () => {
      if (selection?.kind === 'template') setSelection(undefined);
      else reload();
    },
  });

  // ── Derived editor state ──────────────────────────────────────────────────
  const savePath = selection?.kind === 'template' ? newPath.trim() : selection?.entry.path;
  const busy = flow.phase === 'loading' || flow.phase === 'committing';

  const canSave =
    selection !== undefined &&
    !readOnly &&
    savePath !== undefined &&
    savePath !== '' &&
    !busy &&
    (selection.kind === 'template' || dirty);

  const onSave = () => {
    if (!canSave || savePath === undefined) return;
    flow.begin({ kind: 'file', path: savePath, content: draft, label: `save ${savePath}` });
  };

  const ruleCard = (head: string, list: RuleEntry[], badge: (e: RuleEntry) => ReactNode) => (
    <ListCard head={head} headMeta={String(list.length)}>
      {list.length === 0 && <EmptyRow>No rules here yet.</EmptyRow>}
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

  // The sidebar hides RULES for agents without the concept (bead a6y); this
  // covers deep links with an honest not-applicable state. After all hooks.
  const notApplicable = agentScopeKind !== undefined && !sectionApplies('rules', agentScopeKind);
  if (notApplicable) {
    return (
      <main className="layout-main">
        <div className="page-head">
          <div>
            <h1>Rules</h1>
            <p className="page-sub">Contextual instructions the agent follows.</p>
          </div>
        </div>
        <Notice tone="info">
          <strong>Not applicable to {displayNameForKind(agentScopeKind)}.</strong> Contextual rules
          (.claude/rules/*.md, .cursor/rules/*.mdc) are Claude Code and Cursor surfaces — switch the
          Agent picker to one of those to view or edit them.
        </Notice>
      </main>
    );
  }

  return (
    <main className="layout-main">
      <div className="page-head">
        <div>
          <h1>Rules</h1>
          <p className="page-sub">
            Contextual instructions {agentKind ? displayNameForKind(agentKind) : 'the agent'}{' '}
            follows — {claudeRules.length} Claude · {cursorRules.length} Cursor. Open a rule to
            preview or edit it, or start from a template.
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
          {ruleCard('.CLAUDE/RULES', claudeRules, (e) => (
            <>
              <SourceBadge scope="project" />
              <AlsoAgents kinds={otherAgentKinds(report?.agents ?? [], e.path, agentKind)} />
            </>
          ))}
          {ruleCard('.CURSOR/RULES', cursorRules, (e) => (
            <>
              <SourceBadge scope="project" />
              <AlsoAgents kinds={otherAgentKinds(report?.agents ?? [], e.path, agentKind)} />
            </>
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
        (selection.kind === 'template' || (status === 'idle' && file)) && (
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
                  file && <SourceBadge scope={file.pathScope === 'local' ? 'local' : 'project'} />
                ))}
              <span className="rule-editor-spacer" />
              <Button label="Close" variant="ghost" onClick={() => setSelection(undefined)} />
            </div>

            {redacted && (
              <Notice>
                <strong>
                  Read-only — this file contains {file?.spans.length ?? 0} redacted secret
                  {file && file.spans.length === 1 ? '' : 's'}.
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
              (readOnly && file ? (
                <pre className="mono redact-pre">{renderRedacted(file.content, file.spans)}</pre>
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
