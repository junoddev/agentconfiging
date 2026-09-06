import { createHash } from 'node:crypto';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';

import {
  assertFetchableUrl,
  defaultHostResolver,
  defaultPinnedHttpFetch,
  isBlockedRegistryHost,
  RegistryFetchError,
  type HostResolver,
  type HttpFetch,
} from '../registry/client.js';
import { getAgentProfile, serializeAgentProfiles } from './index.js';
import { CAPABILITY_AREAS } from './types.js';
import type {
  AgentProfile,
  CapabilityArea,
  InstructionArtifact,
  ProfileFact,
  ProfileSource,
} from './types.js';
import { validateAgentProfiles } from './validate.js';
import type { CachedEvidenceSnapshot, IsolatedCodexRunner } from './codex-extractor.js';

export const PROFILE_AUDIT_MAX_BYTES = 2_000_000;
export const PROFILE_AUDIT_TIMEOUT_MS = 15_000;
export type ProfileAuditStatus = 'clean' | 'drift' | 'fetch-failure' | 'invalid';

export interface ProfileAuditResult {
  profileId: string;
  status: ProfileAuditStatus;
  candidatePath?: string;
  changes: string[];
  errors: string[];
  diagnostics?: string[];
  unresolvedSourceIds?: string[];
  evidence: Array<{ sourceId: string; url: string; contentHash: string; cachePath: string }>;
}

export interface ProfileFactDiff {
  area: CapabilityArea;
  factId: string;
  operation: 'add' | 'change' | 'remove';
  before?: unknown;
  after: unknown;
}

export interface ProfileCandidateEnvelope {
  schemaVersion: 1;
  candidateId: string;
  candidateHash: string;
  profileId: string;
  basedOnProfileRevision: number;
  baseProfileHash: string;
  sourceSnapshotIds: string[];
  generatedAt: string;
  profile: AgentProfile;
  semanticDiff: ProfileFactDiff[];
  sourceChanges: Array<{
    sourceId: string;
    beforeContentHash?: string;
    afterContentHash: string;
    requiresManualExtraction: boolean;
  }>;
  extraction: { diagnostics: string[]; uncertainties: string[] };
  validation: { valid: boolean; issues: Array<{ path: string; message: string }> };
}

export interface AuditOptions {
  profileId: string;
  /** Optional exact canonical source ids. Unknown ids fail closed. */
  sourceIds?: string[];
  /** Scheduled cadence selection. Exact sourceIds override this filter. */
  cadence?: 'daily' | 'weekly' | 'monthly';
  /** Refresh conditional source/cache metadata without extraction or candidate generation. */
  metadataOnly?: boolean;
  cacheDir?: string;
  candidateDir?: string;
  now?: () => Date;
  fetch?: HttpFetch;
  resolveHost?: HostResolver;
  maxBytes?: number;
  timeoutMs?: number;
  codexAssisted?: boolean;
  codexRunner?: IsolatedCodexRunner;
}

function sha256(bytes: Uint8Array): string {
  return `sha256:${createHash('sha256').update(bytes).digest('hex')}`;
}

function safeName(hash: string): string {
  return hash.slice('sha256:'.length);
}

function abortable<T>(promise: Promise<T>, signal: AbortSignal): Promise<T> {
  if (signal.aborted) return Promise.reject(new Error('aborted'));
  return new Promise<T>((resolve, reject) => {
    const onAbort = () => reject(new Error('aborted'));
    signal.addEventListener('abort', onAbort, { once: true });
    promise.then(
      (value) => {
        signal.removeEventListener('abort', onAbort);
        resolve(value);
      },
      (error) => {
        signal.removeEventListener('abort', onAbort);
        reject(error);
      },
    );
  });
}

function defaultStateDir(): string {
  const state = process.env['AGENTCONFIGING_STATE_DIR'];
  if (state?.trim()) return path.resolve(state);
  const xdg = process.env['XDG_STATE_HOME'];
  return path.join(xdg?.trim() || path.join(os.homedir(), '.local', 'state'), 'agentconfiging');
}

async function readBounded(
  response: Awaited<ReturnType<HttpFetch>>,
  maxBytes: number,
): Promise<Uint8Array> {
  const length = response.headers.get('content-length');
  if (length !== null && Number(length) > maxBytes) throw new Error('response exceeds byte cap');
  if (!response.body) {
    const bytes = new TextEncoder().encode(await response.text());
    if (bytes.byteLength > maxBytes) throw new Error('response exceeds byte cap');
    return bytes;
  }
  const chunks: Uint8Array[] = [];
  let size = 0;
  for await (const chunk of response.body) {
    const bytes = typeof chunk === 'string' ? new TextEncoder().encode(chunk) : chunk;
    size += bytes.byteLength;
    if (size > maxBytes) {
      response.discard?.();
      throw new Error('response exceeds byte cap');
    }
    chunks.push(bytes);
  }
  const result = new Uint8Array(size);
  let offset = 0;
  for (const chunk of chunks) {
    result.set(chunk, offset);
    offset += chunk.byteLength;
  }
  return result;
}

function officialHttpSources(profile: AgentProfile): ProfileSource[] {
  return profile.sources.filter(
    (source) =>
      source.retrievalPolicy.method === 'http' &&
      source.url !== undefined &&
      source.kind !== 'independent-docs',
  );
}

/** Exact canonical-source matching prevents callers from turning audit into an SSRF primitive. */
export function assertAllowlistedProfileSource(
  profile: AgentProfile,
  source: ProfileSource,
): string {
  if (
    !source.url ||
    !officialHttpSources(profile).some((item) => item.id === source.id && item.url === source.url)
  )
    throw new RegistryFetchError(
      `source ${source.id} is not in the canonical official-source allowlist`,
    );
  assertFetchableUrl(source.url, false);
  return source.url;
}

export async function fetchProfileSource(
  profile: AgentProfile,
  source: ProfileSource,
  opts: Required<Pick<AuditOptions, 'fetch' | 'maxBytes' | 'timeoutMs'>>,
  resolveHost: HostResolver,
  prior?: { etag?: string; lastModified?: string },
): Promise<{ bytes: Uint8Array; etag?: string; lastModified?: string }> {
  let url = assertAllowlistedProfileSource(profile, source);
  const allowed = new Set([source.url, ...(source.retrievalPolicy.allowedRedirectUrls ?? [])]);
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), opts.timeoutMs);
  try {
    for (let redirects = 0; redirects <= 3; redirects++) {
      const parsed = new URL(url);
      const addresses = await abortable(resolveHost(parsed.hostname), controller.signal);
      if (!addresses.length || addresses.some((address) => isBlockedRegistryHost(address)))
        throw new RegistryFetchError(`refusing private or local address for ${parsed.hostname}`);
      const response = await opts.fetch(url, {
        signal: controller.signal,
        redirect: 'manual',
        resolvedAddress: addresses[0],
        headers: {
          ...(prior?.etag ? { 'if-none-match': prior.etag } : {}),
          ...(prior?.lastModified ? { 'if-modified-since': prior.lastModified } : {}),
          accept: 'text/html,application/json,text/plain;q=0.9',
          'user-agent': 'agentconfiging-profile-audit/1',
        },
      });
      if ([301, 302, 303, 307, 308].includes(response.status)) {
        const location = response.headers.get('location');
        if (!location) throw new Error('redirect has no location');
        const next = new URL(location, url).toString();
        assertFetchableUrl(next, false);
        if (!allowed.has(next))
          throw new Error('redirect target is not an allowlisted canonical source');
        url = next;
        continue;
      }
      if (response.status === 304 && prior) {
        throw new Error('not-modified');
      }
      if (!response.ok) throw new Error(`HTTP ${response.status}`);
      return {
        bytes: await readBounded(response, opts.maxBytes),
        ...(response.headers.get('etag') ? { etag: response.headers.get('etag')! } : {}),
        ...(response.headers.get('last-modified')
          ? { lastModified: response.headers.get('last-modified')! }
          : {}),
      };
    }
    throw new Error('too many redirects');
  } finally {
    clearTimeout(timer);
  }
}

function decodeEntities(value: string): string {
  return value
    .replace(/&sol;|&#x2f;|&#47;/gi, '/')
    .replace(/&period;|&#46;/gi, '.')
    .replace(/&lowbar;|&#95;/gi, '_')
    .replace(/&hyphen;|&#45;/gi, '-')
    .replace(/&lt;/gi, '<')
    .replace(/&gt;/gi, '>')
    .replace(/&amp;/gi, '&');
}

/** Extract only code-semantic tokens; scripts, styles, comments and prose are ignored. */
export function extractInstructionPaths(profile: AgentProfile, input: string): string[] {
  if (profile.id !== 'claude-code' && profile.id !== 'codex') return [];
  const scrubbed = input
    .replace(/<!--[\s\S]*?-->/g, '')
    .replace(/<(script|style)\b[^>]*>[\s\S]*?<\/\1>/gi, '');
  const tokens: string[] = [];
  for (const match of scrubbed.matchAll(/<code\b[^>]*>([\s\S]*?)<\/code>/gi))
    tokens.push(decodeEntities(match[1]!.replace(/<[^>]*>/g, '').trim()));
  for (const match of scrubbed.replace(/<[^>]+>/g, ' ').matchAll(/`([^`\r\n]{1,240})`/g))
    tokens.push(decodeEntities(match[1]!.trim()));
  const allowed =
    profile.id === 'codex'
      ? /^(?:~\/\.codex\/)?AGENTS(?:\.override)?\.md$/
      : /^(?:~\/\.claude\/)?CLAUDE\.md$|^(?:~\/)?\.claude\/rules\/[A-Za-z0-9._@+*?/-]+\.md$/;
  return [
    ...new Set(
      tokens
        .filter((token) => token.length <= 240 && allowed.test(token))
        .map((token) =>
          profile.id === 'claude-code' && token.includes('.claude/rules/')
            ? token.startsWith('~/')
              ? '~/.claude/rules'
              : '.claude/rules'
            : token,
        ),
    ),
  ].sort();
}

export function normalizeProfileSource(profile: AgentProfile, text: string): string[] {
  const paths = new Set(extractInstructionPaths(profile, text));
  return profile.facts.instructionArtifacts
    .filter((fact) => paths.has(fact.value.path))
    .map((fact) => fact.factId)
    .sort();
}

function factSlug(value: string): string {
  return value
    .toLowerCase()
    .replace(/^~\//, 'home-')
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-|-$/g, '');
}

export function applyExtractedPaths(
  candidate: AgentProfile,
  source: ProfileSource,
  paths: string[],
  checkedAt: string,
  contentHash: string,
): string[] {
  const diagnostics: string[] = [];
  for (const artifactPath of paths) {
    const existing = candidate.facts.instructionArtifacts.find(
      (fact) => fact.value.path === artifactPath,
    );
    if (existing) {
      const evidence = existing.evidence.find((item) => item.sourceId === source.id);
      if (evidence) {
        evidence.checkedAt = checkedAt;
        evidence.contentHash = contentHash;
      } else
        existing.evidence.push({
          sourceId: source.id,
          locator: '#instructions',
          checkedAt,
          contentHash,
        });
      existing.confidence = 'verified';
      continue;
    }
    const global = artifactPath.startsWith('~/');
    const value: InstructionArtifact = {
      path: artifactPath,
      format: 'markdown',
      scope: global ? 'global' : 'project',
      layout: artifactPath.endsWith('.claude/rules') ? 'rules-dir' : 'single-file',
      ...(artifactPath.endsWith('.claude/rules') ? { rulesDirPattern: '.claude/rules/*.md' } : {}),
    };
    const fact: ProfileFact<InstructionArtifact> = {
      factId: `instruction-${global ? 'global' : 'project'}-${factSlug(artifactPath)}`,
      value,
      lifecycle: 'current',
      applicability: { observedFrom: checkedAt },
      evidence: [{ sourceId: source.id, locator: '#instructions', checkedAt, contentHash }],
      confidence: 'verified',
      lastChangedAt: checkedAt,
    };
    candidate.facts.instructionArtifacts.push(fact);
    diagnostics.push(`${source.id}: discovered ${artifactPath}`);
  }
  candidate.facts.instructionArtifacts.sort((a, b) => a.factId.localeCompare(b.factId));
  return diagnostics;
}

export function semanticProfileDiff(
  canonical: AgentProfile,
  candidate: AgentProfile,
): ProfileFactDiff[] {
  const result: ProfileFactDiff[] = [];
  const semanticFact = (fact: ProfileFact): unknown => ({
    value: fact.value,
    lifecycle: fact.lifecycle,
    replacementFactId: fact.replacementFactId,
    confidence: fact.confidence,
    lastChangedAt: fact.lastChangedAt,
    applicability: fact.applicability,
    evidence: fact.evidence
      .map((evidence) => ({
        sourceId: evidence.sourceId,
        locator: evidence.locator,
        ...(evidence.contentHash ? { contentHash: evidence.contentHash } : {}),
      }))
      .sort((a, b) =>
        `${a.sourceId}\0${a.locator}\0${a.contentHash ?? ''}`.localeCompare(
          `${b.sourceId}\0${b.locator}\0${b.contentHash ?? ''}`,
        ),
      ),
  });
  for (const area of CAPABILITY_AREAS) {
    const before = new Map(canonical.facts[area].map((fact) => [fact.factId, fact]));
    const after = new Map(candidate.facts[area].map((fact) => [fact.factId, fact]));
    for (const factId of [...new Set([...before.keys(), ...after.keys()])].sort()) {
      const prior = before.get(factId);
      const next = after.get(factId);
      if (!prior && next) result.push({ area, factId, operation: 'add', after: next });
      else if (prior && !next)
        result.push({ area, factId, operation: 'remove', before: prior, after: null });
      else if (prior && next && stableJson(semanticFact(prior)) !== stableJson(semanticFact(next)))
        result.push({ area, factId, operation: 'change', before: prior, after: next });
    }
  }
  return result.sort((a, b) => `${a.area}\0${a.factId}`.localeCompare(`${b.area}\0${b.factId}`));
}

export function validateProfileCandidate(profile: AgentProfile, now: string) {
  return validateAgentProfiles([profile], new Date(now));
}

function stableJson(value: unknown): string {
  const normalize = (item: unknown): unknown => {
    if (Array.isArray(item)) return item.map(normalize);
    if (item && typeof item === 'object')
      return Object.fromEntries(
        Object.entries(item as Record<string, unknown>)
          .sort(([a], [b]) => a.localeCompare(b))
          .map(([key, child]) => [key, normalize(child)]),
      );
    return item;
  };
  return `${JSON.stringify(normalize(value), null, 2)}\n`;
}

/** Strict current-canonical validation for UI drift indicators. No evidence bodies are needed. */
export function isCurrentProfileCandidate(
  value: unknown,
  canonical: AgentProfile,
  fileName?: string,
): value is ProfileCandidateEnvelope {
  if (!value || typeof value !== 'object') return false;
  const candidate = value as Partial<ProfileCandidateEnvelope>;
  if (
    candidate.schemaVersion !== 1 ||
    candidate.profileId !== canonical.id ||
    candidate.basedOnProfileRevision !== canonical.profileRevision ||
    candidate.validation?.valid !== true ||
    !candidate.profile ||
    candidate.profile.id !== canonical.id ||
    typeof candidate.candidateId !== 'string' ||
    !/^[a-z0-9-]+$/.test(candidate.candidateId) ||
    typeof candidate.candidateHash !== 'string' ||
    !/^sha256:[a-f0-9]{64}$/.test(candidate.candidateHash) ||
    typeof candidate.baseProfileHash !== 'string' ||
    !/^sha256:[a-f0-9]{64}$/.test(candidate.baseProfileHash) ||
    !Array.isArray(candidate.semanticDiff) ||
    !Array.isArray(candidate.sourceChanges) ||
    !Array.isArray(candidate.sourceSnapshotIds) ||
    (candidate.semanticDiff.length === 0 && candidate.sourceChanges.length === 0) ||
    (fileName !== undefined && fileName !== `${candidate.candidateId}.candidate.json`) ||
    (canonical.promotion.method === 'reviewed-candidate' &&
      canonical.promotion.candidateId === candidate.candidateId)
  )
    return false;
  const canonicalHash = sha256(new TextEncoder().encode(serializeAgentProfiles([canonical])));
  if (candidate.baseProfileHash !== canonicalHash) return false;
  const body = { ...(candidate as Record<string, unknown>) };
  delete body['candidateId'];
  delete body['candidateHash'];
  if (sha256(new TextEncoder().encode(stableJson(body))) !== candidate.candidateHash) return false;
  const expectedId = `${canonical.id}-${String(candidate.generatedAt).replace(/[^0-9]/g, '')}-${safeName(candidate.candidateHash).slice(0, 12)}`;
  if (candidate.candidateId !== expectedId) return false;
  if (validateProfileCandidate(candidate.profile, candidate.generatedAt ?? '').length) return false;
  const recomputed = semanticProfileDiff(canonical, candidate.profile);
  if (stableJson(recomputed) !== stableJson(candidate.semanticDiff)) return false;
  const canonicalSources = new Map(canonical.sources.map((source) => [source.id, source]));
  const candidateSources = new Map(candidate.profile.sources.map((source) => [source.id, source]));
  return candidate.sourceChanges.every((change) => {
    if (!change || change.requiresManualExtraction !== true) return false;
    const before = canonicalSources.get(change.sourceId)?.latestSuccessfulRetrieval?.contentHash;
    const after = candidateSources.get(change.sourceId)?.latestSuccessfulRetrieval?.contentHash;
    return Boolean(
      canonicalSources.has(change.sourceId) &&
      /^sha256:[a-f0-9]{64}$/.test(change.afterContentHash) &&
      change.afterContentHash === after &&
      change.beforeContentHash === before &&
      candidate.sourceSnapshotIds!.includes(`${change.sourceId}@${change.afterContentHash}`),
    );
  });
}

export interface PublicProfileAuditResult {
  profileId: string;
  status: ProfileAuditStatus;
  sourceIds: string[];
  unresolvedSourceIds: string[];
  changes: string[];
  errorCategories: Array<'usage' | 'source-unavailable' | 'validation' | 'extraction-unavailable'>;
}

/** Content-safe audit result for CLI/stdout. Internal paths, hashes and model diagnostics stay private. */
export function publicProfileAuditResult(result: ProfileAuditResult): PublicProfileAuditResult {
  const categories = new Set<PublicProfileAuditResult['errorCategories'][number]>();
  for (const error of result.errors) {
    if (/unknown profile|cadence|non-fetchable source/i.test(error)) categories.add('usage');
    else if (/Codex-assisted|isolated runner/i.test(error))
      categories.add('extraction-unavailable');
    else if (result.status === 'fetch-failure') categories.add('source-unavailable');
    else categories.add('validation');
  }
  return {
    profileId: result.profileId,
    status: result.status,
    sourceIds: [...new Set(result.evidence.map((item) => item.sourceId))].sort(),
    unresolvedSourceIds: [...new Set(result.unresolvedSourceIds ?? [])].sort(),
    changes: [...result.changes].sort(),
    errorCategories: [...categories].sort(),
  };
}

export function buildCandidateEnvelope(
  canonical: AgentProfile,
  candidate: AgentProfile,
  snapshots: string[],
  generatedAt: string,
  diagnostics: string[],
  uncertainties: string[],
  sourceChanges: ProfileCandidateEnvelope['sourceChanges'] = [],
): ProfileCandidateEnvelope {
  const semanticDiff = semanticProfileDiff(canonical, candidate);
  const validationIssues = validateProfileCandidate(candidate, generatedAt);
  const baseProfileHash = sha256(new TextEncoder().encode(serializeAgentProfiles([canonical])));
  const body = {
    schemaVersion: 1 as const,
    profileId: canonical.id,
    basedOnProfileRevision: canonical.profileRevision,
    baseProfileHash,
    sourceSnapshotIds: [...snapshots].sort(),
    generatedAt,
    profile: candidate,
    semanticDiff,
    sourceChanges: [...sourceChanges].sort((a, b) => a.sourceId.localeCompare(b.sourceId)),
    extraction: { diagnostics: [...diagnostics].sort(), uncertainties: [...uncertainties].sort() },
    validation: { valid: validationIssues.length === 0, issues: validationIssues },
  };
  const candidateHash = sha256(new TextEncoder().encode(stableJson(body)));
  return {
    ...body,
    candidateId: `${canonical.id}-${generatedAt.replace(/[^0-9]/g, '')}-${safeName(candidateHash).slice(0, 12)}`,
    candidateHash,
  };
}

export function reportProfileAudit(result: ProfileAuditResult): string {
  return stableJson(result);
}

export async function auditAgentProfile(options: AuditOptions): Promise<ProfileAuditResult> {
  if (options.cadence !== undefined && !['daily', 'weekly', 'monthly'].includes(options.cadence))
    return {
      profileId: options.profileId,
      status: 'invalid',
      changes: [],
      errors: ['invalid audit cadence'],
      evidence: [],
    };
  const profile = getAgentProfile(options.profileId);
  if (!profile)
    return {
      profileId: options.profileId,
      status: 'invalid',
      changes: [],
      errors: ['unknown profile'],
      evidence: [],
    };
  let candidate = structuredClone(profile);
  const cacheDir = options.cacheDir ?? path.join(defaultStateDir(), 'profile-audit-cache');
  const candidateDir = options.candidateDir ?? path.join(defaultStateDir(), 'profile-candidates');
  const now = (options.now ?? (() => new Date()))()
    .toISOString()
    .replace(/\.\d{3}Z$/, 'Z');
  const result: ProfileAuditResult = {
    profileId: profile.id,
    status: 'clean',
    changes: [],
    errors: [],
    evidence: [],
  };
  const diagnostics: string[] = [];
  const uncertainties: string[] = [];
  const sourceChanges: ProfileCandidateEnvelope['sourceChanges'] = [];
  const snapshotIds: string[] = [];
  const cachedEvidence: CachedEvidenceSnapshot[] = [];
  const allSources = officialHttpSources(profile);
  const cadence = options.cadence;
  const sources = options.sourceIds?.length
    ? allSources
    : cadence === 'daily' || cadence === 'weekly'
      ? allSources.filter((source) => source.retrievalPolicy.maxAgeDays <= 7)
      : allSources;
  const requested = options.sourceIds?.length ? new Set(options.sourceIds) : undefined;
  if (requested) {
    const known = new Set(allSources.map((source) => source.id));
    const unknown = [...requested].filter((id) => !known.has(id));
    if (unknown.length)
      return {
        profileId: profile.id,
        status: 'invalid',
        changes: [],
        errors: [`unknown or non-fetchable source: ${unknown.sort().join(', ')}`],
        evidence: [],
      };
  }
  for (const source of requested ? sources.filter((item) => requested.has(item.id)) : sources) {
    try {
      const metadataDir = path.join(cacheDir, 'metadata', profile.id);
      const metadataPath = path.join(metadataDir, `${source.id}.json`);
      let prior: { etag?: string; lastModified?: string; contentHash?: string } | undefined;
      try {
        const parsed: unknown = JSON.parse(await fs.readFile(metadataPath, 'utf8'));
        if (parsed && typeof parsed === 'object') {
          const value = parsed as Record<string, unknown>;
          prior = {
            ...(typeof value['etag'] === 'string' ? { etag: value['etag'] } : {}),
            ...(typeof value['lastModified'] === 'string'
              ? { lastModified: value['lastModified'] }
              : {}),
            ...(typeof value['contentHash'] === 'string' &&
            /^sha256:[a-f0-9]{64}$/.test(value['contentHash'])
              ? { contentHash: value['contentHash'] }
              : {}),
          };
        }
      } catch {
        /* missing or hostile metadata is only a cache miss */
      }
      let fetched: { bytes: Uint8Array; etag?: string; lastModified?: string };
      try {
        fetched = await fetchProfileSource(
          profile,
          source,
          {
            fetch: options.fetch ?? defaultPinnedHttpFetch,
            maxBytes: options.maxBytes ?? PROFILE_AUDIT_MAX_BYTES,
            timeoutMs: options.timeoutMs ?? PROFILE_AUDIT_TIMEOUT_MS,
          },
          options.resolveHost ?? defaultHostResolver,
          prior,
        );
      } catch (error) {
        if (!(error instanceof Error) || error.message !== 'not-modified' || !prior?.contentHash)
          throw error;
        const cached = await fs.readFile(
          path.join(cacheDir, 'sha256', safeName(prior.contentHash)),
        );
        if (sha256(cached) !== prior.contentHash)
          throw new Error('content-addressed cache is corrupt', { cause: error });
        fetched = {
          bytes: cached,
          ...(prior.etag ? { etag: prior.etag } : {}),
          ...(prior.lastModified ? { lastModified: prior.lastModified } : {}),
        };
      }
      const hash = sha256(fetched.bytes);
      const canonicalSource = profile.sources.find((item) => item.id === source.id)!;
      const canonicalHash = canonicalSource.latestSuccessfulRetrieval?.contentHash;
      const changed = canonicalHash !== hash;
      const evidenceDir = path.join(cacheDir, 'sha256');
      const cachePath = path.join(evidenceDir, safeName(hash));
      await fs.mkdir(evidenceDir, { recursive: true });
      await fs
        .writeFile(cachePath, fetched.bytes, { flag: 'wx' })
        .catch(async (error: NodeJS.ErrnoException) => {
          if (error.code !== 'EEXIST') throw error;
          const existing = await fs.readFile(cachePath);
          if (sha256(existing) !== hash)
            throw new Error('content-addressed cache is corrupt', { cause: error });
        });
      await fs.mkdir(metadataDir, { recursive: true });
      await fs.writeFile(
        metadataPath,
        `${JSON.stringify({ contentHash: hash, ...(fetched.etag ? { etag: fetched.etag } : {}), ...(fetched.lastModified ? { lastModified: fetched.lastModified } : {}) })}\n`,
      );
      const candidateSource = candidate.sources.find((item) => item.id === source.id)!;
      candidateSource.latestSuccessfulRetrieval = { retrievedAt: now, contentHash: hash };
      candidateSource.freshness = { status: 'fresh' };
      if (!options.metadataOnly && source.covers.includes('instructionArtifacts')) {
        const paths = extractInstructionPaths(
          profile,
          new TextDecoder('utf-8', { fatal: true }).decode(fetched.bytes),
        );
        diagnostics.push(...applyExtractedPaths(candidate, source, paths, now, hash));
        if (paths.length === 0)
          uncertainties.push(
            `${source.id}: no instruction artifacts extracted; absence is not removal evidence`,
          );
      }
      snapshotIds.push(`${source.id}@${hash}`);
      cachedEvidence.push({
        sourceId: source.id,
        contentHash: hash,
        body: new TextDecoder('utf-8', { fatal: true }).decode(fetched.bytes),
      });
      const hasDeterministicExtractor =
        source.covers.includes('instructionArtifacts') &&
        (profile.id === 'claude-code' || profile.id === 'codex');
      if (!options.metadataOnly && changed && !hasDeterministicExtractor) {
        sourceChanges.push({
          sourceId: source.id,
          ...(canonicalHash ? { beforeContentHash: canonicalHash } : {}),
          afterContentHash: hash,
          requiresManualExtraction: true,
        });
        uncertainties.push(
          `${source.id}: source content changed; manual extraction required for ${source.covers.join(', ') || 'declared capability areas'}`,
        );
      }
      result.evidence.push({ sourceId: source.id, url: source.url!, contentHash: hash, cachePath });
    } catch (error) {
      const message = `${source.id}: ${error instanceof Error ? error.message : String(error)}`;
      if (source.required) result.errors.push(message);
      else diagnostics.push(`optional source unavailable: ${message}`);
      result.unresolvedSourceIds = [...(result.unresolvedSourceIds ?? []), source.id].sort();
    }
  }
  if (options.metadataOnly) {
    if (diagnostics.length) result.diagnostics = [...diagnostics].sort();
    result.status = result.errors.length ? 'fetch-failure' : 'clean';
    return result;
  }
  if (options.codexAssisted) {
    if (!options.codexRunner) {
      result.status = 'invalid';
      result.errors.push('Codex-assisted extraction unavailable: no verified isolated runner');
      if (diagnostics.length) result.diagnostics = [...diagnostics].sort();
      return result;
    } else {
      try {
        const { extractProfileWithCodex } = await import('./codex-extractor.js');
        const extracted = await extractProfileWithCodex({
          profile: candidate,
          evidence: cachedEvidence,
          checkedAt: now,
          runner: options.codexRunner,
        });
        candidate = extracted.profile;
        uncertainties.push(...extracted.uncertainties);
        diagnostics.push(
          `Codex-assisted extraction accepted ${extracted.changes.length} cited changes`,
        );
      } catch (error) {
        diagnostics.push(
          `Codex-assisted extraction unavailable: ${error instanceof Error ? error.message : String(error)}`,
        );
      }
    }
  }
  const issues = validateProfileCandidate(candidate, now);
  if (diagnostics.length) result.diagnostics = [...diagnostics].sort();
  if (issues.length) {
    result.status = 'invalid';
    result.errors.push(...issues.map((issue) => `${issue.path}: ${issue.message}`));
  } else if (result.errors.length) result.status = 'fetch-failure';
  const diff = semanticProfileDiff(profile, candidate);
  if (result.status === 'clean') {
    result.changes = [
      ...diff.map((item) => `${item.operation}:${item.area}:${item.factId}`),
      ...sourceChanges.map((item) => `source-change:${item.sourceId}:manual-extraction-required`),
    ];
    if (diff.length || sourceChanges.length) result.status = 'drift';
  }
  if (result.status === 'drift' || result.status === 'invalid') {
    const envelope = buildCandidateEnvelope(
      profile,
      candidate,
      snapshotIds,
      now,
      diagnostics,
      uncertainties,
      sourceChanges,
    );
    await fs.mkdir(candidateDir, { recursive: true });
    const candidatePath = path.join(candidateDir, `${envelope.candidateId}.candidate.json`);
    const serialized = stableJson(envelope);
    await fs
      .writeFile(candidatePath, serialized, { flag: 'wx' })
      .catch(async (error: NodeJS.ErrnoException) => {
        if (error.code !== 'EEXIST' || (await fs.readFile(candidatePath, 'utf8')) !== serialized)
          throw error;
      });
    result.candidatePath = candidatePath;
  }
  return result;
}
