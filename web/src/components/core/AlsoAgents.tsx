import { displayNameForKind } from '../../state/agentScope.js';
import './components.css';

export interface AlsoAgentsProps {
  /** DetectedAgent kinds (not display names) the item also applies to. */
  kinds: readonly string[];
}

/** "Also applies to" badge (bead a6y): pages scoped to the active agent note
 *  the OTHER detected runtimes that read the same file. Renders nothing when
 *  the item is exclusive to the active agent. */
export function AlsoAgents({ kinds }: AlsoAgentsProps) {
  if (kinds.length === 0) return null;
  return (
    <span className="scope also-agents" title="Other detected agents that read this file">
      also · {kinds.map(displayNameForKind).join(' · ')}
    </span>
  );
}
