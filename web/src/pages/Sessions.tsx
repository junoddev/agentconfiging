/**
 * Session replay (rail `18 SESSIONS`, route `#/sessions`, bead 7yb.3 — SPEC §5
 * row 13). Browse past sessions from the JSONL history adapters and STEP THROUGH
 * their messages: user / assistant / tool / thinking blocks as distinct cards,
 * subagent (sidechain) entries rendered DISTINCTLY (indented + badged), large
 * sessions PAGINATED, and actively-growing sessions badged with the signal PULSE
 * (LiveDot). A session can be TAGGED (stored in a local server-side sidecar) and
 * EXPORTED to markdown (client-side, from the already-redacted session).
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
import { parseTokenHash } from '../api/token.js';
import { Button, EmptyState } from '../components/core/index.js';
import { LiveDot } from '../components/signal/index.js';
import {
  blockLabel,
  formatDuration,
  formatWhen,
  messageLabel,
  normalizeTag,
  renderSegments,
  sessionToMarkdown,
} from './sessions/logic.js';
import './sessions.css';

const bootToken =
  typeof window !== 'undefined' ? parseTokenHash(window.location.hash).token : undefined;

/** Messages requested per detail page (matches the server default). */
const PAGE = 200;

type LoadStatus = 'loading' | 'ok' | 'error';

function loadError(err: unknown): string {
  if (err instanceof ApiError) {
    if (err.kind === 'unauthorized') return 'session expired — reopen from the CLI';
    if (err.kind === 'network') return 'cannot reach the local server';
    if (err.kind === 'notfound') return 'session not found';
  }
  return 'could not load sessions';
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
      <span className="micro-label sx__block-kind">{blockLabel(block)}</span>
      {(block.kind === 'text' || block.kind === 'thinking' || block.kind === 'tool_result') && (
        <pre className="mono-data sx__block-body">
          <RedactedText block={block} />
        </pre>
      )}
      {block.kind === 'tool_result' && block.persistedOutputPath !== undefined && (
        <span className="micro-label sx__spill">spilled → {block.persistedOutputPath}</span>
      )}
      {block.kind === 'unknown' && (
        <span className="micro-label sx__block-note">unrenderable block</span>
      )}
    </div>
  );
}

export function Sessions() {
  const client = useMemo(() => (bootToken ? new ApiClient(bootToken) : undefined), []);

  const [sessions, setSessions] = useState<SessionSummary[]>([]);
  const [listStatus, setListStatus] = useState<LoadStatus>('loading');
  const [listErr, setListErr] = useState('');

  const [selectedId, setSelectedId] = useState<string | undefined>();
  const [detail, setDetail] = useState<SessionDetail | undefined>();
  const [detailStatus, setDetailStatus] = useState<LoadStatus>('loading');
  const [detailErr, setDetailErr] = useState('');
  const [offset, setOffset] = useState(0);

  const [focus, setFocus] = useState(0);
  const cardRefs = useRef<(HTMLDivElement | null)[]>([]);

  const [tagDraft, setTagDraft] = useState('');
  const [exportNote, setExportNote] = useState('');

  // ── Browse: load the session list ──────────────────────────────────────────
  useEffect(() => {
    let cancelled = false;
    if (!client) {
      setListStatus('error');
      setListErr('session token missing');
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
    setExportNote('');
    setTagDraft('');
  }

  const messages = detail?.messages ?? [];
  const total = detail?.messageCount ?? 0;
  const pageStart = detail?.offset ?? 0;
  const canPrevPage = pageStart > 0;
  const canNextPage = pageStart + messages.length < total;

  function step(delta: number) {
    setFocus((f) => Math.min(messages.length - 1, Math.max(0, f + delta)));
  }

  // ── Tags ────────────────────────────────────────────────────────────────────
  async function commitTags(next: string[]) {
    if (!client || selectedId === undefined) return;
    try {
      const res = await client.setSessionTags(selectedId, next);
      setDetail((d) => (d ? { ...d, tags: res.tags } : d));
      setSessions((list) => list.map((s) => (s.id === selectedId ? { ...s, tags: res.tags } : s)));
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
    void commitTags([...detail.tags, tag]);
    setTagDraft('');
  }

  function removeTag(tag: string) {
    if (!detail) return;
    void commitTags(detail.tags.filter((t) => t !== tag));
  }

  // ── Markdown export (client-side, from the redacted detail) ──────────────────
  async function copyMarkdown() {
    if (!detail) return;
    const md = sessionToMarkdown(detail);
    try {
      await navigator.clipboard.writeText(md);
      setExportNote('copied markdown to clipboard');
    } catch {
      setExportNote('clipboard unavailable — use download');
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
    setExportNote('downloaded markdown');
  }

  return (
    <main className="layout-main page">
      <section className="page__section">
        <h1 className="title-page">SESSIONS</h1>
        <p className="sx__lede micro-label">
          browse and step through this machine&apos;s recorded sessions — redacted content, subagent
          traffic marked, live sessions pulsing
        </p>
      </section>

      {listStatus === 'loading' && (
        <section className="page__section">
          <p className="micro-label sx__acquiring">ACQUIRING SIGNAL</p>
        </section>
      )}

      {listStatus === 'error' && (
        <section className="page__section">
          <EmptyState title="NO SIGNAL" instruction={listErr} />
        </section>
      )}

      {listStatus === 'ok' && sessions.length === 0 && (
        <section className="page__section">
          <EmptyState title="NO SIGNAL" instruction="no session history yet" />
        </section>
      )}

      {listStatus === 'ok' && sessions.length > 0 && (
        <section className="page__section sx__layout">
          {/* ── Browse column ── */}
          <ul className="sx__list" aria-label="Sessions">
            {sessions.map((s) => (
              <li key={s.id}>
                <button
                  type="button"
                  className="sx__row"
                  onClick={() => openSession(s.id)}
                  aria-current={s.id === selectedId ? 'true' : undefined}
                >
                  <span className="sx__row-head">
                    <span className="sx__row-title">{s.title !== '' ? s.title : s.id}</span>
                    {s.live && <LiveDot connected={true} />}
                  </span>
                  {s.cwd !== '' && <span className="mono-data sx__row-cwd">{s.cwd}</span>}
                  <span className="micro-label sx__row-meta">
                    <span>{s.messageCount} msg</span>
                    {formatDuration(s.runtimeMs) !== '' && (
                      <span>{formatDuration(s.runtimeMs)}</span>
                    )}
                    {formatWhen(s.endedAt ?? s.startedAt) !== '' && (
                      <span>{formatWhen(s.endedAt ?? s.startedAt)}</span>
                    )}
                  </span>
                  {s.tags.length > 0 && (
                    <span className="sx__row-tags">
                      {s.tags.map((t) => (
                        <span key={t} className="micro-label sx__tag">
                          {t}
                        </span>
                      ))}
                    </span>
                  )}
                </button>
              </li>
            ))}
          </ul>

          {/* ── Replay column ── */}
          <div className="sx__replay">
            {selectedId === undefined ? (
              <EmptyState instruction="select a session to replay it" />
            ) : detailStatus === 'loading' ? (
              <p className="micro-label sx__acquiring">LOADING SESSION</p>
            ) : detailStatus === 'error' ? (
              <EmptyState title="NO SIGNAL" instruction={detailErr} />
            ) : detail ? (
              <>
                <div className="sx__detail-head">
                  <div className="sx__detail-title">
                    <span className="sx__row-title">
                      {detail.title !== '' ? detail.title : detail.id}
                    </span>
                    {detail.live && <LiveDot connected={true} />}
                  </div>
                  <span className="micro-label sx__detail-meta">
                    {detail.messageCount} messages
                    {detail.cwd !== '' ? ` · ${detail.cwd}` : ''}
                  </span>
                </div>

                {/* Tags */}
                <div className="sx__tags-editor">
                  {detail.tags.map((t) => (
                    <span key={t} className="micro-label sx__tag sx__tag--editable">
                      {t}
                      <button
                        type="button"
                        className="sx__tag-x"
                        aria-label={`remove tag ${t}`}
                        onClick={() => removeTag(t)}
                      >
                        ×
                      </button>
                    </span>
                  ))}
                  <input
                    className="mono-data sx__tag-input"
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
                    <Button label="prev" onClick={() => step(-1)} disabled={focus <= 0} />
                    <span className="mono-data sx__step-pos">
                      {pageStart + focus + 1} / {total}
                    </span>
                    <Button
                      label="next"
                      onClick={() => step(1)}
                      disabled={focus >= messages.length - 1}
                    />
                  </div>
                  {(canPrevPage || canNextPage) && (
                    <div className="sx__page">
                      <Button
                        label="newer"
                        onClick={() => setOffset(Math.max(0, pageStart - PAGE))}
                        disabled={!canPrevPage}
                      />
                      <Button
                        label="older"
                        onClick={() => setOffset(pageStart + PAGE)}
                        disabled={!canNextPage}
                      />
                    </div>
                  )}
                  <div className="sx__export">
                    <Button label="copy md" onClick={() => void copyMarkdown()} />
                    <Button label="download md" onClick={downloadMarkdown} />
                  </div>
                </div>
                {exportNote !== '' && <p className="micro-label sx__export-note">{exportNote}</p>}

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
                        <span className="micro-label sx__msg-role">{messageLabel(m)}</span>
                        {m.model !== undefined && (
                          <span className="micro-label sx__msg-model">{m.model}</span>
                        )}
                        {formatWhen(m.timestamp) !== '' && (
                          <span className="micro-label sx__msg-when">
                            {formatWhen(m.timestamp)}
                          </span>
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
          </div>
        </section>
      )}
    </main>
  );
}
