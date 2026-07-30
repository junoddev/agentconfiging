import { Fragment, useEffect, useMemo, useState, type ReactNode } from 'react';
import { ApiError, type FileContent, type RedactionSpan } from '../api/index.js';
import {
  EmptyState,
  FileChip,
  Pill,
  SegmentedControl,
  SourceBadge,
  type SourceScope,
} from '../components/core/index.js';
import { homeRel } from '../lib/format.js';
import { useAppState, useGlobalConfig } from '../state/index.js';
import { globalFileGroups } from './artifacts/logic.js';
import './artifacts.css';

/** Which panel of a loaded file is showing. */
type View = 'source' | 'parsed';

const VIEWS: readonly View[] = ['source', 'parsed'];

/** Read the optional `?path=` deep-link once, from the document query string.
 *  It lives in `location.search` (not the route hash) so the committed hash
 *  router keeps matching `#/artifacts` unchanged. */
function initialPath(): string | undefined {
  return new URLSearchParams(window.location.search).get('path') ?? undefined;
}

/** The union of every agent's referenced files, de-duplicated and sorted. The
 *  report carries paths only under `agents[].files`; `stats.fileCount` is a
 *  scan total with no paths, surfaced separately as context. */
function collectFiles(agents: readonly { files: string[] }[]): string[] {
  const set = new Set<string>();
  for (const agent of agents) for (const file of agent.files) set.add(file);
  return [...set].sort((a, b) => a.localeCompare(b));
}

/** Map the server's free-form pathScope onto a badge scope; anything unknown
 *  falls back to plain mono text (never a wrong badge). */
function badgeScope(pathScope: string): SourceScope | undefined {
  return pathScope === 'project' || pathScope === 'global' || pathScope === 'local'
    ? pathScope
    : undefined;
}

/** Turn redacted `content` + its mark `spans` into React nodes: verbatim text
 *  interleaved with styled `[REDACTED:*]` marks. Everything is a TEXT node —
 *  never markup — and the marks are already redacted server-side, so no secret
 *  is present to leak. Spans are trusted to be sorted and non-overlapping (the
 *  server contract); a defensive skip guards a malformed span anyway. */
function renderRedacted(content: string, spans: readonly RedactionSpan[]): ReactNode[] {
  const nodes: ReactNode[] = [];
  let cursor = 0;
  spans.forEach((span, i) => {
    if (span.start < cursor || span.end > content.length) return;
    if (span.start > cursor) nodes.push(content.slice(cursor, span.start));
    nodes.push(
      <mark key={i} className="artifact__redact" title={`redacted: ${span.id}`}>
        {content.slice(span.start, span.end)}
      </mark>,
    );
    cursor = span.end;
  });
  if (cursor < content.length) nodes.push(content.slice(cursor));
  return nodes;
}

/** Honest one-line error voice per API failure kind. */
function errorText(err: unknown): string {
  if (err instanceof ApiError) {
    if (err.kind === 'notfound') return 'file not found';
    if (err.kind === 'forbidden') return 'file out of scope';
    if (err.kind === 'unauthorized') return 'session expired — reopen from the CLI';
    if (err.kind === 'network') return 'cannot reach the local server';
  }
  return 'could not load file';
}

/** Artifacts — the file browser (Console page, E13.5). Left: the instance's
 *  referenced files as `.code` chips, grouped by scope with the GLOBAL groups
 *  badged. Right: the selected file's REDACTED source in a card plus, for JSON,
 *  a normalized structural view derived from the same redacted text. Config
 *  content is adversarial data: rendered as text nodes only, never HTML, and
 *  redaction happens server-side so raw secrets never reach the browser. */
export function Artifacts() {
  const { report, getFile } = useAppState();

  const files = useMemo(() => collectFiles(report?.agents ?? []), [report]);

  // Inherited (machine-global) chip groups (E12): one group per home config
  // dir. Chips select by ABSOLUTE path — the address getFile() serves global
  // files under — and READ-ONLY: no write flow ever sees these paths. Empty
  // entries (absent or failed global load) leave the page exactly as today.
  const { entries } = useGlobalConfig();
  const globalGroups = useMemo(() => globalFileGroups(entries), [entries]);

  const [selected, setSelected] = useState<string | undefined>(initialPath);
  const [file, setFile] = useState<FileContent | undefined>(undefined);
  const [status, setStatus] = useState<'idle' | 'loading' | 'error'>('idle');
  const [errMsg, setErrMsg] = useState<string>('');
  const [view, setView] = useState<View>('source');

  useEffect(() => {
    if (selected === undefined) {
      setFile(undefined);
      setStatus('idle');
      return;
    }
    let cancelled = false;
    setStatus('loading');
    setFile(undefined);
    setView('source');
    getFile(selected)
      .then((loaded) => {
        if (!cancelled) {
          setFile(loaded);
          setStatus('idle');
        }
      })
      .catch((err: unknown) => {
        if (!cancelled) {
          setErrMsg(errorText(err));
          setStatus('error');
        }
      });
    return () => {
      cancelled = true;
    };
  }, [selected, getFile]);

  // Parsed view: a real, safe structural parse of the (already redacted) JSON
  // text — NOT an eval and not a faked parser. `undefined` = not a JSON file;
  // `null` = JSON parse failed; string = pretty-printed structure.
  const parsedJson = useMemo<string | null | undefined>(() => {
    if (!file || !selected?.endsWith('.json')) return undefined;
    try {
      return JSON.stringify(JSON.parse(file.content) as unknown, null, 2);
    } catch {
      return null;
    }
  }, [file, selected]);

  const sourceNodes = useMemo(() => (file ? renderRedacted(file.content, file.spans) : []), [file]);
  const scope = file ? badgeScope(file.pathScope) : undefined;

  return (
    <main className="layout-main page">
      <div className="page-head">
        <div>
          <h1>Artifacts</h1>
          <p className="page-sub">
            every file the detected agents reference — served redacted, shown verbatim
          </p>
        </div>
        <span className="meta">
          {files.length} referenced
          {report ? ` · ${report.stats.fileCount} scanned` : ''}
        </span>
      </div>

      <section className="page__section">
        {files.length === 0 && globalGroups.length === 0 ? (
          <EmptyState instruction="No artifacts referenced by any detected agent." />
        ) : (
          <div className="artifact">
            <div className="artifact__list">
              {/* With global groups present the project chips gain a PROJECT
                  micro-heading so the layers stay visually distinct. */}
              {globalGroups.length > 0 && files.length > 0 && (
                <h2 className="table-header artifact__group-head">PROJECT</h2>
              )}
              {files.map((path) => (
                <span key={path} {...(path === selected ? { 'aria-current': 'true' } : {})}>
                  <FileChip path={path} onClick={() => setSelected(path)} />
                </span>
              ))}
              {globalGroups.map((group) => (
                <Fragment key={group.root}>
                  <h2 className="artifact__group-head">
                    <SourceBadge scope="global" detail={homeRel(group.root)} readOnly />
                  </h2>
                  {group.files.map((file) => (
                    <span
                      key={file.abs}
                      {...(file.abs === selected ? { 'aria-current': 'true' } : {})}
                    >
                      <FileChip path={file.rel} onClick={() => setSelected(file.abs)} />
                    </span>
                  ))}
                </Fragment>
              ))}
            </div>

            <div className="card artifact__detail">
              {selected === undefined && (
                <EmptyState title="Select" instruction="Choose a file to inspect." />
              )}
              {selected !== undefined && status === 'loading' && (
                <p className="meta">loading {selected}…</p>
              )}
              {selected !== undefined && status === 'error' && (
                <EmptyState title="File unavailable" instruction={errMsg} />
              )}
              {selected !== undefined && status === 'idle' && file && (
                <>
                  <div className="artifact__head">
                    <span className="mono-data artifact__path">{file.path}</span>
                    {scope !== undefined ? (
                      <SourceBadge scope={scope} />
                    ) : (
                      <span className="meta">scope · {file.pathScope}</span>
                    )}
                    {file.spans.length > 0 && <Pill tone="warn">{file.spans.length} redacted</Pill>}
                  </div>

                  {typeof parsedJson === 'string' && (
                    <div className="artifact__views">
                      <SegmentedControl
                        options={VIEWS}
                        value={view}
                        onChange={(v) => setView(v === 'parsed' ? 'parsed' : 'source')}
                        label="File view"
                      />
                    </div>
                  )}

                  {view === 'parsed' && typeof parsedJson === 'string' ? (
                    <pre className="artifact__pre mono-data">{parsedJson}</pre>
                  ) : (
                    <pre className="artifact__pre mono-data">{sourceNodes}</pre>
                  )}

                  {view === 'source' && typeof parsedJson !== 'string' && (
                    <p className="artifact__note meta">no parsed view — showing redacted source</p>
                  )}
                </>
              )}
            </div>
          </div>
        )}
      </section>
    </main>
  );
}
