import { AGENT_PROFILES } from './data.js';
import { assertValidAgentProfiles } from './validate.js';
import type { AgentProfile } from './types.js';

export { AGENT_PROFILES } from './data.js';
export { projectRuntimeFormat } from './projection.js';
export { CLAUDE_CATALOG, projectClaudeCatalog } from './claude.js';
export type { ClaudeCatalogProjection } from './claude.js';
export { CLAUDE_PUBLIC_CATALOG } from './claude-public.js';
export {
  assertValidAgentProfiles,
  validateAgentProfiles,
  validateCanonicalAgentProfiles,
} from './validate.js';
export { CAPABILITY_AREAS } from './types.js';
export { capabilityFreshness, profileCoverageMatrix } from './coverage.js';
export { RUNTIME_SOURCE_MANIFESTS, sourceCadence } from './source-manifests.js';
export type { ProfileCoverageRow } from './coverage.js';
export type { ProfileReviewCadence, RuntimeSourceManifest } from './source-manifests.js';
export type * from './types.js';
export { publicProfileDetail, publicProfileSummary } from './public.js';
export type { PublicProfileDetail, PublicProfileSummary } from './public.js';
export { extractProfileWithCodex } from './codex-extractor.js';
export type {
  CachedEvidenceSnapshot,
  CodexChangeClaim,
  CodexExtractionOptions,
  CodexExtractionOutput,
  CodexRunnerRequest,
  IsolatedCodexRunner,
} from './codex-extractor.js';

assertValidAgentProfiles(AGENT_PROFILES);

const profilesById = new Map<string, AgentProfile>();
for (const profile of AGENT_PROFILES) {
  profilesById.set(profile.id, profile);
  for (const alias of profile.aliases) profilesById.set(alias, profile);
}

export function getAgentProfile(idOrAlias: string): AgentProfile | undefined {
  return profilesById.get(idOrAlias);
}

export function listAgentProfiles(): AgentProfile[] {
  return [...AGENT_PROFILES];
}

const SET_ARRAY_KEYS = new Set([
  'aliases',
  'covers',
  'detectionMarkers',
  'channels',
  'platforms',
  'interfaces',
]);

function canonicalize(value: unknown, key?: string): unknown {
  if (Array.isArray(value)) {
    const items = value.map((item) => canonicalize(item));
    if (key === 'sources')
      return items.sort((a, b) =>
        String((a as { id?: unknown }).id).localeCompare(String((b as { id?: unknown }).id)),
      );
    if (key === 'evidence')
      return items.sort((a, b) => {
        const left = a as { sourceId?: unknown; locator?: unknown };
        const right = b as { sourceId?: unknown; locator?: unknown };
        return `${String(left.sourceId)}\0${String(left.locator)}`.localeCompare(
          `${String(right.sourceId)}\0${String(right.locator)}`,
        );
      });
    if (SET_ARRAY_KEYS.has(key ?? ''))
      return items.sort((a, b) => String(a).localeCompare(String(b)));
    if (items.every((item) => typeof item === 'object' && item !== null && 'factId' in item))
      return items.sort((a, b) =>
        String((a as { factId: unknown }).factId).localeCompare(
          String((b as { factId: unknown }).factId),
        ),
      );
    return items;
  }
  if (value && typeof value === 'object')
    return Object.fromEntries(
      Object.entries(value)
        .sort(([a], [b]) => a.localeCompare(b))
        .map(([childKey, child]) => [childKey, canonicalize(child, childKey)]),
    );
  return value;
}

/** Stable canonical JSON suitable for hashing and review diffs. Command argv order is preserved. */
export function serializeAgentProfiles(profiles: readonly AgentProfile[] = AGENT_PROFILES): string {
  return `${JSON.stringify(
    canonicalize([...profiles].sort((a, b) => a.id.localeCompare(b.id))),
    null,
    2,
  )}\n`;
}
