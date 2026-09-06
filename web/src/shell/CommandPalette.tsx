/**
 * Command palette: Cmd+K opens the shared Dialog (E13.2 primitive — native
 * <dialog>, hairline head/body, fg-mix backdrop) holding a `.search` input and
 * a fuzzy-filtered command list. Keyboard nav (up/down/enter/esc); the list
 * logic is pure (see ../command/commands). The shell owns the effects via
 * `onRun`.
 */

import {
  useEffect,
  useMemo,
  useRef,
  useState,
  type KeyboardEvent as ReactKeyboardEvent,
  type MouseEvent as ReactMouseEvent,
} from 'react';
import { Dialog, formatIndex } from '../components/core/index.js';
import {
  buildCommands,
  commandTargetContext,
  filterCommands,
  moveSelection,
  type CommandAction,
} from '../command/commands.js';
import { EDITOR_ROUTES, type RouteName } from '../routes.js';
import { integrationInventoryTerm } from '../lib/agentTerminology.js';
import type { Route } from '../routes.js';
import { sectionApplies, useAppState } from '../state/index.js';
import type { Theme } from './theme.js';
import '../command/command.css';

export interface CommandPaletteProps {
  open: boolean;
  theme: Theme;
  /** Current route, including an explicit deep-link target when present. */
  route?: Route;
  onClose: () => void;
  /** Run a chosen command's action (the shell performs the effect). */
  onRun: (action: CommandAction) => void;
}

export function CommandPalette({ open, theme, route, onClose, onRun }: CommandPaletteProps) {
  const [query, setQuery] = useState('');
  const [selected, setSelected] = useState(0);
  const inputRef = useRef<HTMLInputElement>(null);
  const { agentScopeKind, currentInstance } = useAppState();

  // Mirror the sidebar's adaptive rail (bead a6y): no nav commands for
  // Configure sections the active agent has no concept of.
  const hiddenRoutes = useMemo(() => {
    return new Set<RouteName>(
      EDITOR_ROUTES.filter((name) => !sectionApplies(name, agentScopeKind)),
    );
  }, [agentScopeKind]);

  const contextTarget = useMemo(() => {
    return {
      ...(currentInstance?.id !== undefined ? { instanceId: currentInstance.id } : {}),
      ...(agentScopeKind !== undefined ? { agentKind: agentScopeKind } : {}),
    };
  }, [agentScopeKind, currentInstance?.id]);
  const targets = useMemo(() => commandTargetContext(route, contextTarget), [contextTarget, route]);
  const commands = useMemo(
    () =>
      buildCommands(theme, hiddenRoutes, targets.contextTarget, targets.operateTarget, {
        extensions: integrationInventoryTerm(agentScopeKind),
      }),
    [theme, hiddenRoutes, targets, agentScopeKind],
  );
  const results = useMemo(() => filterCommands(commands, query), [commands, query]);

  // Reset + focus each time it opens (after the Dialog's showModal, which
  // otherwise leaves focus on the head's close button).
  useEffect(() => {
    if (!open) return;
    setQuery('');
    setSelected(0);
    inputRef.current?.focus();
  }, [open]);

  // Keep the selection in range as the result set shrinks.
  useEffect(() => {
    setSelected((s) => (s >= results.length ? 0 : s));
  }, [results.length]);

  if (!open) return null;

  const run = (action: CommandAction) => {
    onRun(action);
    onClose();
  };

  const onKeyDown = (e: ReactKeyboardEvent<HTMLInputElement>) => {
    switch (e.key) {
      case 'ArrowDown':
        e.preventDefault();
        setSelected((s) => moveSelection(s, 1, results.length));
        break;
      case 'ArrowUp':
        e.preventDefault();
        setSelected((s) => moveSelection(s, -1, results.length));
        break;
      case 'Enter': {
        e.preventDefault();
        const hit = results[selected];
        if (hit) run(hit.command.action);
        break;
      }
      case 'Escape':
        e.preventDefault();
        onClose();
        break;
    }
  };

  return (
    <Dialog open title="Commands" onClose={onClose}>
      <input
        ref={inputRef}
        className="search cmdk__input"
        type="text"
        placeholder="Jump to a page · toggle theme · run an action"
        value={query}
        onChange={(e) => setQuery(e.target.value)}
        onKeyDown={onKeyDown}
        aria-label="command"
        autoComplete="off"
        spellCheck={false}
        autoFocus
      />
      <ul className="cmdk__list" role="listbox" aria-label="commands">
        {results.length === 0 ? (
          <li className="cmdk__empty meta">No command matches “{query}”</li>
        ) : (
          results.map(({ command }, i) => (
            <li
              key={command.id}
              className={`cmdk__row${i === selected ? ' cmdk__row--active' : ''}`}
              role="option"
              aria-selected={i === selected}
              onMouseMove={() => setSelected(i)}
              onMouseDown={(e: ReactMouseEvent) => {
                e.preventDefault();
                run(command.action);
              }}
            >
              <span className="cmdk__index mono-data">{formatIndex(i + 1)}</span>
              <span className="cmdk__label">{command.label}</span>
              <span className="cmdk__hint mono-data">{command.hint}</span>
            </li>
          ))
        )}
      </ul>
    </Dialog>
  );
}
