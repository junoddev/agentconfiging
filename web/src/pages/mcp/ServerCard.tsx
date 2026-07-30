/**
 * ServerRow / ServerDetail — one {@link McpServer} as a Console `.list-row`
 * plus its full-value detail (shown in the shared Dialog). Every value
 * (command, args, url, env/header values) is adversarial config data and is
 * rendered as a TEXT NODE only — never markup. `${VAR}` references are shown
 * literally with a `ref` tag and are NEVER expanded. Edit/remove controls
 * appear only when the owning file is writable (the page withholds them for
 * redacted, global, or cloud sources).
 */

import type { ReactNode } from 'react';
import { Button, ListRow, SourceBadge, type SourceScope } from '../../components/core/index.js';
import { isEnvRef, type McpServer } from './logic.js';

export interface ServerRowProps {
  server: McpServer;
  /** Scope badge for the row (provenance is never implicit). */
  scope: SourceScope;
  /** SourceBadge detail, e.g. the global root. */
  scopeDetail?: string;
  /** Omit both to render a read-only row (redacted / global / cloud). */
  onEdit?: () => void;
  onRemove?: () => void;
  /** Opens the full-value detail dialog (read-only rows keep env/header visibility). */
  onView?: () => void;
  /** True while a write flow is in flight — disables the actions. */
  busy?: boolean;
}

/** The one-line mono summary of how the server runs. */
export function serverSummary(server: McpServer): string {
  if (server.transport === 'stdio') {
    const cmd = server.command ?? '—';
    return server.args && server.args.length > 0 ? `${cmd} ${server.args.join(' ')}` : cmd;
  }
  return server.url ?? '—';
}

/** Trailing meta: transport plus env/header counts (values stay in the detail). */
function metaText(server: McpServer): string {
  const parts: string[] = [server.transport];
  const env = server.env ? Object.keys(server.env).length : 0;
  const headers = server.headers ? Object.keys(server.headers).length : 0;
  if (env > 0) parts.push(`${env} env`);
  if (headers > 0) parts.push(`${headers} header${headers === 1 ? '' : 's'}`);
  return parts.join(' · ');
}

export function ServerRow({
  server,
  scope,
  scopeDetail,
  onEdit,
  onRemove,
  onView,
  busy,
}: ServerRowProps) {
  return (
    <ListRow
      title={<span className="mono">{server.name}</span>}
      badge={<SourceBadge scope={scope} {...(scopeDetail ? { detail: scopeDetail } : {})} />}
      sub={
        <span className="mono" title={serverSummary(server)}>
          {serverSummary(server)}
        </span>
      }
      trailing={
        <>
          <span className="meta">{metaText(server)}</span>
          {onView && <Button label="View" variant="ghost" onClick={onView} disabled={busy} />}
          {onEdit && <Button label="Edit" variant="ghost" onClick={onEdit} disabled={busy} />}
          {onRemove && <Button label="Remove" variant="ghost" onClick={onRemove} disabled={busy} />}
        </>
      }
    />
  );
}

/** Render a `KEY=VALUE` map with `${VAR}` values tagged as refs (never expanded). */
function KeyVals({ label, map }: { label: string; map: Record<string, string> }) {
  const entries = Object.entries(map);
  if (entries.length === 0) return null;
  return (
    <div className="mcp-detail-row">
      <span className="meta">{label}</span>
      <div>
        {entries.map(([k, v]) => (
          <div key={k} className="mono">
            {k}
            <span aria-hidden="true"> = </span>
            {v}
            {isEnvRef(v) && <span className="meta mcp-detail-reftag"> ref · kept literal</span>}
          </div>
        ))}
      </div>
    </div>
  );
}

function DetailRow({ label, children }: { label: string; children: ReactNode }) {
  return (
    <div className="mcp-detail-row">
      <span className="meta">{label}</span>
      <span className="mono">{children}</span>
    </div>
  );
}

/** Full server values for the read-only View dialog (text nodes only). */
export function ServerDetail({ server }: { server: McpServer }) {
  return (
    <div className="mcp-detail">
      <DetailRow label="transport">{server.transport}</DetailRow>
      {server.transport === 'stdio' ? (
        <>
          <DetailRow label="command">{server.command ?? '—'}</DetailRow>
          {server.args && server.args.length > 0 && (
            <DetailRow label="args">{server.args.join(' ')}</DetailRow>
          )}
          {server.env && <KeyVals label="env" map={server.env} />}
        </>
      ) : (
        <>
          <DetailRow label="url">{server.url ?? '—'}</DetailRow>
          {server.headers && <KeyVals label="headers" map={server.headers} />}
        </>
      )}
    </div>
  );
}
