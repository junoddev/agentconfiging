/**
 * Memory browser & editor (#/memory, bead agentconfig-wmc.7; Console
 * conversion 4u1.4). Browses the instance's memory files — the markdown notes
 * under a `memory/` directory (`.claude/memory/…` and
 * `~/.claude/projects/<slug>/memory/…`) whose frontmatter carries a `type`,
 * `name`, and `description`, with the body holding the fact itself.
 *
 * The list is one `.list-card` of rows: name + scope badge, the description as
 * the muted sub-line, and trailing type meta + a ghost Edit/View. Frontmatter
 * is parsed CLIENT-SIDE (a hand-rolled splitter — no yaml dep; resilient to
 * malformed input). Rows bulk-load their (redacted) content from getFile; the
 * list itself is derived live from the report, so a WS-driven refetch keeps it
 * current.
 *
 * The FIELD EDITOR (type / name / description + the body) and the CREATE flow
 * live in the shared Dialog. Both serialize back to file content and save
 * through the reusable useWriteFlow ({kind:'file'}) → diff → commit path — the
 * ONLY write seam; every committed mutation confirms via Toast.
 *
 * REDACTION-SAVE TRAP (SPEC §3): getFile returns content with secrets already
 * replaced by visible `[REDACTED:*]` marks. A memory note can quote a secret, so
 * a redacted file (server `spans` OR a `[REDACTED:*]` mark — BOTH signals) is
 * shown READ-ONLY; committing the placeholder text would overwrite the real
 * on-disk value. All file / frontmatter content is adversarial and rendered as
 * TEXT NODES only — never markup, never eval.
 */

import { useEffect, useMemo, useState } from 'react';
import { type FileContent } from '../api/index.js';
import {
  AlsoAgents,
  Button,
  Dialog,
  EmptyState,
  Field,
  Input,
  ListCard,
  ListRow,
  Notice,
  Select,
  SourceBadge,
  useToast,
} from '../components/core/index.js';
import { homeRel } from '../lib/format.js';
import { isRedactedFile, renderRedacted } from '../lib/redacted.js';
import { useCommitToast } from '../lib/useCommitToast.js';
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
import {
  buildCard,
  collectGlobalMemoryFiles,
  collectMemoryFiles,
  MEMORY_TYPES,
  parseMemory,
  serializeMemory,
  suggestPath,
  type MemoryCard,
  type MemoryFields,
} from './memory/logic.js';
import './memory.css';

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
  // Toasts confirm through the shell-level ToastProvider (App.tsx).
  return <MemoryPage />;
}

function MemoryPage() {
  const { report, getFile, agentScopeKind } = useAppState();
  const { entries: globalDirs } = useGlobalConfig();
  const flow = useWriteFlow();
  const toast = useToast();
  const agentKind = agentScopeKind;

  // Scoped to the ACTIVE agent (bead a6y); each row notes the other detected
  // agents that read the same file via the AlsoAgents badge.
  const memoryPaths = useMemo(
    () => collectMemoryFiles(report ? scopeReport(report, agentKind) : undefined),
    [report, agentKind],
  );
  // Inherited GLOBAL memory files (bead 71h.5): absolute root-joined paths.
  // Since 71h.10 they are editable when served unredacted — saves take the
  // same write flow, gated by its global-scope warning. A failed global load
  // only drops those rows (the bulk loader already tolerates per-file
  // failures); absent global data ⇒ empty list and the page is unchanged.
  const scopedGlobalDirs = useMemo(
    () => globalDirs.map((e) => ({ ...e, agents: scopedAgents(e.agents, agentKind) })),
    [globalDirs, agentKind],
  );
  const globalFiles = useMemo(() => collectGlobalMemoryFiles(scopedGlobalDirs), [scopedGlobalDirs]);
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

  // Bulk-load every memory file's (redacted) content, then build the rows.
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

  // ── Editor / create state (shared Dialog) ─────────────────────────────────
  const [mode, setMode] = useState<Mode>({ kind: 'browse' });
  const [draft, setDraft] = useState<MemoryFields>(EMPTY_FIELDS);
  const [baseline, setBaseline] = useState<MemoryFields>(EMPTY_FIELDS);
  const [createPath, setCreatePath] = useState('');
  const [pathTouched, setPathTouched] = useState(false);

  const activeFile = mode.kind === 'edit' ? files.get(mode.path) : undefined;
  const redacted = activeFile ? isRedactedFile(activeFile) : false;
  // Inherited global file: kept for provenance (badge), but since bead 71h.10
  // it is EDITABLE — the save goes through the same /api/write flow and the
  // WriteFlow global-scope warning. Only redaction forces read-only.
  const inherited = mode.kind === 'edit' && globalByPath.has(mode.path);
  const readOnly = redacted;

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
      label: `save ${effectivePath}`,
    });
  }

  // Every committed mutation confirms via Toast (§5); the dialog closes and
  // the stamp-keyed reload above refreshes the rows.
  useCommitToast(flow, toast, { onDone: () => setMode({ kind: 'browse' }) });

  const editorOpen = mode.kind === 'edit' || mode.kind === 'create';

  // The sidebar hides MEMORY for agents without the concept (bead a6y); this
  // covers deep links with an honest not-applicable state. After all hooks.
  const notApplicable = agentScopeKind !== undefined && !sectionApplies('memory', agentScopeKind);
  if (notApplicable) {
    return (
      <main className="layout-main">
        <div className="page-head">
          <div>
            <h1>Memory</h1>
            <p className="page-sub">Persistent facts the agent carries between sessions.</p>
          </div>
        </div>
        <Notice tone="info">
          <strong>Not applicable to {displayNameForKind(agentScopeKind)}.</strong> Memory files
          (.claude/memory/*.md) are a Claude Code surface — switch the Agent picker to Claude Code
          to view or edit them.
        </Notice>
      </main>
    );
  }

  return (
    <main className="layout-main">
      <div className="page-head">
        <div>
          <h1>Memory</h1>
          <p className="page-sub">
            Persistent facts {agentKind ? displayNameForKind(agentKind) : 'the agent'} carries
            between sessions — {allPaths.length} file
            {allPaths.length === 1 ? '' : 's'}, frontmatter-typed, provenance on every row.
          </p>
        </div>
        <div>
          <Button label="New memory" variant="primary" onClick={openCreate} />
        </div>
      </div>

      {!editorOpen && flow.phase !== 'idle' && <WriteFlow flow={flow} />}

      {allPaths.length === 0 ? (
        <EmptyState
          title="No memory yet"
          instruction="No memory files in this instance. Create one to capture a persistent fact."
        />
      ) : status === 'loading' && cards.length === 0 ? (
        <p className="meta">loading memory …</p>
      ) : status === 'error' ? (
        <EmptyState title="Memory unavailable" instruction="Could not load memory files." />
      ) : (
        <ListCard head="MEMORY FILES" headMeta={String(cards.length)}>
          {cards.map((card) => {
            const globalRoot = globalByPath.get(card.path);
            return (
              <ListRow
                key={card.path}
                title={<span className="mono">{card.name}</span>}
                badge={
                  globalRoot !== undefined ? (
                    <SourceBadge scope="global" detail={homeRel(globalRoot)} />
                  ) : (
                    <>
                      <SourceBadge scope="project" />
                      <AlsoAgents
                        kinds={otherAgentKinds(report?.agents ?? [], card.path, agentKind)}
                      />
                    </>
                  )
                }
                sub={card.description !== '' ? card.description : card.preview}
                trailing={
                  <>
                    <span className="meta">
                      {card.type === '' ? 'untyped' : card.type}
                      {card.redacted ? ' · redacted' : ''}
                    </span>
                    <Button
                      label={card.redacted ? 'View' : 'Edit'}
                      variant="ghost"
                      onClick={() => openEdit(card.path)}
                    />
                  </>
                }
              />
            );
          })}
        </ListCard>
      )}

      <Dialog
        open={editorOpen}
        title={mode.kind === 'create' ? 'New memory' : 'Edit memory'}
        onClose={closeEditor}
        footer={
          readOnly ? (
            <Button label="Close" onClick={closeEditor} />
          ) : (
            <>
              <Button label="Cancel" onClick={closeEditor} disabled={busy} />
              <Button label="Save" variant="primary" onClick={onSave} disabled={!canSave} />
            </>
          )
        }
      >
        {mode.kind === 'edit' && (
          <p className="meta mem-dialog-path">
            {mode.path}{' '}
            {inherited ? (
              <SourceBadge
                scope="global"
                detail={homeRel(globalByPath.get(mode.path) ?? '')}
                readOnly={redacted}
              />
            ) : (
              activeFile && (
                <SourceBadge scope={activeFile.pathScope === 'local' ? 'local' : 'project'} />
              )
            )}
          </p>
        )}

        {readOnly ? (
          <>
            <Notice>
              <strong>Contains redacted secrets — read-only.</strong> Edit this file on disk; saving
              the placeholder text would overwrite the real values.
            </Notice>
            <pre className="mono redact-pre">
              {activeFile && renderRedacted(activeFile.content, activeFile.spans)}
            </pre>
          </>
        ) : (
          <>
            {mode.kind === 'create' && (
              <Field label="File path" htmlFor="mem-path">
                <Input
                  id="mem-path"
                  className="mono"
                  value={pathTouched ? createPath : suggestPath(draft.name)}
                  spellCheck={false}
                  onChange={(e) => {
                    setPathTouched(true);
                    setCreatePath(e.target.value);
                  }}
                />
              </Field>
            )}

            <Field label="Type" htmlFor="mem-type">
              <Select
                id="mem-type"
                className="mono"
                value={draft.type}
                onChange={(e) => setDraft({ ...draft, type: e.target.value })}
              >
                {/* Preserve an existing off-list type (e.g. the fixtures'
                    `context`) so editing never silently rewrites it. */}
                {draft.type !== '' && !(MEMORY_TYPES as readonly string[]).includes(draft.type) && (
                  <option value={draft.type}>{draft.type}</option>
                )}
                {MEMORY_TYPES.map((t) => (
                  <option key={t} value={t}>
                    {t}
                  </option>
                ))}
              </Select>
            </Field>

            <Field label="Name" htmlFor="mem-name">
              <Input
                id="mem-name"
                className="mono"
                value={draft.name}
                spellCheck={false}
                onChange={(e) => setDraft({ ...draft, name: e.target.value })}
              />
            </Field>

            <Field label="Description" htmlFor="mem-desc">
              <Input
                id="mem-desc"
                value={draft.description}
                onChange={(e) => setDraft({ ...draft, description: e.target.value })}
              />
            </Field>

            <Field label="Fact (body)" htmlFor="mem-body">
              <textarea
                id="mem-body"
                className="input mono mem-body"
                value={draft.body}
                spellCheck={false}
                onChange={(e) => setDraft({ ...draft, body: e.target.value })}
              />
            </Field>
          </>
        )}

        {flow.phase !== 'idle' && <WriteFlow flow={flow} />}
      </Dialog>
    </main>
  );
}
