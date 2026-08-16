import { CAPABILITY_AREAS } from './types.js';
import { capabilityFreshness } from './coverage.js';
import type { AgentProfile, CapabilityArea, ProfileConfidence } from './types.js';

export interface PublicProfileSummary {
  id: string;
  displayName: string;
  vendor: string;
  productFamily: string;
  profileRevision: number;
  supportTier: AgentProfile['maintainer']['supportTier'];
  coverage: AgentProfile['coverage'];
  freshness: Record<CapabilityArea, ReturnType<typeof capabilityFreshness>>;
  confidence: ProfileConfidence;
  lastSuccessfulCheck?: string;
  pendingDrift: boolean;
  sources: Array<{ id: string; kind: AgentProfile['sources'][number]['kind']; url?: string }>;
}

export interface PublicProfileDetail extends PublicProfileSummary {
  observedProductVersion?: string;
  facts: Record<
    CapabilityArea,
    Array<{
      factId: string;
      value: unknown;
      lifecycle: AgentProfile['facts'][CapabilityArea][number]['lifecycle'];
      confidence: ProfileConfidence;
      lastChangedAt?: string;
    }>
  >;
}

const CONFIDENCE_ORDER: ProfileConfidence[] = ['unknown', 'inferred', 'corroborated', 'verified'];

function overallConfidence(profile: AgentProfile): ProfileConfidence {
  const values = CAPABILITY_AREAS.flatMap((area) => {
    if (profile.coverage[area] === 'unknown') return ['unknown' as const];
    if (profile.coverage[area] !== 'unsupported' && profile.facts[area].length === 0)
      return ['unknown' as const];
    return profile.facts[area].map((fact) => fact.confidence);
  });
  return values.length
    ? (CONFIDENCE_ORDER.find((candidate) => values.includes(candidate)) ?? 'unknown')
    : 'unknown';
}

export function publicProfileSummary(
  profile: AgentProfile,
  pendingDrift = false,
): PublicProfileSummary {
  const required = profile.sources.filter((source) => source.required);
  const successful = required.map((source) => source.latestSuccessfulRetrieval?.retrievedAt);
  const lastSuccessfulCheck = successful.every((value): value is string => value !== undefined)
    ? [...successful].sort()[0]
    : undefined;
  return {
    id: profile.id,
    displayName: profile.displayName,
    vendor: profile.vendor,
    productFamily: profile.productFamily,
    profileRevision: profile.profileRevision,
    supportTier: profile.maintainer.supportTier,
    coverage: { ...profile.coverage },
    freshness: Object.fromEntries(
      CAPABILITY_AREAS.map((area) => [area, capabilityFreshness(profile, area)]),
    ) as PublicProfileSummary['freshness'],
    confidence: overallConfidence(profile),
    ...(lastSuccessfulCheck ? { lastSuccessfulCheck } : {}),
    pendingDrift,
    sources: profile.sources
      .filter((source) => source.url !== undefined)
      .map((source) => ({ id: source.id, kind: source.kind, url: source.url })),
  };
}

export function publicProfileDetail(
  profile: AgentProfile,
  pendingDrift = false,
): PublicProfileDetail {
  const facts = Object.fromEntries(
    CAPABILITY_AREAS.map((area) => [
      area,
      profile.facts[area].map((fact) => ({
        factId: fact.factId,
        value: fact.value,
        lifecycle: fact.lifecycle,
        confidence: fact.confidence,
        ...(fact.lastChangedAt ? { lastChangedAt: fact.lastChangedAt } : {}),
      })),
    ]),
  ) as PublicProfileDetail['facts'];
  return {
    ...publicProfileSummary(profile, pendingDrift),
    ...(profile.observedProductVersion
      ? { observedProductVersion: profile.observedProductVersion }
      : {}),
    facts,
  };
}
