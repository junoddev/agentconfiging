/**
 * ServerCard — read-only display of one {@link McpServer} (bead wmc.8). Every
 * value (command, args, url, env/header values) is adversarial config data and
 * is rendered as a TEXT NODE only — never markup. `${VAR}` references are shown
 * literally with a `ref` tag and are NEVER expanded. Edit/remove controls appear
 * only when the owning file is writable (the page withholds them for redacted or
 * cloud sources).
 */

import { Button } from '../../components/core/index.js';
import { isEnvRef, type McpServer } from './logic.js';

export interface ServerCardProps {
  server: McpServer;
  /** Omit both to render a purely read-only card (redacted / cloud). */
  onEdit?: () => void;
  onRemove?: () => void;
  /** Read-only note (e.g. redaction or cloud reason), shown when actions absent. */
  note?: string;
}

/** Render a `KEY=VALUE` map with `${VAR}` values tagged as refs (never expanded). */
function KeyVals({ label, map }: { label: string; map: Record<string, string> }) {
  const entries = Object.entries(map);
  if (entries.length === 0) return null;
  return (
    <div className="mcp-card__row">
      <span className="micro-label mcp-card__key">{label}</span>
      <div className="mcp-card__vals">
        {entries.map(([k, v]) => (
          <div key={k} className="mono-data mcp-card__kv">
            <span className="mcp-card__envkey">{k}</span>
            <span aria-hidden="true"> = </span>
            <span className={isEnvRef(v) ? 'mcp-card__ref' : undefined}>{v}</span>
            {isEnvRef(v) && <span className="mcp-card__reftag micro-label">ref</span>}
          </div>
        ))}
      </div>
    </div>
  );
}

export function ServerCard({ server, onEdit, onRemove, note }: ServerCardProps) {
  const editable = onEdit !== undefined || onRemove !== undefined;
  return (
    <div className="mcp-card surface">
      <div className="mcp-card__head">
        <span className="mono-data mcp-card__name">{server.name}</span>
        <span className="micro-label mcp-card__transport">{server.transport}</span>
        {editable && (
          <span className="mcp-card__actions">
            {onEdit && <Button label="edit" onClick={onEdit} />}
            {onRemove && <Button label="remove" variant="destructive" onClick={onRemove} />}
          </span>
        )}
      </div>

      {server.transport === 'stdio' ? (
        <>
          <div className="mcp-card__row">
            <span className="micro-label mcp-card__key">command</span>
            <span className="mono-data">{server.command ?? '—'}</span>
          </div>
          {server.args && server.args.length > 0 && (
            <div className="mcp-card__row">
              <span className="micro-label mcp-card__key">args</span>
              <span className="mono-data mcp-card__args">{server.args.join(' ')}</span>
            </div>
          )}
          {server.env && <KeyVals label="env" map={server.env} />}
        </>
      ) : (
        <>
          <div className="mcp-card__row">
            <span className="micro-label mcp-card__key">url</span>
            <span className="mono-data">{server.url ?? '—'}</span>
          </div>
          {server.headers && <KeyVals label="headers" map={server.headers} />}
        </>
      )}

      {note !== undefined && <p className="mcp-card__note micro-label">{note}</p>}
    </div>
  );
}
