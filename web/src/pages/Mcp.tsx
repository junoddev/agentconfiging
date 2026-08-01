/**
 * MCP server manager (#/mcp, bead agentconfig-wmc.8; Console conversion
 * 4u1.4). Lists the `mcpServers` blocks the current instance references —
 * `.mcp.json` at the root plus any settings file that carries one — as one
 * `.list-card` per file, and offers CRUD over them, saving exclusively through
 * the reusable useWriteFlow dry-run-diff → commit path. The add/edit form
 * lives in the shared Dialog; every committed mutation confirms via Toast.
 *
 * DATA SAFETY
 *  - Served file content is REDACTED: secrets become `[REDACTED:*]` marks. A file
 *    that carries any mark is shown READ-ONLY, because writing the placeholder
 *    back would overwrite the real secret on disk. Only mark-free files are
 *    editable. (logic.hasRedactionMarks / see the notice per card.)
 *  - `${VAR}` env/header references are rendered and saved LITERALLY — never
 *    expanded (logic.isEnvRef only labels them).
 *  - All server values are adversarial config data, rendered as text nodes only.
 *
 * Cloud-configured MCPs (read-only) surface only when the data carries them
 * (logic.collectCloudServers); v1 fixtures carry none, so that section is
 * omitted rather than faked.
 *
 * INHERITED GLOBAL MCPs (bead 71h.4): MCP-bearing files from the machine-global
 * report (~/.claude/settings.json, ~/.claude/.mcp.json, …) render in a
 * GLOBAL-badged read-only section mirroring the cloud one — and NEVER an
 * add/edit/remove target. Deliberately UNCHANGED by the 71h.10 global unlock:
 * these files can carry secrets, so global MCP edits wait for the structured
 * server op (bead wmc.11) rather than a whole-file write.
 */

import { useCallback, useEffect, useMemo, useState } from 'react';
import type { FileContent } from '../api/types.js';
import {
  AlsoAgents,
  Button,
  Dialog,
  EmptyRow,
  EmptyState,
  Frame,
  ListCard,
  ListRow,
  Notice,
  Pill,
  useToast,
} from '../components/core/index.js';
import { homeRel } from '../lib/format.js';
import {
  displayNameForKind,
  otherAgentKinds,
  scopedAgents,
  sectionApplies,
  useAppState,
  useGlobalConfig,
} from '../state/index.js';
import { WriteFlow, useWriteFlow } from '../write/index.js';
import { ServerDetail, ServerRow, serverSummary } from './mcp/ServerCard.js';
import { ServerForm } from './mcp/ServerForm.js';
import {
  collectCloudServers,
  collectGlobalMcpCandidates,
  collectMcpCandidates,
  hasRedactionMarks,
  parseMcpFile,
  removeServer,
  serializeMcpDoc,
  upsertServer,
  type McpServer,
} from './mcp/logic.js';
import './mcp.css';

/** One discovered, parsed MCP file. */
interface McpFile {
  path: string;
  scope: string;
  readOnly: boolean;
  parseError: boolean;
  doc: Record<string, unknown> | null;
  servers: McpServer[];
}

/** An in-progress add/edit session against one file. */
interface Draft {
  filePath: string;
  doc: Record<string, unknown>;
  servers: McpServer[];
  mode: 'add' | 'edit';
  editingName?: string;
}

/** A read-only detail peek (shared Dialog). */
interface Peek {
  server: McpServer;
  note?: string;
}

const ROOT_MCP = '.mcp.json';

function isDotMcp(path: string): boolean {
  return (path.split('/').pop() ?? path) === ROOT_MCP;
}

/** Build an McpFile from loaded content; null when it holds nothing relevant. */
function toMcpFile(loaded: FileContent): McpFile | null {
  const parsed = parseMcpFile(loaded.content);
  const dotMcp = isDotMcp(loaded.path);
  if (!parsed.hasBlock && !dotMcp) return null;
  return {
    path: loaded.path,
    scope: loaded.pathScope,
    readOnly: hasRedactionMarks(loaded.content),
    parseError: parsed.parseError,
    doc: parsed.doc,
    servers: parsed.servers,
  };
}

/** A global MCP file: parsed like a project one, plus its home-dir root for the
 *  SourceBadge. Rendered read-only always, regardless of redaction. */
interface GlobalMcpFile extends McpFile {
  root: string;
}

export function Mcp() {
  // Toasts confirm through the shell-level ToastProvider (App.tsx).
  return <McpPage />;
}

function McpPage() {
  const { report, loading, error, getFile, agentScopeKind } = useAppState();
  const { entries: globalEntries } = useGlobalConfig();
  const flow = useWriteFlow();
  const toast = useToast();
  const agentKind = agentScopeKind;

  const [files, setFiles] = useState<McpFile[]>([]);
  const [filesLoading, setFilesLoading] = useState(false);
  const [globalFiles, setGlobalFiles] = useState<GlobalMcpFile[]>([]);
  const [draft, setDraft] = useState<Draft | null>(null);
  const [peek, setPeek] = useState<Peek | null>(null);

  // Scoped to the ACTIVE agent (bead a6y); each file card notes the other
  // detected agents that read the same file via the AlsoAgents badge.
  const candidates = useMemo(
    () => collectMcpCandidates(scopedAgents(report?.agents ?? [], agentKind)),
    [report, agentKind],
  );
  const cloudServers = useMemo(
    () => collectCloudServers(scopedAgents(report?.agents ?? [], agentKind)),
    [report, agentKind],
  );
  const candidateKey = candidates.join(' ');

  const globalCandidates = useMemo(
    () =>
      collectGlobalMcpCandidates(
        globalEntries.map((e) => ({ ...e, agents: scopedAgents(e.agents, agentKind) })),
      ),
    [globalEntries, agentKind],
  );
  const globalKey = globalCandidates.map((c) => c.path).join(' ');

  // Load + parse every candidate file whenever the referenced set changes (incl.
  // after a commit's refetch, so the list stays live). Failed loads are skipped.
  useEffect(() => {
    let cancelled = false;
    if (candidates.length === 0) {
      setFiles([]);
      setFilesLoading(false);
      return;
    }
    setFilesLoading(true);
    void Promise.all(
      candidates.map((path) =>
        getFile(path)
          .then(toMcpFile)
          .catch(() => null),
      ),
    ).then((results) => {
      if (cancelled) return;
      setFiles(results.filter((f): f is McpFile => f !== null));
      setFilesLoading(false);
    });
    return () => {
      cancelled = true;
    };
    // candidateKey captures the candidate set; getFile is stable per session.
  }, [candidateKey, getFile]);

  // Load + parse the machine-global candidate files (bead 71h.4). Same tolerant
  // pattern as the project set: failed loads are skipped. These files are shown
  // READ-ONLY always and never join the editable `files` list.
  useEffect(() => {
    let cancelled = false;
    if (globalCandidates.length === 0) {
      setGlobalFiles([]);
      return;
    }
    void Promise.all(
      globalCandidates.map((candidate) =>
        getFile(candidate.path)
          .then((loaded) => {
            const parsed = toMcpFile(loaded);
            return parsed ? { ...parsed, root: candidate.root } : null;
          })
          .catch(() => null),
      ),
    ).then((results) => {
      if (cancelled) return;
      setGlobalFiles(results.filter((f): f is GlobalMcpFile => f !== null));
    });
    return () => {
      cancelled = true;
    };
    // globalKey captures the candidate set; getFile is stable per session.
  }, [globalKey, getFile]);

  // Every committed mutation confirms via Toast (§5); the dialog closes and the
  // flow resets. The refetch reloads files fresh.
  useEffect(() => {
    if (flow.phase !== 'done') return;
    const label = flow.request?.label;
    toast(label !== undefined ? `Applied — ${label}` : 'Change applied');
    setDraft(null);
    flow.cancel();
    // flow.phase is the trigger; toast + flow.cancel are stable.
  }, [flow.phase]);

  const preview = useCallback(
    (target: Pick<Draft, 'filePath' | 'doc'>, servers: McpServer[], label: string) => {
      const content = serializeMcpDoc(target.doc, servers);
      flow.begin({ kind: 'file', path: target.filePath, content, label });
    },
    [flow],
  );

  const onFormPreview = useCallback(
    (server: McpServer) => {
      if (!draft) return;
      const next =
        draft.mode === 'edit'
          ? upsertServer(draft.servers, server, draft.editingName)
          : upsertServer(draft.servers, server);
      const verb = draft.mode === 'edit' ? 'update' : 'add';
      preview(draft, next, `${verb} ${server.name} in ${draft.filePath}`);
    },
    [draft, preview],
  );

  const onRemove = useCallback(
    (file: McpFile, name: string) => {
      if (file.readOnly || file.doc === null) return;
      preview(
        { filePath: file.path, doc: file.doc },
        removeServer(file.servers, name),
        `remove ${name} from ${file.path}`,
      );
    },
    [preview],
  );

  function startAdd(file: McpFile) {
    if (file.readOnly || file.doc === null) return;
    flow.cancel();
    setDraft({ filePath: file.path, doc: file.doc, servers: file.servers, mode: 'add' });
  }

  function startEdit(file: McpFile, server: McpServer) {
    if (file.readOnly || file.doc === null) return;
    flow.cancel();
    setDraft({
      filePath: file.path,
      doc: file.doc,
      servers: file.servers,
      mode: 'edit',
      editingName: server.name,
    });
  }

  function startNewRootMcp() {
    flow.cancel();
    setDraft({ filePath: ROOT_MCP, doc: {}, servers: [], mode: 'add' });
  }

  /** Page-head "Add server": the writable root .mcp.json when present,
   *  otherwise a fresh one (never a settings file — that stays per-card). */
  function startHeadAdd() {
    const root = files.find((f) => isDotMcp(f.path) && !f.readOnly && f.doc !== null);
    if (root) startAdd(root);
    else startNewRootMcp();
  }

  function cancelDraft() {
    setDraft(null);
    flow.cancel();
  }

  // ── Load gates (mirroring the other config pages) ─────────────────────────
  if (error && !report) {
    return (
      <Frame>
        <EmptyState instruction={error.message} />
      </Frame>
    );
  }
  if (!report) {
    return (
      <Frame>
        <EmptyState
          title="Acquiring"
          instruction={loading ? 'Scanning config …' : 'Awaiting report.'}
        />
      </Frame>
    );
  }

  // The sidebar hides MCP for agents without the concept (bead a6y); this
  // covers deep links with an honest not-applicable state. After all hooks.
  const notApplicable = agentScopeKind !== undefined && !sectionApplies('mcp', agentScopeKind);
  if (notApplicable) {
    return (
      <Frame>
        <div className="page-head">
          <div>
            <h1>MCP servers</h1>
          </div>
        </div>
        <Notice tone="info">
          <strong>Not applicable to {displayNameForKind(agentScopeKind)}.</strong> The MCP server
          files this page edits (.mcp.json, .claude/settings*.json) are Claude Code surfaces —
          switch the Agent picker to Claude Code to view or edit them.
        </Notice>
      </Frame>
    );
  }

  const totalServers = files.reduce((n, f) => n + f.servers.length, 0);
  const draftNames = draft
    ? draft.servers.filter((s) => s.name !== draft.editingName).map((s) => s.name)
    : [];
  const draftInitial =
    draft?.mode === 'edit' ? draft.servers.find((s) => s.name === draft.editingName) : undefined;
  const flowBusy = flow.phase === 'loading' || flow.phase === 'committing';

  return (
    <Frame>
      <div className="page-head">
        <div>
          <h1>MCP servers</h1>
          <p className="page-sub">
            Tool servers available to the agent, with the file each is registered in. {totalServers}{' '}
            server{totalServers === 1 ? '' : 's'} across {files.length} file
            {files.length === 1 ? '' : 's'}.
          </p>
        </div>
        <div>
          <Button label="Add server" variant="primary" onClick={startHeadAdd} />
        </div>
      </div>

      {/* Removals begin from rows, so their diff → commit renders on the page. */}
      {!draft && flow.phase !== 'idle' && <WriteFlow flow={flow} />}

      {filesLoading && files.length === 0 && <p className="meta">loading MCP config …</p>}

      {!filesLoading && files.length === 0 && (
        <EmptyState
          title="No MCP servers"
          instruction="No mcpServers configured in this instance. Add one to register a tool server."
        />
      )}

      {files.map((file) => (
        <div key={file.path}>
          {file.readOnly && (
            <Notice>
              <strong>{file.path} contains redacted secrets.</strong> Editing here is disabled so a
              masked placeholder is never written over a real value.
            </Notice>
          )}
          {file.parseError && (
            <Notice>
              <strong>{file.path} could not be parsed as JSON.</strong> Not editable here.
            </Notice>
          )}
          <ListCard
            head={
              <span title={`scope · ${file.scope}`}>
                {file.path}{' '}
                <AlsoAgents kinds={otherAgentKinds(report.agents, file.path, agentKind)} />
              </span>
            }
            headMeta={
              <span className="lc-actions">
                <span>{file.servers.length}</span>
                {!file.readOnly && file.doc !== null && (
                  <Button label="Add server" variant="ghost" onClick={() => startAdd(file)} />
                )}
              </span>
            }
          >
            {file.servers.length === 0 && !file.parseError && (
              <EmptyRow>No servers in this file.</EmptyRow>
            )}
            {file.servers.map((server) => (
              <ServerRow
                key={server.name}
                server={server}
                scope={file.scope === 'local' ? 'local' : 'project'}
                onView={() => setPeek({ server })}
                busy={flowBusy}
                {...(file.readOnly || file.doc === null
                  ? {}
                  : {
                      onEdit: () => startEdit(file, server),
                      onRemove: () => onRemove(file, server.name),
                    })}
              />
            ))}
          </ListCard>
        </div>
      ))}

      {globalFiles.length > 0 && (
        <>
          <Notice tone="info">
            <strong>Inherited from this machine&apos;s home config — applies here too.</strong>{' '}
            Read-only until structured MCP edits land (wmc.11).
          </Notice>
          {globalFiles.map((file) => (
            <ListCard
              key={file.path}
              head={homeRel(file.path)}
              headMeta={String(file.servers.length)}
            >
              {file.parseError && <EmptyRow>Could not parse JSON — shown as a file only.</EmptyRow>}
              {file.servers.length === 0 && !file.parseError && (
                <EmptyRow>No servers in this file.</EmptyRow>
              )}
              {file.servers.map((server) => (
                <ServerRow
                  key={server.name}
                  server={server}
                  scope="global"
                  scopeDetail={homeRel(file.root)}
                  onView={() => setPeek({ server, note: 'global · read-only' })}
                />
              ))}
            </ListCard>
          ))}
        </>
      )}

      {cloudServers.length > 0 && (
        <>
          <Notice tone="info">
            <strong>Cloud-managed servers are configured outside local files.</strong> Managed by
            the runtime, not editable here.
          </Notice>
          <ListCard head="CLOUD" headMeta={String(cloudServers.length)}>
            {cloudServers.map((server) => (
              <ListRow
                key={server.name}
                title={<span className="mono">{server.name}</span>}
                badge={<Pill tone="off">cloud</Pill>}
                sub={<span className="mono">{serverSummary(server)}</span>}
                trailing={
                  <Button
                    label="View"
                    variant="ghost"
                    onClick={() => setPeek({ server, note: 'cloud-managed' })}
                  />
                }
              />
            ))}
          </ListCard>
        </>
      )}

      {/* Add/edit form + the mandatory dry-run diff, in the shared Dialog. */}
      <Dialog
        open={draft !== null}
        title={draft?.mode === 'edit' ? `Edit ${draft.editingName ?? 'server'}` : 'Add server'}
        onClose={cancelDraft}
      >
        {draft && (
          <ServerForm
            key={`${draft.filePath}:${draft.mode}:${draft.editingName ?? ''}`}
            mode={draft.mode}
            initial={draftInitial}
            existingNames={draftNames}
            onPreview={onFormPreview}
            onCancel={cancelDraft}
          />
        )}
        {draft && flow.phase !== 'idle' && <WriteFlow flow={flow} />}
      </Dialog>

      {/* Read-only full-value peek (env/header values, refs kept literal). */}
      <Dialog
        open={peek !== null}
        title={peek?.server.name ?? ''}
        onClose={() => setPeek(null)}
        footer={<Button label="Close" onClick={() => setPeek(null)} />}
      >
        {peek?.note !== undefined && <p className="meta">{peek.note}</p>}
        {peek && <ServerDetail server={peek.server} />}
      </Dialog>
    </Frame>
  );
}
