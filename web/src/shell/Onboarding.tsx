/**
 * First-run onboarding (E10 qoc.2, reskinned onto the shared Dialog in E13.3).
 * A single terse, dismissible panel shown once — the shell mounts it only while
 * the `agentconfig:onboarded` flag is unset, and dismissing sets the flag so it
 * never reappears. §7 voice: terse, honest, no overpromising. All copy is a
 * text node.
 */

import { Button, Dialog } from '../components/core/index.js';
import './shell.css';

export interface OnboardingProps {
  /** Dismiss + persist the flag so onboarding does not reappear. */
  onDone: () => void;
}

export function Onboarding({ onDone }: OnboardingProps) {
  return (
    <Dialog
      open
      title="Welcome to agentconfig.ing"
      onClose={onDone}
      footer={
        <>
          <Button label="Skip" variant="ghost" onClick={onDone} />
          <Button label="Got it" variant="primary" onClick={onDone} />
        </>
      }
    >
      <p className="shell-lead">
        Inspect and control the AI-agent configuration in this repo — agents, skills, hooks, rules,
        and MCP servers — from one place.
      </p>
      <ul className="shell-list">
        <li className="shell-item">
          <span className="shell-item__key">Sidebar</span>
          <span>The grouped sidebar jumps between pages; Cmd+K opens the command palette.</span>
        </li>
        <li className="shell-item">
          <span className="shell-item__key">Live</span>
          <span>Changes to your config files are watched and reflected as you edit.</span>
        </li>
        <li className="shell-item">
          <span className="shell-item__key">Local</span>
          <span>
            Everything runs on your machine. The session token stays in this browser tab and is
            never sent to a server.
          </span>
        </li>
      </ul>
      <p className="meta shell-note">
        This intro shows once. The ? in the top bar has the details.
      </p>
    </Dialog>
  );
}
