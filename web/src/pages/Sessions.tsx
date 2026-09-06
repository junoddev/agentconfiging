/**
 * Session replay (route `#/sessions`, bead 7yb.3 — SPEC §5 row 13). Browse past
 * sessions from the JSONL history adapters and STEP THROUGH their messages:
 * user / assistant / tool / thinking blocks as distinct cards, subagent
 * (sidechain) entries rendered DISTINCTLY (indented + badged), large sessions
 * PAGINATED, and actively-growing sessions marked with a live pill. A session
 * can be TAGGED (stored in a local server-side sidecar) and EXPORTED to
 * markdown (client-side, from the already-redacted session).
 *
 * Console treatment (opendesign/DESIGN.md): the browse list is a `.ds-table`
 * (mono ids, `.code` path chips, right-aligned numeric columns, muted mono
 * when-column) fed by a `.search` + `.pager`; mutating actions confirm via
 * Toast.
 *
 * ADVERSARIAL CONTENT (SPEC §3): session logs are other people's conversation
 * data and can hold pasted secrets. Redaction is SERVER-SIDE — `getSessionDetail`
 * returns content with every secret already replaced by `[REDACTED:*]` marks, so
 * a raw secret never reaches the browser. Every string here is rendered as a TEXT
 * NODE — never HTML, never eval. `persistedOutputPath` is a reference only; it is
 * shown as text and NEVER fetched or opened.
 *
 * CLIENT SEAM: like Dashboard/Catalog/Marketplace, the shell keeps its ApiClient
 * private, so this page captures the launch token at module load and builds its
 * own client.
 */

import { useEffect, useMemo, useRef, useState } from 'react';
import {
  ApiClient,
  ApiError,
  type ReplayBlock,
  type ReplayMessage,
  type SessionDetail,
  type SessionSummary,
} from '../api/index.js';
import { bootstrapToken } from '../api/token.js';
import {
  Button,
  EmptyState,
  Pager,
  Pill,
  SearchInput,
  Table,
  useToast,
} from '../components/core/index.js';
import {
  blockLabel,
  filterSessions,
  formatDuration,
  formatUsageCost,
  formatUsageTokens,
  formatWhen,
  messageLabel,
  normalizeTag,
  renderSegments,
  sessionToMarkdown,
  shortId,
  usageCostTitle,
} from './sessions/logic.js';
import './sessions.css';

const bootToken = typeof window !== 'undefined' ? bootstrapToken() : undefined;

/** Messages requested per detail page (matches the server default). */
const PAGE = 200;

/** Browse-table rows per pager page. */
const TABLE_PAGE_SIZE = 15;

type LoadStatus = 'loading' | 'ok' | 'error';

function loadError(err: unknown): string {
  if (err instanceof ApiError) {
    if (err.kind === 'unauthorized') return 'Session expired — reopen from the CLI.';
    if (err.kind === 'network') return 'Cannot reach the local server.';
    if (err.kind === 'notfound') return 'Session not found.';
  }
  return 'Could not load sessions.';
}

/** Redacted `text` + `spans` → text nodes with styled `[REDACTED:*]` marks. The
 *  content is already redacted server-side, so no secret is present to leak. */
function RedactedText({ block }: { block: ReplayBlock }) {
  const segments = renderSegments(block.text ?? '', block.spans ?? []);
  return (
    <>
      {segments.map((seg, i) =>
        seg.redacted ? (
          <mark key={i} className="sx__redact" title={`redacted: ${seg.id ?? ''}`}>
            {seg.text}
          </mark>
        ) : (
          <span key={i}>{seg.text}</span>
        ),
      )}
    </>
  );
}

/** One content block, rendered by kind. All content is a text node. */
function BlockCard({ block }: { block: ReplayBlock }) {
  return (
    <div className={`sx__block sx__block--${block.kind}`}>
      <span className="table-header sx__block-kind">{blockLabel(block)}</span>
      {(block.kind === 'text' || block.kind === 'thinking' || block.kind === 'tool_result') && (
        <pre className="mono-data sx__block-body">
          <RedactedText block={block} />
        </pre>
      )}
      {block.kind === 'tool_result' && block.persistedOutputPath !== undefined && (
        <span className="meta sx__spill">spilled → {block.persistedOutputPath}</span>
      )}
      {block.kind === 'unknown' && <span className="meta sx__block-note">unrenderable block</span>}
    </div>
  );
}

function SessionsPage() {
  const toast = useToast();
  const client = useMemo(() => (bootToken ? new ApiClient(bootToken) : undefined), []);

  const [sessions, setSessions] = useState<SessionSummary[]>([]);
  const [listStatus, setListStatus] = useState<LoadStatus>('loading');
  const [listErr, setListErr] = useState('');

  const [query, setQuery] = useState('');
  const [tablePage, setTablePage] = useState(1);

  const [selectedId, setSelectedId] = useState<string | undefined>();
  const [detail, setDetail] = useState<SessionDetail | undefined>();
  const [detailStatus, setDetailStatus] = useState<LoadStatus>('loading');
  const [detailErr, setDetailErr] = useState('');
  const [offset, setOffset] = useState(0);

  const [focus, setFocus] = useState(0);
  const cardRefs = useRef<(HTMLDivElement | null)[]>([]);

  const [tagDraft, setTagDraft] = useState('');

  // ── Browse: load the session list ──────────────────────────────────────────
  useEffect(() => {
    let cancelled = false;
    if (!client) {
      setListStatus('error');
      setListErr('Session token missing.');
      return;
    }
    setListStatus('loading');
    void (async () => {
      try {
        const res = await client.getSessions();
        if (cancelled) return;
        setSessions(res.sessions);
        setListStatus('ok');
      } catch (err) {
        if (cancelled) return;
        setListErr(loadError(err));
        setListStatus('error');
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [client]);

  // ── Detail: load the selected session's current page ────────────────────────
  useEffect(() => {
    let cancelled = false;
    if (!client || selectedId === undefined) return;
    setDetailStatus('loading');
    void (async () => {
      try {
        const res = await client.getSessionDetail(selectedId, { offset, limit: PAGE });
        if (cancelled) return;
        setDetail(res);
        setDetailStatus('ok');
        setFocus(0);
      } catch (err) {
        if (cancelled) return;
        setDetailErr(loadError(err));
        setDetailStatus('error');
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [client, selectedId, offset]);

  // Scroll the focused message card into view as the user steps through.
  useEffect(() => {
    cardRefs.current[focus]?.scrollIntoView({ block: 'nearest' });
  }, [focus]);

  function openSession(id: string) {
    setSelectedId(id);
    setDetail(undefined);
    setOffset(0);
    setTagDraft('');
  }

  const filtered = useMemo(() => filterSessions(sessions, query), [sessions, query]);
  const pageRows = useMemo(
    () => filtered.slice((tablePage - 1) * TABLE_PAGE_SIZE, tablePage * TABLE_PAGE_SIZE),
    [filtered, tablePage],
  );

  const messages = detail?.messages ?? [];
  const total = detail?.messageCount ?? 0;
  const pageStart = detail?.offset ?? 0;
  const canPrevPage = pageStart > 0;
  const canNextPage = pageStart + messages.length < total;

  function step(delta: number) {
    setFocus((f) => Math.min(messages.length - 1, Math.max(0, f + delta)));
  }

  // ── Tags ────────────────────────────────────────────────────────────────────
  async function commitTags(next: string[], confirmation: string) {
    if (!client || selectedId === undefined) return;
    try {
      const res = await client.setSessionTags(selectedId, next);
      setDetail((d) => (d ? { ...d, tags: res.tags } : d));
      setSessions((list) => list.map((s) => (s.id === selectedId ? { ...s, tags: res.tags } : s)));
      toast(confirmation);
    } catch {
      // A failed tag write is non-fatal; leave the UI unchanged.
    }
  }

  function addTag() {
    const tag = normalizeTag(tagDraft);
    if (tag === '' || !detail) return;
    if (detail.tags.includes(tag)) {
      setTagDraft('');
      return;
    }
    void commitTags([...detail.tags, tag], `Tag "${tag}" added`);
    setTagDraft('');
  }

  function removeTag(tag: string) {
    if (!detail) return;
    void commitTags(
      detail.tags.filter((t) => t !== tag),
      `Tag "${tag}" removed`,
    );
  }

  // ── Markdown export (client-side, from the redacted detail) ──────────────────
  async function copyMarkdown() {
    if (!detail) return;
    const md = sessionToMarkdown(detail);
    try {
      await navigator.clipboard.writeText(md);
      toast('Markdown copied to clipboard');
    } catch {
      toast('Clipboard unavailable — use Download');
    }
  }

  function downloadMarkdown() {
    if (!detail) return;
    const md = sessionToMarkdown(detail);
    const blob = new Blob([md], { type: 'text/markdown' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `session-${detail.id}.md`;
    a.click();
    URL.revokeObjectURL(url);
    toast('Markdown downloaded');
  }

  return (
    <main className="layout-main page">
      <section className="page__section">
        <h1 className="title-page">Sessions</h1>
        <p className="page-sub">
          Browse and step through this machine&apos;s recorded sessions — redacted content, subagent
          traffic marked, live sessions pulsing.
        </p>
      </section>

      {listStatus === 'loading' && (
        <section className="page__section">
          <p className="meta">Loading sessions…</p>
        </section>
      )}

      {listStatus === 'error' && (
        <section className="page__section">
          <EmptyState title="No sessions" instruction={listErr} />
        </section>
      )}

      {listStatus === 'ok' && sessions.length === 0 && (
        <section className="page__section">
          <EmptyState title="No sessions" instruction="This machine has no session history yet." />
        </section>
      )}

      {listStatus === 'ok' && sessions.length > 0 && (
        <>
          <section className="page__section">
            <div className="toolbar">
              <SearchInput
                value={query}
                onChange={(v) => {
                  setQuery(v);
                  setTablePage(1);
                }}
                placeholder="Filter by title, id, path, tag…"
              />
              <span className="meta">
                {filtered.length} of {sessions.length}
              </span>
            </div>

            <Table
              headers={['ID', 'Title', 'Path', 'Msgs', 'Tokens', 'Cost', 'Duration', 'When', '']}
            >
              {pageRows.map((s) => (
                <tr
                  key={s.id}
                  className={s.id === selectedId ? 'sess-row sess-row--selected' : 'sess-row'}
                >
                  <td className="mono" title={s.id}>
                    {shortId(s.id)}
                  </td>
                  <td>
                    <span className="sess-title">
                      <span>{s.title !== '' ? s.title : s.id}</span>
                      {s.live && <Pill tone="ok">live</Pill>}
                      {s.tags.map((t) => (
                        <span key={t} className="code">
                          {t}
                        </span>
                      ))}
                    </span>
                  </td>
                  <td className="sess-cwd">
                    {s.cwd !== '' && <span className="code">{s.cwd}</span>}
                  </td>
                  <td className="num-col">{s.messageCount}</td>
                  <td className="num-col">{formatUsageTokens(s.usage)}</td>
                  <td className="num-col" title={usageCostTitle(s.usage)}>
                    {formatUsageCost(s.usage)}
                  </td>
                  <td className="num-col">
                    {formatDuration(s.runtimeMs) !== '' ? formatDuration(s.runtimeMs) : '—'}
                  </td>
                  <td className="mono muted">
                    {formatWhen(s.endedAt ?? s.startedAt) !== ''
                      ? formatWhen(s.endedAt ?? s.startedAt)
                      : '—'}
                  </td>
                  <td>
                    <Button variant="ghost" label="Replay" onClick={() => openSession(s.id)} />
                  </td>
                </tr>
              ))}
              {pageRows.length === 0 && (
                <tr>
                  <td colSpan={9} className="muted">
                    No sessions match &ldquo;{query}&rdquo;.
                  </td>
                </tr>
              )}
            </Table>
            <Pager
              page={tablePage}
              pageSize={TABLE_PAGE_SIZE}
              total={filtered.length}
              onPage={setTablePage}
            />
          </section>

          {/* ── Replay ── */}
          {selectedId !== undefined && (
            <section className="page__section sx__replay">
              {detailStatus === 'loading' ? (
                <p className="meta">Loading session…</p>
              ) : detailStatus === 'error' ? (
                <EmptyState title="No session" instruction={detailErr} />
              ) : detail ? (
                <>
                  <div className="sx__detail-head">
                    <div className="sx__detail-title">
                      <span className="sx__row-title">
                        {detail.title !== '' ? detail.title : detail.id}
                      </span>
                      {detail.live && <Pill tone="ok">live</Pill>}
                    </div>
                    <span className="meta sx__detail-meta">
                      {shortId(detail.id)} · {detail.messageCount} messages
                      {` · ${formatUsageTokens(detail.usage)} tokens`}
                      {` · ${formatUsageCost(detail.usage)} estimated cost`}
                      {detail.cwd !== '' ? ` · ${detail.cwd}` : ''}
                    </span>
                  </div>

                  {/* Tags */}
                  <div className="perm-wrap sx__tags-editor">
                    {detail.tags.map((t) => (
                      <span key={t} className="perm-chip">
                        {t}
                        <button
                          type="button"
                          className="x"
                          aria-label={`remove tag ${t}`}
                          onClick={() => removeTag(t)}
                        >
                          ×
                        </button>
                      </span>
                    ))}
                    <input
                      className="search sx__tag-input"
                      value={tagDraft}
                      placeholder="+ tag"
                      spellCheck={false}
                      aria-label="add a tag"
                      onChange={(e) => setTagDraft(e.target.value)}
                      onKeyDown={(e) => {
                        if (e.key === 'Enter') addTag();
                      }}
                    />
                  </div>

                  {/* Controls: step + pagination + export */}
                  <div className="sx__controls">
                    <div className="sx__step">
                      <Button label="Prev" onClick={() => step(-1)} disabled={focus <= 0} />
                      <span className="meta sx__step-pos">
                        {pageStart + focus + 1} / {total}
                      </span>
                      <Button
                        label="Next"
                        onClick={() => step(1)}
                        disabled={focus >= messages.length - 1}
                      />
                    </div>
                    {(canPrevPage || canNextPage) && (
                      <div className="sx__step">
                        <Button
                          label="Newer"
                          onClick={() => setOffset(Math.max(0, pageStart - PAGE))}
                          disabled={!canPrevPage}
                        />
                        <Button
                          label="Older"
                          onClick={() => setOffset(pageStart + PAGE)}
                          disabled={!canNextPage}
                        />
                      </div>
                    )}
                    <div className="sx__step">
                      <Button label="Copy markdown" onClick={() => void copyMarkdown()} />
                      <Button label="Download markdown" onClick={downloadMarkdown} />
                    </div>
                  </div>

                  {/* Messages */}
                  <div className="sx__messages">
                    {messages.map((m: ReplayMessage, i) => (
                      <div
                        key={m.uuid ?? i}
                        ref={(el) => {
                          cardRefs.current[i] = el;
                        }}
                        className={`sx__msg sx__msg--${m.role}${m.isSidechain ? ' sx__msg--sidechain' : ''}${
                          i === focus ? ' sx__msg--focus' : ''
                        }`}
                      >
                        <div className="sx__msg-head">
                          <span className="table-header sx__msg-role">{messageLabel(m)}</span>
                          {m.model !== undefined && <span className="meta">{m.model}</span>}
                          {formatWhen(m.timestamp) !== '' && (
                            <span className="meta">{formatWhen(m.timestamp)}</span>
                          )}
                        </div>
                        {m.blocks.map((b, bi) => (
                          <BlockCard key={bi} block={b} />
                        ))}
                      </div>
                    ))}
                  </div>
                </>
              ) : null}
            </section>
          )}
        </>
      )}
    </main>
  );
}

export function Sessions() {
  // Toasts confirm through the shell-level ToastProvider (App.tsx).
  return <SessionsPage />;
}
