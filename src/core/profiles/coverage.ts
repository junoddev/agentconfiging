import { AGENT_PROFILES } from './data.js';
import { CAPABILITY_AREAS } from './types.js';
import type { AgentProfile, CapabilityArea, Coverage } from './types.js';
import { sourceCadence } from './source-manifests.js';

export interface ProfileCoverageRow {
  profileId: string;
  supportTier: 'first-class' | 'profile-sync-only';
  owner: string;
  coverage: Record<CapabilityArea, Coverage>;
  freshness: Record<CapabilityArea, 'fresh' | 'stale' | 'expired' | 'unavailable'>;
  weeklySourceIds: string[];
  monthlySourceIds: string[];
}

const FRESHNESS_ORDER = ['unavailable', 'expired', 'stale', 'fresh'] as const;

/** Worst required-source status. With no required source, freshness is unavailable. */
export function capabilityFreshness(
  profile: AgentProfile,
  area: CapabilityArea,
): ProfileCoverageRow['freshness'][CapabilityArea] {
  const statuses = profile.sources
    .filter((source) => source.required && source.covers.includes(area))
    .map((source) => source.freshness.status);
  return statuses.length
    ? (FRESHNESS_ORDER.find((candidate) => statuses.includes(candidate)) ?? 'unavailable')
    : 'unavailable';
}

/** A deterministic, conservative matrix: missing source evidence is unavailable, never unsupported. */
export function profileCoverageMatrix(): ProfileCoverageRow[] {
  return AGENT_PROFILES.map((profile) => {
    const freshness = Object.fromEntries(
      CAPABILITY_AREAS.map((area) => {
        return [area, capabilityFreshness(profile, area)];
      }),
    ) as ProfileCoverageRow['freshness'];
    const ids = (cadence: 'weekly' | 'monthly') =>
      profile.sources
        .filter((source) => sourceCadence(source.retrievalPolicy.maxAgeDays) === cadence)
        .map((source) => source.id)
        .sort();
    return {
      profileId: profile.id,
      supportTier: profile.maintainer.supportTier,
      owner: profile.maintainer.owner,
      coverage: { ...profile.coverage },
      freshness,
      weeklySourceIds: ids('weekly'),
      monthlySourceIds: ids('monthly'),
    };
  }).sort((a, b) => a.profileId.localeCompare(b.profileId));
}
