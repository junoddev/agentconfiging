import { CAPABILITY_AREAS } from './types.js';
import { BASELINE_RUNTIME_FORMATS } from './baseline.js';
import type { AgentProfile, ProfileFact, ProfileValidationIssue } from './types.js';

const KEBAB = /^[a-z0-9]+(?:-[a-z0-9]+)*$/;
const RFC3339 = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}Z$/;
const HASH = /^sha256:[a-f0-9]{64}$/;
const SEMVER =
  /^(0|[1-9]\d*)\.(0|[1-9]\d*)\.(0|[1-9]\d*)(?:-([0-9A-Za-z-]+(?:\.[0-9A-Za-z-]+)*))?(?:\+[0-9A-Za-z-]+(?:\.[0-9A-Za-z-]+)*)?$/;
const CALVER = /^(\d{4})\.(0?[1-9]|1[0-2])(?:\.(0?[1-9]|[12]\d|3[01]))?(?:\.(0|[1-9]\d*))?$/;
const LINE_ONLY = /^(?:line|lines|l)?\s*\d+(?:\s*[-:]\s*\d+)?$/i;

const COVERAGES = new Set(['full', 'partial', 'unknown', 'unsupported']);
const LIFECYCLES = new Set(['current', 'legacy', 'deprecated', 'removed']);
const CONFIDENCES = new Set(['verified', 'corroborated', 'inferred', 'unknown']);
const SOURCE_KINDS = new Set([
  'official-product',
  'official-config',
  'official-schema',
  'official-release-notes',
  'independent-docs',
  'cli-probe',
]);
const VERSION_SCHEMES = new Set(['semver', 'calver', 'opaque', 'rolling']);
const CHANNELS = new Set(['stable', 'beta', 'nightly']);
const PLATFORMS = new Set(['darwin', 'linux', 'windows']);
const INTERFACES = new Set(['cli', 'ide', 'desktop', 'web']);

function record(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function validateShape(value: unknown, issues: ProfileValidationIssue[]): value is AgentProfile[] {
  if (!Array.isArray(value)) {
    issues.push({ path: '$', message: 'must be an array of agent profiles' });
    return false;
  }
  const string = (value: unknown, path: string): value is string => {
    if (typeof value === 'string') return true;
    issues.push({ path, message: 'must be a string' });
    return false;
  };
  const stringArray = (value: unknown, path: string): value is string[] => {
    if (!Array.isArray(value)) {
      issues.push({ path, message: 'must be an array' });
      return false;
    }
    value.forEach((item, index) => string(item, `${path}[${index}]`));
    return value.every((item) => typeof item === 'string');
  };
  const enumValue = (value: unknown, path: string, allowed: Set<string>): void => {
    if (!string(value, path) || !allowed.has(value))
      if (typeof value === 'string') issues.push({ path, message: 'has an unsupported value' });
  };

  value.forEach((candidate, pi) => {
    const root = `[${pi}]`;
    if (!record(candidate)) {
      issues.push({ path: root, message: 'must be an object' });
      return;
    }
    if (candidate.schemaVersion !== 1)
      issues.push({ path: `${root}.schemaVersion`, message: 'must equal 1' });
    if (!Number.isInteger(candidate.profileRevision))
      issues.push({ path: `${root}.profileRevision`, message: 'must be an integer' });
    for (const key of ['id', 'displayName', 'vendor', 'productFamily'])
      string(candidate[key], `${root}.${key}`);
    stringArray(candidate.aliases, `${root}.aliases`);
    if (!Array.isArray(candidate.sources))
      issues.push({ path: `${root}.sources`, message: 'must be an array' });
    else
      candidate.sources.forEach((source, si) => {
        const path = `${root}.sources[${si}]`;
        if (!record(source)) return issues.push({ path, message: 'must be an object' });
        string(source.id, `${path}.id`);
        enumValue(source.kind, `${path}.kind`, SOURCE_KINDS);
        if (source.url !== undefined) string(source.url, `${path}.url`);
        if (source.command !== undefined) stringArray(source.command, `${path}.command`);
        if (typeof source.required !== 'boolean')
          issues.push({ path: `${path}.required`, message: 'must be a boolean' });
        if (stringArray(source.covers, `${path}.covers`))
          source.covers.forEach((area, ai) => {
            if (!(CAPABILITY_AREAS as readonly string[]).includes(area))
              issues.push({
                path: `${path}.covers[${ai}]`,
                message: 'has an unsupported capability area',
              });
          });
        enumValue(source.versionScheme, `${path}.versionScheme`, VERSION_SCHEMES);
        if (!record(source.retrievalPolicy))
          issues.push({ path: `${path}.retrievalPolicy`, message: 'must be an object' });
        else {
          enumValue(
            source.retrievalPolicy.method,
            `${path}.retrievalPolicy.method`,
            new Set(['http', 'command']),
          );
          if (!Number.isInteger(source.retrievalPolicy.maxAgeDays))
            issues.push({
              path: `${path}.retrievalPolicy.maxAgeDays`,
              message: 'must be an integer',
            });
          if (source.retrievalPolicy.allowedRedirectUrls !== undefined)
            stringArray(
              source.retrievalPolicy.allowedRedirectUrls,
              `${path}.retrievalPolicy.allowedRedirectUrls`,
            );
        }
        if (source.latestSuccessfulRetrieval !== undefined) {
          if (!record(source.latestSuccessfulRetrieval))
            issues.push({
              path: `${path}.latestSuccessfulRetrieval`,
              message: 'must be an object',
            });
          else {
            string(
              source.latestSuccessfulRetrieval.retrievedAt,
              `${path}.latestSuccessfulRetrieval.retrievedAt`,
            );
            string(
              source.latestSuccessfulRetrieval.contentHash,
              `${path}.latestSuccessfulRetrieval.contentHash`,
            );
          }
        }
        if (!record(source.freshness))
          issues.push({ path: `${path}.freshness`, message: 'must be an object' });
        else {
          enumValue(
            source.freshness.status,
            `${path}.freshness.status`,
            new Set(['fresh', 'stale', 'expired', 'unavailable']),
          );
          if (source.freshness.reason !== undefined)
            string(source.freshness.reason, `${path}.freshness.reason`);
        }
      });
    if (!record(candidate.maintainer))
      issues.push({ path: `${root}.maintainer`, message: 'must be an object' });
    else {
      enumValue(
        candidate.maintainer.supportTier,
        `${root}.maintainer.supportTier`,
        new Set(['first-class', 'profile-sync-only']),
      );
      for (const key of ['owner', 'scaffoldPath', 'scaffoldTemplate', 'docsUrl'])
        string(candidate.maintainer[key], `${root}.maintainer.${key}`);
      enumValue(
        candidate.maintainer.confidence,
        `${root}.maintainer.confidence`,
        new Set(['verified', 'unverified']),
      );
      if (candidate.maintainer.detectorId !== undefined)
        string(candidate.maintainer.detectorId, `${root}.maintainer.detectorId`);
      stringArray(candidate.maintainer.detectionMarkers, `${root}.maintainer.detectionMarkers`);
    }
    if (!record(candidate.coverage))
      issues.push({ path: `${root}.coverage`, message: 'must be an object' });
    if (!record(candidate.facts))
      issues.push({ path: `${root}.facts`, message: 'must be an object' });
    for (const area of CAPABILITY_AREAS) {
      if (record(candidate.coverage))
        enumValue(candidate.coverage[area], `${root}.coverage.${area}`, COVERAGES);
      const facts = record(candidate.facts) ? candidate.facts[area] : undefined;
      if (!Array.isArray(facts)) {
        if (record(candidate.facts))
          issues.push({ path: `${root}.facts.${area}`, message: 'must be an array' });
        continue;
      }
      facts.forEach((fact, fi) => {
        const path = `${root}.facts.${area}[${fi}]`;
        if (!record(fact)) return issues.push({ path, message: 'must be an object' });
        string(fact.factId, `${path}.factId`);
        enumValue(fact.lifecycle, `${path}.lifecycle`, LIFECYCLES);
        enumValue(fact.confidence, `${path}.confidence`, CONFIDENCES);
        if (fact.replacementFactId !== undefined)
          string(fact.replacementFactId, `${path}.replacementFactId`);
        if (fact.lastChangedAt !== undefined) string(fact.lastChangedAt, `${path}.lastChangedAt`);
        if (!record(fact.applicability))
          issues.push({ path: `${path}.applicability`, message: 'must be an object' });
        else {
          for (const key of ['since', 'until', 'observedFrom', 'observedUntil'])
            if (fact.applicability[key] !== undefined)
              string(fact.applicability[key], `${path}.applicability.${key}`);
          for (const key of ['channels', 'platforms', 'interfaces'])
            if (fact.applicability[key] !== undefined) {
              const listPath = `${path}.applicability.${key}`;
              if (stringArray(fact.applicability[key], listPath)) {
                const allowed =
                  key === 'channels' ? CHANNELS : key === 'platforms' ? PLATFORMS : INTERFACES;
                fact.applicability[key].forEach((item, index) => {
                  if (!allowed.has(item))
                    issues.push({
                      path: `${listPath}[${index}]`,
                      message: 'has an unsupported value',
                    });
                });
              }
            }
        }
        if (!Array.isArray(fact.evidence))
          issues.push({ path: `${path}.evidence`, message: 'must be an array' });
        else
          fact.evidence.forEach((evidence, ei) => {
            const ep = `${path}.evidence[${ei}]`;
            if (!record(evidence)) return issues.push({ path: ep, message: 'must be an object' });
            for (const key of ['sourceId', 'locator', 'checkedAt'])
              string(evidence[key], `${ep}.${key}`);
            if (evidence.contentHash !== undefined)
              string(evidence.contentHash, `${ep}.contentHash`);
          });
        if (area === 'instructionArtifacts') {
          if (!record(fact.value))
            issues.push({
              path: `${path}.value`,
              message: 'must be an instruction artifact object',
            });
          else {
            string(fact.value.path, `${path}.value.path`);
            enumValue(fact.value.scope, `${path}.value.scope`, new Set(['project', 'global']));
            enumValue(
              fact.value.format,
              `${path}.value.format`,
              new Set(['markdown', 'frontmattered-markdown']),
            );
            enumValue(
              fact.value.layout,
              `${path}.value.layout`,
              new Set(['single-file', 'rules-dir', 'hybrid']),
            );
            for (const key of ['loadBehavior', 'rulesDirPattern'])
              if (fact.value[key] !== undefined) string(fact.value[key], `${path}.value.${key}`);
          }
        }
      });
    }
    if (candidate.observedProductVersion !== undefined)
      string(candidate.observedProductVersion, `${root}.observedProductVersion`);
    if (!record(candidate.promotion))
      issues.push({ path: `${root}.promotion`, message: 'must be an object' });
    else {
      enumValue(
        candidate.promotion.method,
        `${root}.promotion.method`,
        new Set(['baseline-import', 'reviewed-candidate']),
      );
      for (const key of ['promotedAt', 'promoterId'])
        string(candidate.promotion[key], `${root}.promotion.${key}`);
      if (candidate.promotion.method === 'baseline-import')
        string(candidate.promotion.provenance, `${root}.promotion.provenance`);
      if (candidate.promotion.method === 'reviewed-candidate') {
        for (const key of ['candidateId', 'candidateHash', 'canonicalHash'])
          string(candidate.promotion[key], `${root}.promotion.${key}`);
        if (!Number.isInteger(candidate.promotion.basedOnProfileRevision))
          issues.push({
            path: `${root}.promotion.basedOnProfileRevision`,
            message: 'must be an integer',
          });
        if (!Array.isArray(candidate.promotion.approvals))
          issues.push({ path: `${root}.promotion.approvals`, message: 'must be an array' });
        else
          candidate.promotion.approvals.forEach((approval, index) => {
            const path = `${root}.promotion.approvals[${index}]`;
            if (!record(approval)) return issues.push({ path, message: 'must be an object' });
            for (const key of ['approverId', 'approvedAt']) string(approval[key], `${path}.${key}`);
            enumValue(approval.decision, `${path}.decision`, new Set(['approve', 'reject']));
            if (approval.comment !== undefined) string(approval.comment, `${path}.comment`);
          });
      }
    }
  });
  return issues.length === 0;
}

function safePath(path: string, global: boolean): boolean {
  if (!path || path.includes('\\') || path.includes('\0') || path.startsWith('/')) return false;
  const candidate = (global && path.startsWith('~/') ? path.slice(2) : path).replace(/\/$/, '');
  if (global && !path.startsWith('~/')) return false;
  return (
    /^[A-Za-z0-9._/@+-]+$/.test(candidate) &&
    !candidate.split('/').some((part) => part === '..' || part === '.' || part === '')
  );
}

function safeGlob(path: string): boolean {
  return (
    safePath(path.replaceAll('*', 'x'), false) &&
    !path.includes('**') &&
    /^[A-Za-z0-9._/*-]+$/.test(path)
  );
}

function listsOverlap(left?: readonly string[], right?: readonly string[]): boolean {
  return !left || !right || left.some((item) => right.includes(item));
}

function applicabilityOverlaps(
  left: ProfileFact['applicability'],
  right: ProfileFact['applicability'],
): boolean {
  if (
    !listsOverlap(left.channels, right.channels) ||
    !listsOverlap(left.platforms, right.platforms) ||
    !listsOverlap(left.interfaces, right.interfaces)
  )
    return false;
  if (
    left.observedUntil &&
    right.observedFrom &&
    Date.parse(left.observedUntil) <= Date.parse(right.observedFrom)
  )
    return false;
  if (
    right.observedUntil &&
    left.observedFrom &&
    Date.parse(right.observedUntil) <= Date.parse(left.observedFrom)
  )
    return false;
  if (
    left.until &&
    right.since &&
    left.until.localeCompare(right.since, undefined, { numeric: true }) < 0
  )
    return false;
  if (
    right.until &&
    left.since &&
    right.until.localeCompare(left.since, undefined, { numeric: true }) < 0
  )
    return false;
  return true;
}

function sameCapabilityTarget(left: unknown, right: unknown): boolean {
  if (
    record(left) &&
    record(right) &&
    typeof left.path === 'string' &&
    typeof right.path === 'string'
  )
    return left.path === right.path;
  // Scalar inventories (models, tools, hook names) contain independent values,
  // so differing scalars are not competing claims about one target.
  return JSON.stringify(left) === JSON.stringify(right);
}

function timestamp(value: string, path: string, now: Date, issues: ProfileValidationIssue[]): void {
  const parsed = Date.parse(value);
  if (
    !RFC3339.test(value) ||
    Number.isNaN(parsed) ||
    new Date(parsed).toISOString().replace('.000Z', 'Z') !== value
  )
    issues.push({ path, message: 'must be a UTC RFC 3339 timestamp with seconds and Z' });
  else if (Date.parse(value) > now.getTime())
    issues.push({ path, message: 'must not be in the future' });
}

function validVersion(value: string, scheme: 'semver' | 'calver' | 'opaque'): boolean {
  if (!value.trim()) return false;
  if (scheme === 'semver') {
    const match = SEMVER.exec(value);
    return Boolean(
      match &&
      !match[4]
        ?.split('.')
        .some(
          (identifier) =>
            /^\d+$/.test(identifier) && identifier.length > 1 && identifier.startsWith('0'),
        ),
    );
  }
  if (scheme === 'calver') {
    const match = CALVER.exec(value);
    if (!match) return false;
    if (match[3]) {
      const date = new Date(Date.UTC(Number(match[1]), Number(match[2]) - 1, Number(match[3])));
      return (
        date.getUTCFullYear() === Number(match[1]) &&
        date.getUTCMonth() + 1 === Number(match[2]) &&
        date.getUTCDate() === Number(match[3])
      );
    }
  }
  return true;
}

function compareVersion(left: string, right: string, scheme: 'semver' | 'calver'): number {
  if (scheme === 'semver') {
    const a = SEMVER.exec(left);
    const b = SEMVER.exec(right);
    if (a && b) {
      for (const index of [1, 2, 3]) {
        const difference = Number(a[index]) - Number(b[index]);
        if (difference) return difference;
      }
      const leftPre = a[4]?.split('.');
      const rightPre = b[4]?.split('.');
      if (!leftPre && !rightPre) return 0;
      if (!leftPre) return 1;
      if (!rightPre) return -1;
      for (let index = 0; index < Math.max(leftPre.length, rightPre.length); index += 1) {
        const l = leftPre[index];
        const r = rightPre[index];
        if (l === undefined) return -1;
        if (r === undefined) return 1;
        if (l === r) continue;
        const lNumeric = /^\d+$/.test(l);
        const rNumeric = /^\d+$/.test(r);
        if (lNumeric && rNumeric) return Number(l) - Number(r);
        if (lNumeric !== rNumeric) return lNumeric ? -1 : 1;
        return l < r ? -1 : 1;
      }
      return 0;
    }
  }
  return left.localeCompare(right, undefined, { numeric: true, sensitivity: 'case' });
}

export function validateAgentProfiles(
  profiles: unknown,
  now = new Date(),
): ProfileValidationIssue[] {
  const issues: ProfileValidationIssue[] = [];
  if (!validateShape(profiles, issues)) return issues;
  if (!(now instanceof Date) || Number.isNaN(now.getTime())) {
    issues.push({ path: '$now', message: 'must be a valid Date' });
    return issues;
  }
  const profileIds = new Set<string>();
  const aliases = new Set<string>();
  const factLookup = new Map<string, ProfileFact>();

  for (const [pi, profile] of profiles.entries()) {
    const root = `[${pi}]`;
    for (const key of Object.keys(profile.coverage))
      if (!(CAPABILITY_AREAS as readonly string[]).includes(key))
        issues.push({ path: `${root}.coverage.${key}`, message: 'unknown capability area' });
    for (const key of Object.keys(profile.facts))
      if (!(CAPABILITY_AREAS as readonly string[]).includes(key))
        issues.push({ path: `${root}.facts.${key}`, message: 'unknown capability area' });
    if (!KEBAB.test(profile.id)) issues.push({ path: `${root}.id`, message: 'must be kebab-case' });
    for (const key of ['displayName', 'vendor', 'productFamily'] as const)
      if (!profile[key].trim())
        issues.push({ path: `${root}.${key}`, message: 'must not be empty' });
    if (profileIds.has(profile.id) || aliases.has(profile.id))
      issues.push({ path: `${root}.id`, message: 'duplicate profile id or alias' });
    profileIds.add(profile.id);
    for (const alias of profile.aliases) {
      if (!KEBAB.test(alias) || profileIds.has(alias) || aliases.has(alias))
        issues.push({ path: `${root}.aliases`, message: `invalid or duplicate alias ${alias}` });
      aliases.add(alias);
    }
    if (!Number.isInteger(profile.profileRevision) || profile.profileRevision < 1)
      issues.push({ path: `${root}.profileRevision`, message: 'must be a positive integer' });
    timestamp(profile.promotion.promotedAt, `${root}.promotion.promotedAt`, now, issues);
    if (!profile.promotion.promoterId.trim())
      issues.push({ path: `${root}.promotion.promoterId`, message: 'must not be empty' });
    if (profile.promotion.method === 'baseline-import') {
      if (!profile.promotion.provenance.trim())
        issues.push({ path: `${root}.promotion.provenance`, message: 'must not be empty' });
    } else {
      if (
        !HASH.test(profile.promotion.candidateHash) ||
        !HASH.test(profile.promotion.canonicalHash)
      )
        issues.push({
          path: `${root}.promotion`,
          message: 'candidate and canonical hashes must use SHA-256 wire format',
        });
      if (profile.promotion.basedOnProfileRevision !== profile.profileRevision - 1)
        issues.push({
          path: `${root}.promotion.basedOnProfileRevision`,
          message: 'must immediately precede profileRevision',
        });
      if (!profile.promotion.approvals.length)
        issues.push({
          path: `${root}.promotion.approvals`,
          message: 'reviewed promotion requires approval',
        });
      const approvers = new Set<string>();
      for (const [index, approval] of profile.promotion.approvals.entries()) {
        timestamp(
          approval.approvedAt,
          `${root}.promotion.approvals[${index}].approvedAt`,
          now,
          issues,
        );
        if (!approval.approverId.trim() || approvers.has(approval.approverId))
          issues.push({
            path: `${root}.promotion.approvals[${index}].approverId`,
            message: 'must be non-empty and unique',
          });
        approvers.add(approval.approverId);
        if (approval.decision === 'reject')
          issues.push({
            path: `${root}.promotion.approvals[${index}].decision`,
            message: 'rejection blocks canonical promotion',
          });
      }
    }
    if (!safePath(profile.maintainer.scaffoldPath, false))
      issues.push({ path: `${root}.maintainer.scaffoldPath`, message: 'unsafe project path' });
    if (
      new Set(profile.maintainer.detectionMarkers).size !==
      profile.maintainer.detectionMarkers.length
    )
      issues.push({ path: `${root}.maintainer.detectionMarkers`, message: 'must be unique' });
    for (const [mi, marker] of profile.maintainer.detectionMarkers.entries())
      if (!safePath(marker, false) || marker.includes('*'))
        issues.push({
          path: `${root}.maintainer.detectionMarkers[${mi}]`,
          message: 'unsafe detection marker',
        });
    if (
      profile.maintainer.supportTier === 'first-class' &&
      profile.maintainer.detectorId !== profile.id
    )
      issues.push({
        path: `${root}.maintainer.detectorId`,
        message: 'first-class detector id must equal profile id',
      });
    if (profile.maintainer.supportTier === 'profile-sync-only' && profile.maintainer.detectorId)
      issues.push({
        path: `${root}.maintainer.detectorId`,
        message: 'sync-only profiles cannot declare a detector',
      });
    const sourceIds = new Set<string>();
    let previousSourceId = '';
    for (const [si, source] of profile.sources.entries()) {
      const path = `${root}.sources[${si}]`;
      if (!KEBAB.test(source.id) || sourceIds.has(source.id))
        issues.push({ path: `${path}.id`, message: 'must be unique kebab-case' });
      sourceIds.add(source.id);
      if (source.id < previousSourceId)
        issues.push({ path, message: 'sources must be sorted by id' });
      previousSourceId = source.id;
      const isProbe = source.kind === 'cli-probe';
      if (
        isProbe &&
        (source.url || !source.command?.length || source.retrievalPolicy.method !== 'command')
      )
        issues.push({
          path,
          message: 'CLI probes require only a non-empty command and command retrieval',
        });
      if (!isProbe && (!source.url || source.command || source.retrievalPolicy.method !== 'http'))
        issues.push({ path, message: 'HTTP source requires only a URL and HTTP retrieval' });
      if (source.url) {
        try {
          if (new URL(source.url).protocol !== 'https:') throw new Error();
        } catch {
          issues.push({ path: `${path}.url`, message: 'must be a valid HTTPS URL' });
        }
      } else if (!source.command?.length) issues.push({ path, message: 'requires url or command' });
      for (const [redirectIndex, redirectUrl] of (
        source.retrievalPolicy.allowedRedirectUrls ?? []
      ).entries()) {
        try {
          if (new URL(redirectUrl).protocol !== 'https:') throw new Error();
        } catch {
          issues.push({
            path: `${path}.retrievalPolicy.allowedRedirectUrls[${redirectIndex}]`,
            message: 'must be a valid HTTPS URL',
          });
        }
      }
      if (
        source.command?.some(
          (argument, index) =>
            !argument ||
            argument.includes('\0') ||
            argument.includes('\n') ||
            (index === 0 && !/^[A-Za-z0-9._/-]+$/.test(argument)),
        )
      )
        issues.push({ path: `${path}.command`, message: 'contains an unsafe command argument' });
      if (
        new Set(source.covers).size !== source.covers.length ||
        source.covers.some((area, index) => index > 0 && source.covers[index - 1]! > area)
      )
        issues.push({ path: `${path}.covers`, message: 'must be unique and canonically sorted' });
      if (
        !Number.isInteger(source.retrievalPolicy.maxAgeDays) ||
        source.retrievalPolicy.maxAgeDays < 1
      )
        issues.push({
          path: `${path}.retrievalPolicy.maxAgeDays`,
          message: 'must be a positive integer',
        });
      if (source.latestSuccessfulRetrieval) {
        timestamp(
          source.latestSuccessfulRetrieval.retrievedAt,
          `${path}.latestSuccessfulRetrieval.retrievedAt`,
          now,
          issues,
        );
        if (!HASH.test(source.latestSuccessfulRetrieval.contentHash))
          issues.push({
            path: `${path}.latestSuccessfulRetrieval.contentHash`,
            message: 'invalid SHA-256 wire format',
          });
      }
      if (source.freshness.status !== 'unavailable' && !source.latestSuccessfulRetrieval)
        issues.push({
          path: `${path}.freshness`,
          message: 'available freshness requires successful retrieval metadata',
        });
      if (source.freshness.status === 'unavailable' && !source.freshness.reason?.trim())
        issues.push({
          path: `${path}.freshness.reason`,
          message: 'unavailable freshness requires a reason',
        });
    }
    for (const area of CAPABILITY_AREAS) {
      if (!(area in profile.coverage))
        issues.push({ path: `${root}.coverage.${area}`, message: 'coverage must be explicit' });
      if (
        (profile.coverage[area] === 'full' || profile.coverage[area] === 'partial') &&
        !profile.sources.some((s) => s.required && s.covers.includes(area))
      )
        issues.push({
          path: `${root}.coverage.${area}`,
          message: 'requires a required covering source',
        });
      if (profile.coverage[area] === 'unsupported' && profile.facts[area].length)
        issues.push({
          path: `${root}.facts.${area}`,
          message: 'unsupported capability cannot contain facts',
        });
      let previous = '';
      const priorFacts: ProfileFact[] = [];
      for (const [fi, fact] of profile.facts[area].entries()) {
        const path = `${root}.facts.${area}[${fi}]`;
        if (!KEBAB.test(fact.factId) || factLookup.has(`${profile.id}/${fact.factId}`))
          issues.push({
            path: `${path}.factId`,
            message: 'must be unique runtime-local kebab-case',
          });
        if (fact.factId < previous)
          issues.push({ path, message: 'facts must be sorted by factId' });
        previous = fact.factId;
        factLookup.set(`${profile.id}/${fact.factId}`, fact);
        for (const prior of priorFacts)
          if (
            sameCapabilityTarget(prior.value, fact.value) &&
            applicabilityOverlaps(prior.applicability, fact.applicability) &&
            JSON.stringify(prior.value) !== JSON.stringify(fact.value)
          )
            issues.push({ path, message: `overlaps ${prior.factId} with a conflicting value` });
        priorFacts.push(fact);
        if (fact.confidence !== 'unknown' && !fact.evidence.length)
          issues.push({
            path: `${path}.evidence`,
            message: 'known-confidence fact requires evidence',
          });
        let evidenceKey = '';
        for (const [ei, evidence] of fact.evidence.entries()) {
          const key = `${evidence.sourceId}\0${evidence.locator}`;
          if (key <= evidenceKey)
            issues.push({
              path: `${path}.evidence`,
              message: 'evidence must be unique and sorted by sourceId and locator',
            });
          evidenceKey = key;
          if (!sourceIds.has(evidence.sourceId))
            issues.push({ path: `${path}.evidence[${ei}].sourceId`, message: 'does not resolve' });
          if (!evidence.locator.trim() || LINE_ONLY.test(evidence.locator.trim()))
            issues.push({
              path: `${path}.evidence[${ei}].locator`,
              message: 'must be stable and not line-number-only',
            });
          const evidenceSource = profile.sources.find(
            (candidate) => candidate.id === evidence.sourceId,
          );
          if (
            evidenceSource?.kind === 'cli-probe' &&
            !/^command:[^#]+#[a-z0-9][a-z0-9-]*$/.test(evidence.locator)
          )
            issues.push({
              path: `${path}.evidence[${ei}].locator`,
              message: 'CLI locator must use command:<argv>#<section>',
            });
          if (evidenceSource?.kind === 'official-schema' && !evidence.locator.startsWith('/'))
            issues.push({
              path: `${path}.evidence[${ei}].locator`,
              message: 'schema locator must be an RFC 6901 JSON Pointer',
            });
          if (
            evidenceSource &&
            evidenceSource.kind !== 'cli-probe' &&
            evidenceSource.kind !== 'official-schema' &&
            !/^#[a-z0-9][a-z0-9-]*$/.test(evidence.locator)
          )
            issues.push({
              path: `${path}.evidence[${ei}].locator`,
              message: 'documentation locator must be a normalized fragment',
            });
          timestamp(evidence.checkedAt, `${path}.evidence[${ei}].checkedAt`, now, issues);
          const source = profile.sources.find((candidate) => candidate.id === evidence.sourceId);
          if (
            source?.latestSuccessfulRetrieval &&
            Date.parse(evidence.checkedAt) >
              Date.parse(source.latestSuccessfulRetrieval.retrievedAt)
          )
            issues.push({
              path: `${path}.evidence[${ei}].checkedAt`,
              message: 'cannot be later than source retrieval',
            });
          if (evidence.contentHash && !HASH.test(evidence.contentHash))
            issues.push({
              path: `${path}.evidence[${ei}].contentHash`,
              message: 'invalid SHA-256 wire format',
            });
        }
        if (fact.lastChangedAt) timestamp(fact.lastChangedAt, `${path}.lastChangedAt`, now, issues);
        if (
          fact.lastChangedAt &&
          fact.evidence.length &&
          fact.evidence.every(
            (evidence) => Date.parse(fact.lastChangedAt!) > Date.parse(evidence.checkedAt),
          )
        )
          issues.push({
            path: `${path}.lastChangedAt`,
            message: 'cannot be later than every evidence check',
          });
        for (const list of [
          fact.applicability.channels,
          fact.applicability.platforms,
          fact.applicability.interfaces,
        ])
          if (list && !list.length)
            issues.push({
              path: `${path}.applicability`,
              message: 'applicability lists cannot be empty',
            });
          else if (
            list &&
            (new Set(list).size !== list.length ||
              list.some((item, index) => index > 0 && list[index - 1]! > item))
          )
            issues.push({
              path: `${path}.applicability`,
              message: 'applicability lists must be unique and sorted',
            });
        const sourceSchemes = fact.evidence.map(
          (e) => profile.sources.find((s) => s.id === e.sourceId)?.versionScheme,
        );
        const definedSchemes = [
          ...new Set(
            sourceSchemes.filter(
              (scheme): scheme is NonNullable<typeof scheme> => scheme !== undefined,
            ),
          ),
        ];
        if (definedSchemes.length > 1)
          issues.push({ path: `${path}.evidence`, message: 'mixed version schemes are invalid' });
        const rolling = sourceSchemes.includes('rolling');
        if (
          rolling &&
          (fact.applicability.since || fact.applicability.until || !fact.applicability.observedFrom)
        )
          issues.push({
            path: `${path}.applicability`,
            message: 'rolling facts require observedFrom and forbid version bounds',
          });
        if (!rolling && (fact.applicability.observedFrom || fact.applicability.observedUntil))
          issues.push({
            path: `${path}.applicability`,
            message: 'versioned facts forbid observation windows',
          });
        if (fact.applicability.since && fact.applicability.until) {
          const scheme = definedSchemes[0];
          if (scheme === 'opaque' && fact.applicability.since !== fact.applicability.until)
            issues.push({
              path: `${path}.applicability`,
              message: 'opaque version bounds support equality only',
            });
          if (
            (scheme === 'semver' || scheme === 'calver') &&
            compareVersion(fact.applicability.since, fact.applicability.until, scheme) > 0
          )
            issues.push({
              path: `${path}.applicability`,
              message: 'since must not be later than until',
            });
        }
        const boundedScheme = definedSchemes[0];
        if (boundedScheme === 'semver' || boundedScheme === 'calver' || boundedScheme === 'opaque')
          for (const bound of ['since', 'until'] as const)
            if (
              fact.applicability[bound] &&
              !validVersion(fact.applicability[bound], boundedScheme)
            )
              issues.push({
                path: `${path}.applicability.${bound}`,
                message: `invalid ${boundedScheme} version`,
              });
        if (fact.applicability.observedFrom)
          timestamp(
            fact.applicability.observedFrom,
            `${path}.applicability.observedFrom`,
            now,
            issues,
          );
        if (fact.applicability.observedUntil) {
          timestamp(
            fact.applicability.observedUntil,
            `${path}.applicability.observedUntil`,
            now,
            issues,
          );
          if (
            !fact.applicability.observedFrom ||
            Date.parse(fact.applicability.observedUntil) <=
              Date.parse(fact.applicability.observedFrom)
          )
            issues.push({
              path: `${path}.applicability.observedUntil`,
              message: 'must be later than observedFrom',
            });
        }
        const value = fact.value as { path?: unknown; scope?: unknown };
        if (
          typeof value === 'object' &&
          value &&
          typeof value.path === 'string' &&
          !safePath(value.path, value.scope === 'global')
        )
          issues.push({ path: `${path}.value.path`, message: 'unsafe artifact path' });
        if (
          typeof value === 'object' &&
          value &&
          'rulesDirPattern' in value &&
          typeof (value as { rulesDirPattern?: unknown }).rulesDirPattern === 'string' &&
          !safeGlob((value as { rulesDirPattern: string }).rulesDirPattern)
        )
          issues.push({ path: `${path}.value.rulesDirPattern`, message: 'unsafe rules glob' });
      }
    }
  }
  for (const [key, fact] of factLookup)
    if (fact.replacementFactId) {
      const target = fact.replacementFactId.includes('/')
        ? fact.replacementFactId
        : `${key.split('/')[0]}/${fact.replacementFactId}`;
      const replacement = factLookup.get(target);
      if (!replacement) issues.push({ path: key, message: 'replacementFactId does not resolve' });
      else if (target === key)
        issues.push({ path: key, message: 'replacementFactId cannot reference itself' });
      else if (replacement.lifecycle === 'removed')
        issues.push({ path: key, message: 'replacementFactId resolves to removed fact' });
      const visited = new Set([key]);
      let cursor: string | undefined = target;
      while (cursor) {
        if (visited.has(cursor)) {
          issues.push({ path: key, message: 'replacementFactId forms a cycle' });
          break;
        }
        visited.add(cursor);
        const next: string | undefined = factLookup.get(cursor)?.replacementFactId;
        cursor = next ? (next.includes('/') ? next : `${cursor.split('/')[0]}/${next}`) : undefined;
      }
    }
  return issues;
}

export function assertValidAgentProfiles(profiles: readonly AgentProfile[], now?: Date): void {
  const issues = validateCanonicalAgentProfiles(profiles, now);
  if (issues.length)
    throw new Error(issues.map((issue) => `${issue.path}: ${issue.message}`).join('\n'));
}

/** Registry-only roster invariants; document validation remains usable for candidates/subsets. */
export function validateCanonicalAgentProfiles(
  profiles: unknown,
  now = new Date(),
): ProfileValidationIssue[] {
  const issues = validateAgentProfiles(profiles, now);
  if (!Array.isArray(profiles) || issues.some((issue) => issue.path === '$')) return issues;
  const records = profiles.filter(record);
  const expectedIds = [...BASELINE_RUNTIME_FORMATS].map((runtime) => runtime.id).sort();
  const actualIds = records
    .map((profile) => profile.id)
    .filter((id): id is string => typeof id === 'string')
    .sort();
  if (JSON.stringify(actualIds) !== JSON.stringify(expectedIds))
    issues.push({
      path: '$',
      message: 'canonical registry must contain the complete runtime roster exactly once',
    });
  for (const [index, profile] of records.entries()) {
    if (!Array.isArray(profile.sources)) continue;
    if (
      !profile.sources.some(
        (source) =>
          record(source) &&
          (source.kind === 'official-product' || source.kind === 'official-release-notes'),
      )
    )
      issues.push({
        path: `[${index}].sources`,
        message: 'requires an upstream product or release source',
      });
    if (
      record(profile.coverage) &&
      (profile.coverage.instructionArtifacts === 'full' ||
        profile.coverage.instructionArtifacts === 'partial') &&
      !profile.sources.some(
        (source) =>
          record(source) &&
          (source.kind === 'official-config' || source.kind === 'official-schema'),
      )
    )
      issues.push({
        path: `[${index}].sources`,
        message: 'claimed instruction coverage requires an official configuration source',
      });
  }
  return issues;
}
