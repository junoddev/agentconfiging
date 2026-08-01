/**
 * Top bar (opendesign/DESIGN.md §4): 49px, `--surface`, bottom hairline.
 * Left = brand block (mono accent sigil + "agentconfig" + version from
 * GET /api/health — a dashless nothing until the probe resolves). Center = the
 * dual-side context chooser (`.chooser`): FOLDER = current instance/workspace,
 * AGENT = the ACTIVE agent (bead a6y) — picking one scopes every Configure
 * page to that runtime (persisted; no combined all-agents edit view). Right =
 * cost widget slot + theme toggle + about, as `.icon-btn`s. A `.nav-toggle`
 * icon-btn appears ≤860px where the sidebar hides.
 */

import { useEffect, useRef, useState } from 'react';
import { ApiClient } from '../api/index.js';
import { bootstrapToken } from '../api/token.js';
import { displayNameForKind, useAppState } from '../state/index.js';
import type { Theme as ConsoleTheme } from './theme.js';

// Like the about dialog: the shell keeps its ApiClient private,
// so capture the launch token at module load for the version probe.
const bootToken = typeof window !== 'undefined' ? bootstrapToken() : undefined;

export interface TopBarProps {
  theme: ConsoleTheme;
  onToggleTheme: () => void;
  /** Open the about dialog (name / version / licence / local-only note). */
  onAbout: () => void;
  /** ≤860px: show/hide the overlaid sidebar. */
  onToggleNav: () => void;
}

type MenuId = 'folder' | 'agent';

export function TopBar({ theme, onToggleTheme, onAbout, onToggleNav }: TopBarProps) {
  const { instances, currentInstance, selectInstance, report, activeAgent, selectAgent } =
    useAppState();
  const [version, setVersion] = useState<string | undefined>();
  const [menu, setMenu] = useState<MenuId | null>(null);
  const chooserRef = useRef<HTMLDivElement>(null);

  // Version probe — shows nothing (never an invented number) until it resolves.
  useEffect(() => {
    let cancelled = false;
    if (!bootToken) return;
    const client = new ApiClient(bootToken);
    void (async () => {
      try {
        const res = await client.getHealth();
        if (!cancelled) setVersion(res.version);
      } catch {
        // Probe failed — the brand block simply omits the version.
      }
    })();
    return () => {
      cancelled = true;
    };
  }, []);

  // An open menu closes on any click outside the chooser and on Escape.
  useEffect(() => {
    if (menu === null) return;
    const onDown = (e: MouseEvent) => {
      if (chooserRef.current && !chooserRef.current.contains(e.target as Node)) setMenu(null);
    };
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') setMenu(null);
    };
    document.addEventListener('mousedown', onDown);
    document.addEventListener('keydown', onKey);
    return () => {
      document.removeEventListener('mousedown', onDown);
      document.removeEventListener('keydown', onKey);
    };
  }, [menu]);

  const toggleMenu = (id: MenuId) => setMenu((m) => (m === id ? null : id));

  const agents = report?.agents ?? [];

  const pickFolder = (id: string) => {
    setMenu(null);
    selectInstance(id);
  };

  const pickAgent = (kind: string) => {
    setMenu(null);
    selectAgent(kind);
  };

  return (
    <header className="topbar">
      <button
        type="button"
        className="icon-btn nav-toggle"
        aria-label="Toggle navigation"
        title="Toggle navigation"
        onClick={onToggleNav}
      >
        ☰
      </button>
      <div className="brand">
        <span className="sigil" aria-hidden="true">
          ▞▚
        </span>
        <span className="name">agentconfig</span>
        {/* Server-provided data — rendered as a text node, never HTML. */}
        {version !== undefined && <span className="ver">v{version}</span>}
      </div>

      <div className="chooser" ref={chooserRef}>
        <button
          type="button"
          className="ch-side"
          aria-haspopup="menu"
          aria-expanded={menu === 'folder'}
          onClick={() => toggleMenu('folder')}
        >
          <span className="ch-label">Folder</span>
          <span className="ch-value mono">{currentInstance?.name ?? '—'}</span>
          <span className="ch-caret" aria-hidden="true">
            ▾
          </span>
        </button>
        <span className="ch-div" aria-hidden="true" />
        <button
          type="button"
          className="ch-side"
          aria-haspopup="menu"
          aria-expanded={menu === 'agent'}
          onClick={() => toggleMenu('agent')}
        >
          <span className="ch-label">Agent</span>
          <span className="ch-value">
            {activeAgent !== undefined ? displayNameForKind(activeAgent.kind) : '—'}
          </span>
          <span className="ch-caret" aria-hidden="true">
            ▾
          </span>
        </button>
        {menu === 'folder' && (
          <div className="ch-menu ch-left open" role="menu" aria-label="Workspaces">
            {instances.length === 0 ? (
              <div className="ch-item" aria-disabled="true">
                <span className="muted">No instances loaded</span>
              </div>
            ) : (
              instances.map((inst) => (
                <button
                  key={inst.id}
                  type="button"
                  role="menuitem"
                  className={`ch-item${inst.id === currentInstance?.id ? ' active' : ''}`}
                  onClick={() => pickFolder(inst.id)}
                >
                  <span className="mono">{inst.root}</span>
                  {inst.isDefault && <span className="meta">default</span>}
                </button>
              ))
            )}
          </div>
        )}
        {menu === 'agent' && (
          <div className="ch-menu ch-right open" role="menu" aria-label="Agent runtimes">
            {agents.length === 0 ? (
              <div className="ch-item" aria-disabled="true">
                <span className="muted">No agents detected</span>
              </div>
            ) : (
              agents.map((agent) => (
                <button
                  key={agent.kind}
                  type="button"
                  role="menuitem"
                  className={`ch-item${agent.kind === activeAgent?.kind ? ' active' : ''}`}
                  onClick={() => pickAgent(agent.kind)}
                >
                  <span className="mono">{agent.kind}</span>
                  <span className="meta">{agent.confidence}</span>
                </button>
              ))
            )}
          </div>
        )}
      </div>

      <button
        type="button"
        className="icon-btn"
        aria-label="Toggle light / dark"
        title={`Theme: ${theme} — click to toggle`}
        onClick={onToggleTheme}
      >
        ◐
      </button>
      <button
        type="button"
        className="icon-btn"
        aria-label="About agentconfig"
        title="About agentconfig"
        onClick={onAbout}
      >
        ?
      </button>
    </header>
  );
}
