import type { CapabilityArea } from './types.js';

export type ProfileReviewCadence = 'weekly' | 'monthly';

export interface RuntimeSourceManifest {
  owner: string;
  stable: { cadence: 'monthly'; covers: CapabilityArea[] };
  volatile: { cadence: 'weekly'; covers: CapabilityArea[] };
}

const VOLATILE_AREAS: CapabilityArea[] = [
  'commands',
  'extensions',
  'history',
  'hookEvents',
  'mcp',
  'models',
  'settings',
  'skills',
  'tools',
];

function manifest(owner: string): RuntimeSourceManifest {
  return {
    owner,
    stable: { cadence: 'monthly', covers: ['instructionArtifacts'] },
    volatile: { cadence: 'weekly', covers: [...VOLATILE_AREAS] },
  };
}

/**
 * Review ownership and source cadence for the complete canonical roster.
 * `covers` describes the audit question, not affirmative product support.
 * Empty facts therefore remain unknown until cited evidence is promoted.
 */
export const RUNTIME_SOURCE_MANIFESTS = {
  aider: manifest('runtime-maintainers/aider'),
  'amazon-q': manifest('runtime-maintainers/amazon-q'),
  'claude-code': manifest('runtime-maintainers/claude-code'),
  cline: manifest('runtime-maintainers/cline'),
  codex: manifest('runtime-maintainers/codex'),
  continue: manifest('runtime-maintainers/continue'),
  copilot: manifest('runtime-maintainers/copilot'),
  cursor: manifest('runtime-maintainers/cursor'),
  'gemini-cli': manifest('runtime-maintainers/gemini-cli'),
  junie: manifest('runtime-maintainers/junie'),
  opencode: manifest('runtime-maintainers/opencode'),
  qodo: manifest('runtime-maintainers/qodo'),
  roo: manifest('runtime-maintainers/roo'),
  windsurf: manifest('runtime-maintainers/windsurf'),
  zed: manifest('runtime-maintainers/zed'),
} as const satisfies Record<string, RuntimeSourceManifest>;

export function sourceCadence(maxAgeDays: number): ProfileReviewCadence {
  return maxAgeDays <= 7 ? 'weekly' : 'monthly';
}
