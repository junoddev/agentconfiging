/**
 * First-run onboarding (E10 qoc.2, SPEC §5 row 20). A single terse, dismissible
 * panel shown once — the shell mounts it only while the `agentconfig:onboarded`
 * flag is unset, and dismissing sets the flag so it never reappears.
 *
 * DESIGN §9: a hairline panel over a faint scrim — NO blur/glass/shadow. §7
 * voice: terse, honest, no overpromising. All copy is a text node; tokens only.
 */

import { useEffect, type MouseEvent as ReactMouseEvent } from 'react';
import { Button } from '../components/core/index.js';
import './shell.css';

export interface OnboardingProps {
  /** Dismiss + persist the flag so onboarding does not reappear. */
  onDone: () => void;
}

export function Onboarding({ onDone }: OnboardingProps) {
  // Esc dismisses, matching the command palette's affordance.
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') onDone();
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [onDone]);

  return (
    <div className="shell-modal" role="presentation" onMouseDown={onDone}>
      <div
        className="shell-modal__panel"
        role="dialog"
        aria-modal="true"
        aria-label="welcome to agentconfig"
        onMouseDown={(e: ReactMouseEvent) => e.stopPropagation()}
      >
        <h2 className="shell-modal__title">WELCOME TO AGENTCONFIG</h2>
        <p className="shell-modal__lead">
          Inspect and control the AI-agent configuration in this repo — agents, skills, hooks,
          rules, and MCP servers — from one place.
        </p>
        <ul className="shell-modal__list">
          <li className="shell-modal__item">
            <span className="shell-modal__key">RAIL</span>
            <span>The left rail jumps between pages; Cmd+K opens the command palette.</span>
          </li>
          <li className="shell-modal__item">
            <span className="shell-modal__key">LIVE</span>
            <span>Changes to your config files are watched and reflected as you edit.</span>
          </li>
          <li className="shell-modal__item">
            <span className="shell-modal__key">LOCAL</span>
            <span>
              Everything runs on your machine. The session token stays in memory and is never
              written to disk.
            </span>
          </li>
        </ul>
        <p className="shell-modal__note">
          This intro shows once. ABOUT in the top bar has the details.
        </p>
        <div className="shell-modal__actions">
          <Button label="skip" onClick={onDone} />
          <Button label="got it" variant="primary" onClick={onDone} />
        </div>
      </div>
    </div>
  );
}
