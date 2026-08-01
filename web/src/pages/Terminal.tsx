/**
 * Embedded terminal page (SPEC §5 row 11, bead ngs.2) — a multi-tab xterm.js
 * surface over the AUTHENTICATED PTY WebSocket. Each tab is one PTY: the token
 * travels as the sole `Sec-WebSocket-Protocol` subprotocol (the SAME channel as
 * the report WS — a handshake carries no Authorization header and the URL
 * fragment never reaches the server), and `?instance=&shell=` select the cwd
 * scope + the validated launch target. The server spawns only a validated choice
 * (the user's $SHELL or a detected runtime's CLI); the bytes on the wire are the
 * user driving their own shell.
 *
 * PERSISTENCE: this component is mounted ONCE at the app shell (App.tsx) and
 * merely hidden when another route is active, so tabs — and their live PTYs —
 * survive navigation without any server-side session resurrection. Closing a tab
 * closes its WS, which the server treats as the signal to kill that PTY.
 *
 * UNAVAILABLE: when the server was launched in daemon mode or node-pty is not
 * installed, GET /api/pty/status reports `available:false` and this page renders
 * a clear unavailable state — the rest of the app is unaffected.
 */

import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { Terminal as XTerm } from '@xterm/xterm';
import { FitAddon } from '@xterm/addon-fit';
import '@xterm/xterm/css/xterm.css';
import { ApiClient } from '../api/client.js';
import { bootstrapToken } from '../api/token.js';
import type { PtyStatusResponse, ShellChoice } from '../api/types.js';
import { Button, EmptyState, Notice, Select } from '../components/core/index.js';
import { useAppState } from '../state/index.js';
import { resolveExplicitOperateTarget, type NavigationTarget } from '../navigation.js';
import { routeHash } from '../routes.js';
import {
  buildPtyWsUrl,
  encodeInput,
  encodeResize,
  nextActiveAfterClose,
  nextTabId,
  parseServerMessage,
  tabTitle,
  xtermTheme,
  type ConsoleTheme,
  type ConsoleTokenColors,
  type TerminalTab,
  type TerminalTheme,
} from './terminal/logic.js';
import './terminal.css';

/** The raw session token — read once at module load, BEFORE the app strips the
 *  fragment (mirrors the search page). Undefined when launched without a token. */
const bootToken = typeof window !== 'undefined' ? bootstrapToken() : undefined;

/** Normalize one CSS color value (oklch tokens included) to a form xterm can
 *  parse, via canvas fillStyle round-tripping. Undefined when the value is
 *  empty/unparsable or canvas is unavailable (jsdom). */
function resolveCssColor(raw: string): string | undefined {
  if (raw === '') return undefined;
  const ctx = document.createElement('canvas').getContext('2d');
  if (!ctx) return undefined;
  const sentinel = '#010203';
  ctx.fillStyle = sentinel;
  ctx.fillStyle = raw;
  const normalized = ctx.fillStyle;
  // An unparsable value leaves the sentinel in place.
  if (normalized === sentinel && raw.trim().toLowerCase() !== sentinel) return undefined;
  return normalized;
}

/** Read the live Console core tokens off `<html>` — the single token block is
 *  the source of truth, so the terminal tracks BOTH themes automatically. */
function readConsoleTokens(): Partial<ConsoleTokenColors> {
  if (typeof window === 'undefined') return {};
  const styles = getComputedStyle(document.documentElement);
  const tokens: Partial<ConsoleTokenColors> = {};
  const bg = resolveCssColor(styles.getPropertyValue('--bg').trim());
  const fg = resolveCssColor(styles.getPropertyValue('--fg').trim());
  const accent = resolveCssColor(styles.getPropertyValue('--accent').trim());
  const muted = resolveCssColor(styles.getPropertyValue('--muted').trim());
  if (bg !== undefined) tokens.bg = bg;
  if (fg !== undefined) tokens.fg = fg;
  if (accent !== undefined) tokens.accent = accent;
  if (muted !== undefined) tokens.muted = muted;
  return tokens;
}

/** The current xterm palette: live tokens first, static equivalents as backup. */
function currentPalette(theme: ConsoleTheme): TerminalTheme {
  return xtermTheme(theme, readConsoleTokens());
}

/** A live tab: its xterm instance, fit addon, socket, and DOM container. */
interface Session {
  term: XTerm;
  fit: FitAddon;
  ws: WebSocket;
  container: HTMLDivElement;
  closed: boolean;
}

export function Terminal({
  active,
  theme,
  target,
}: {
  active: boolean;
  theme: ConsoleTheme;
  target?: NavigationTarget;
}) {
  const client = useMemo(() => (bootToken ? new ApiClient(bootToken) : undefined), []);
  const { instances } = useAppState();
  const targetState = useMemo(
    () => resolveExplicitOperateTarget(target, instances),
    [instances, target],
  );
  const instanceId = targetState.state === 'ready' ? targetState.target.instanceId : undefined;
  const displayInstance = targetState.state === 'ready' ? targetState.instance : undefined;

  const [status, setStatus] = useState<PtyStatusResponse | 'loading' | 'error'>('loading');
  const [tabs, setTabs] = useState<TerminalTab[]>([]);
  const [activeId, setActiveId] = useState<number | undefined>(undefined);
  /** Per-choice ordinal so the second `codex` tab reads "codex 2". */
  const ordinalsRef = useRef<Map<string, number>>(new Map());
  /** The live sessions, keyed by tab id (outside React render). */
  const sessionsRef = useRef<Map<number, Session>>(new Map());

  // Probe the terminal capability for the current instance.
  useEffect(() => {
    if (!client) {
      setStatus('error');
      return;
    }
    if (instanceId === undefined) {
      setStatus({ available: false, interactive: true, shells: [], reason: 'choose a target' });
      return;
    }
    let cancelled = false;
    void (async () => {
      try {
        const s = await client.getPtyStatus(instanceId);
        if (!cancelled) setStatus(s);
      } catch {
        if (!cancelled) setStatus('error');
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [client, instanceId]);

  const onTargetChange = useCallback(
    (id: string) => {
      const agentKind =
        targetState.state === 'ready' ? targetState.target.agentKind : target?.agentKind;
      window.location.hash =
        id === ''
          ? routeHash({ name: 'terminal' })
          : routeHash({
              name: 'terminal',
              target: { instanceId: id, ...(agentKind !== undefined ? { agentKind } : {}) },
            });
    },
    [target?.agentKind, targetState],
  );

  /** Tear a session down: dispose xterm + close its socket (→ server kills PTY). */
  const disposeSession = useCallback((id: number) => {
    const session = sessionsRef.current.get(id);
    if (!session) return;
    session.closed = true;
    try {
      session.ws.close();
    } catch {
      /* already gone */
    }
    try {
      session.term.dispose();
    } catch {
      /* already gone */
    }
    sessionsRef.current.delete(id);
  }, []);

  // Dispose every session when the whole page unmounts (e.g. token lost).
  useEffect(
    () => () => {
      for (const id of [...sessionsRef.current.keys()]) disposeSession(id);
    },
    [disposeSession],
  );

  /** Attach an xterm + authenticated PTY socket to a freshly-mounted container. */
  const attach = useCallback(
    (tab: TerminalTab, container: HTMLDivElement) => {
      if (!bootToken || sessionsRef.current.has(tab.id)) return;
      const term = new XTerm({
        fontFamily: "'JetBrains Mono', 'IBM Plex Mono', ui-monospace, Menlo, monospace",
        fontSize: 13,
        theme: currentPalette(theme),
        cursorBlink: true,
        scrollback: 5000,
      });
      const fit = new FitAddon();
      term.loadAddon(fit);
      term.open(container);
      try {
        fit.fit();
      } catch {
        /* container not laid out yet — a later fit() covers it */
      }

      const url = buildPtyWsUrl(window.location, {
        instance: tab.instanceId,
        shell: tab.shell,
      });
      let ws: WebSocket;
      try {
        ws = new WebSocket(url, [bootToken]);
      } catch {
        term.writeln('\r\n\x1b[31mterminal: failed to open connection\x1b[0m');
        return;
      }
      const session: Session = { term, fit, ws, container, closed: false };
      sessionsRef.current.set(tab.id, session);

      ws.onopen = () => {
        // Sync the server PTY to the current geometry.
        ws.send(encodeResize(term.cols, term.rows));
      };
      ws.onmessage = (ev: MessageEvent) => {
        const msg = parseServerMessage(ev.data);
        if (!msg) return;
        if (msg.type === 'output') term.write(msg.data);
        else if (msg.type === 'exit') term.writeln('\r\n\x1b[2m[process exited]\x1b[0m');
        else term.writeln(`\r\n\x1b[31m${msg.message}\x1b[0m`);
      };
      ws.onclose = () => {
        if (!session.closed) term.writeln('\r\n\x1b[2m[disconnected]\x1b[0m');
      };
      // Keystrokes → the PTY. Geometry changes → a validated resize control frame.
      term.onData((data) => {
        if (ws.readyState === WebSocket.OPEN) ws.send(encodeInput(data));
      });
      term.onResize(({ cols, rows }) => {
        if (ws.readyState === WebSocket.OPEN) ws.send(encodeResize(cols, rows));
      });
    },
    [theme],
  );

  /** Open a new tab for a launch choice. */
  const openTab = useCallback(
    (choice: ShellChoice) => {
      if (targetState.state !== 'ready') return;
      setTabs((prev) => {
        const id = nextTabId(prev);
        const ordinals = ordinalsRef.current;
        const ordinal = (ordinals.get(choice.id) ?? 0) + 1;
        ordinals.set(choice.id, ordinal);
        const tab: TerminalTab = {
          id,
          shell: choice.id,
          label: tabTitle(choice, ordinal, targetState.instance.name),
          instanceId: targetState.target.instanceId,
        };
        setActiveId(id);
        return [...prev, tab];
      });
    },
    [targetState],
  );

  const closeTab = useCallback(
    (id: number) => {
      disposeSession(id);
      setTabs((prev) => {
        setActiveId((current) => nextActiveAfterClose(prev, id, current));
        return prev.filter((t) => t.id !== id);
      });
    },
    [disposeSession],
  );

  // Re-fit + refresh the active terminal when the page becomes visible again
  // (a hidden container has no size, so xterm cannot lay out until shown).
  useEffect(() => {
    if (!active || activeId === undefined) return;
    const session = sessionsRef.current.get(activeId);
    if (!session) return;
    const raf = requestAnimationFrame(() => {
      try {
        session.fit.fit();
        session.term.focus();
        if (session.ws.readyState === WebSocket.OPEN) {
          session.ws.send(encodeResize(session.term.cols, session.term.rows));
        }
      } catch {
        /* not laid out — ignore */
      }
    });
    return () => cancelAnimationFrame(raf);
  }, [active, activeId, tabs]);

  // Recolor every live terminal when the app theme toggles. Deferred a frame:
  // the shell flips `data-theme` on <html> in a parent effect that runs AFTER
  // this child effect, so the token read must wait for it.
  useEffect(() => {
    const raf = requestAnimationFrame(() => {
      const palette = currentPalette(theme);
      for (const session of sessionsRef.current.values()) {
        session.term.options.theme = palette;
      }
    });
    return () => cancelAnimationFrame(raf);
  }, [theme]);

  // Keep the active terminal fitted on window resizes.
  useEffect(() => {
    const onResize = () => {
      if (activeId === undefined) return;
      const session = sessionsRef.current.get(activeId);
      if (!session) return;
      try {
        session.fit.fit();
      } catch {
        /* ignore */
      }
    };
    window.addEventListener('resize', onResize);
    return () => window.removeEventListener('resize', onResize);
  }, [activeId]);

  const shells: ShellChoice[] =
    status !== 'loading' && status !== 'error' && status.available ? status.shells : [];
  const targetShell =
    targetState.state === 'ready' && targetState.target.agentKind
      ? shells.find((choice) => choice.id === `cli:${targetState.target.agentKind}`)
      : undefined;
  // An explicit agent target is consumed only when the server offered that
  // allowlisted CLI for the resolved instance; otherwise retain the normal
  // shell choices as the safe fallback.
  const launchShells = targetShell === undefined ? shells : [targetShell];

  return (
    <main className="layout-main page terminal-page" hidden={!active} aria-hidden={!active}>
      <header className="page-head">
        <div>
          <h1>Terminal</h1>
          <p className="page-sub">Shells and detected runtime CLIs for the selected target.</p>
        </div>
      </header>

      <section className="page__section operate-target">
        <div className="operate-target__copy">
          <span className="micro-label">TARGET</span>
          <strong>{displayInstance?.name ?? 'No target selected'}</strong>
          <span className="mono muted">
            {displayInstance?.root ??
              (targetState.state === 'invalid'
                ? `missing instance ${targetState.requested.instanceId ?? ''}`
                : 'select a repository before opening new terminal sessions')}
          </span>
        </div>
        <Select
          className="operate-target__select mono"
          aria-label="terminal target repository"
          value={instanceId ?? ''}
          onChange={(e) => onTargetChange(e.target.value)}
        >
          <option value="">Choose target…</option>
          {targetState.instances.map((instance) => (
            <option key={instance.id} value={instance.id}>
              {instance.name}
            </option>
          ))}
        </Select>
      </section>

      {targetState.state !== 'ready' && (
        <section className="page__section">
          <Notice>
            {targetState.state === 'invalid'
              ? 'The selected Terminal target no longer exists. Choose a repository before opening new sessions.'
              : 'Choose a repository target before opening new terminal sessions.'}
          </Notice>
        </section>
      )}

      {status === 'loading' ? (
        <section className="page__section">
          <p className="meta">checking terminal availability…</p>
        </section>
      ) : status === 'error' || !status.available ? (
        <section className="page__section">
          <Notice>
            {status === 'error'
              ? 'terminal unavailable — reopen agentconfig from the CLI'
              : (status.reason ?? 'terminal unavailable')}
          </Notice>
        </section>
      ) : (
        <>
          <div className="terminal-bar">
            <div className="terminal-tabs" role="tablist" aria-label="Terminal tabs">
              {tabs.map((tab) => (
                <div
                  key={tab.id}
                  className={`terminal-tab${tab.id === activeId ? ' terminal-tab--active' : ''}`}
                >
                  <button
                    type="button"
                    role="tab"
                    aria-selected={tab.id === activeId}
                    className="terminal-tab__label mono-data"
                    onClick={() => setActiveId(tab.id)}
                  >
                    {tab.label}
                  </button>
                  <button
                    type="button"
                    className="terminal-tab__close"
                    aria-label={`Close ${tab.label}`}
                    onClick={() => closeTab(tab.id)}
                  >
                    ×
                  </button>
                </div>
              ))}
            </div>
            <div className="terminal-launch">
              {launchShells.map((choice) => (
                <Button
                  key={choice.id}
                  label={`+ ${choice.label}`}
                  onClick={() => openTab(choice)}
                />
              ))}
            </div>
          </div>

          <section className="page__section terminal-stage">
            {tabs.length === 0 ? (
              <EmptyState instruction="open a shell or a detected runtime CLI to begin" />
            ) : (
              tabs.map((tab) => (
                <div
                  key={tab.id}
                  className="terminal-surface"
                  style={{ display: tab.id === activeId ? 'block' : 'none' }}
                  ref={(el) => {
                    if (el) attach(tab, el);
                  }}
                />
              ))
            )}
          </section>
        </>
      )}
    </main>
  );
}
