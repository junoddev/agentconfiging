import type { InstructionFormat, InstructionLayout } from '../runtimes/types.js';

export const CAPABILITY_AREAS = [
  'instructionArtifacts',
  'settings',
  'models',
  'tools',
  'hookEvents',
  'commands',
  'skills',
  'mcp',
  'extensions',
  'history',
] as const;

export type CapabilityArea = (typeof CAPABILITY_AREAS)[number];
export type Coverage = 'full' | 'partial' | 'unknown' | 'unsupported';
export type Lifecycle = 'current' | 'legacy' | 'deprecated' | 'removed';
export type ProfileConfidence = 'verified' | 'corroborated' | 'inferred' | 'unknown';
export type VersionScheme = 'semver' | 'calver' | 'opaque' | 'rolling';

export interface Applicability {
  since?: string;
  until?: string;
  channels?: Array<'stable' | 'beta' | 'nightly'>;
  platforms?: Array<'darwin' | 'linux' | 'windows'>;
  interfaces?: Array<'cli' | 'ide' | 'desktop' | 'web'>;
  observedFrom?: string;
  observedUntil?: string;
}

export interface Evidence {
  sourceId: string;
  locator: string;
  checkedAt: string;
  contentHash?: string;
}

export interface ProfileFact<T = unknown> {
  factId: string;
  value: T;
  lifecycle: Lifecycle;
  replacementFactId?: string;
  applicability: Applicability;
  evidence: Evidence[];
  confidence: ProfileConfidence;
  lastChangedAt?: string;
}

export interface InstructionArtifact {
  path: string;
  format: InstructionFormat;
  scope: 'project' | 'global';
  layout: InstructionLayout;
  loadBehavior?: string;
  rulesDirPattern?: string;
}

export interface SettingDefinition {
  key: string;
  valueType: 'string' | 'object' | 'boolean';
}

export interface ModelDefinition {
  id: string;
  replacement?: string;
  purpose?: 'runtime-capability' | 'cross-provider-reference-compatibility';
}

export interface ToolDefinition {
  name: string;
}

export interface HookEventDefinition {
  name: string;
  description: string;
  matcherApplies: boolean;
}

export interface ProfileSource {
  id: string;
  kind:
    | 'official-product'
    | 'official-config'
    | 'official-schema'
    | 'official-release-notes'
    | 'independent-docs'
    | 'cli-probe';
  url?: string;
  command?: string[];
  required: boolean;
  covers: CapabilityArea[];
  versionScheme: VersionScheme;
  retrievalPolicy: {
    method: 'http' | 'command';
    maxAgeDays: number;
    allowedRedirectUrls?: string[];
  };
  latestSuccessfulRetrieval?: {
    retrievedAt: string;
    contentHash: string;
  };
  freshness: {
    status: 'fresh' | 'stale' | 'expired' | 'unavailable';
    reason?: string;
  };
}

export interface ProfileFacts extends Record<CapabilityArea, ProfileFact[]> {
  instructionArtifacts: ProfileFact<InstructionArtifact>[];
}

export interface AgentProfile {
  schemaVersion: 1;
  profileRevision: number;
  id: string;
  aliases: string[];
  displayName: string;
  vendor: string;
  productFamily: string;
  sources: ProfileSource[];
  maintainer: {
    supportTier: 'first-class' | 'profile-sync-only';
    detectorId?: string;
    owner: string;
    scaffoldPath: string;
    scaffoldTemplate: string;
    detectionMarkers: string[];
    /** Compatibility metadata for the stable RuntimeFormat API. */
    docsUrl: string;
    confidence: 'verified' | 'unverified';
  };
  coverage: Record<CapabilityArea, Coverage>;
  facts: ProfileFacts;
  observedProductVersion?: string;
  promotion:
    | {
        method: 'baseline-import';
        promotedAt: string;
        promoterId: string;
        provenance: string;
      }
    | {
        method: 'reviewed-candidate';
        promotedAt: string;
        promoterId: string;
        candidateId: string;
        candidateHash: string;
        basedOnProfileRevision: number;
        canonicalHash: string;
        approvals: Array<{
          approverId: string;
          approvedAt: string;
          decision: 'approve' | 'reject';
          comment?: string;
        }>;
      };
}

export interface ProfileValidationIssue {
  path: string;
  message: string;
}
