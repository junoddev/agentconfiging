import fs from 'node:fs';
import path from 'node:path';
import process from 'node:process';
import { URL } from 'node:url';
import { createHash } from 'node:crypto';

const SAFE_ID = /^[a-z0-9]+(?:-[a-z0-9]+)*$/;
const SAFE_CANDIDATE_ID = /^[a-z0-9-]+$/;
const SENSITIVE = /(?:path|layout|permission|default|security|credential|auth|sandbox|deprecat)/i;

export function classifyCandidate(candidate) {
  const reasons = new Set();
  if (candidate?.validation?.valid !== true) reasons.add('invalid-candidate');
  for (const change of candidate?.semanticDiff ?? []) {
    if (change.operation === 'remove') reasons.add('removal');
    if (change.area === 'instructionArtifacts') reasons.add('path-or-layout');
    if (change.area === 'settings') reasons.add('settings-contract');
    const text = JSON.stringify({
      area: change.area,
      factId: change.factId,
      before: change.before,
      after: change.after,
    });
    if (SENSITIVE.test(text)) reasons.add('permissions-defaults-or-security');
    if (/"lifecycle":"(?:deprecated|removed)"/.test(text)) reasons.add('deprecation');
  }
  if ((candidate?.sourceChanges ?? []).some((change) => change?.requiresManualExtraction === true))
    reasons.add('manual-extraction-required');
  return { risk: reasons.size ? 'high' : 'normal', reasons: [...reasons].sort() };
}

function regularFiles(root, suffix) {
  const files = [];
  const visit = (dir) => {
    if (!fs.existsSync(dir)) return;
    for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
      const target = path.join(dir, entry.name);
      if (entry.isDirectory()) visit(target);
      else if (entry.isFile() && entry.name.endsWith(suffix)) files.push(target);
    }
  };
  visit(root);
  return files.sort();
}

function readJson(file) {
  try {
    return JSON.parse(fs.readFileSync(file, 'utf8'));
  } catch {
    return undefined;
  }
}

function stableJson(value) {
  const normalize = (item) => {
    if (Array.isArray(item)) return item.map(normalize);
    if (item && typeof item === 'object')
      return Object.fromEntries(
        Object.entries(item)
          .sort(([a], [b]) => a.localeCompare(b))
          .map(([key, child]) => [key, normalize(child)]),
      );
    return item;
  };
  return `${JSON.stringify(normalize(value), null, 2)}\n`;
}

export function computeCandidateHash(candidate) {
  const body = { ...(candidate ?? {}) };
  delete body.candidateId;
  delete body.candidateHash;
  return `sha256:${createHash('sha256').update(stableJson(body)).digest('hex')}`;
}

export function validateCandidate(
  value,
  file,
  roster,
  trustedCanonicalHashes,
  trustedCanonicalSourceHashes,
  auditRoot = path.dirname(file),
) {
  const errors = [];
  if (value?.schemaVersion !== 1) errors.push('unsupported candidate schema');
  if (!/^sha256:[a-f0-9]{64}$/.test(value?.candidateHash ?? ''))
    errors.push('invalid candidate hash');
  if (!/^sha256:[a-f0-9]{64}$/.test(value?.baseProfileHash ?? ''))
    errors.push('invalid base profile hash');
  if (!Number.isInteger(value?.basedOnProfileRevision) || value.basedOnProfileRevision < 1)
    errors.push('invalid base profile revision');
  if (!SAFE_ID.test(value?.profileId ?? '') || !roster.includes(value.profileId))
    errors.push('profile is outside canonical roster');
  if (value?.profile?.id !== value?.profileId) errors.push('candidate profile id mismatch');
  if (value?.profile?.schemaVersion !== 1 || !Array.isArray(value?.profile?.sources))
    errors.push('candidate profile schema mismatch');
  if (!value?.profile?.facts || typeof value.profile.facts !== 'object')
    errors.push('candidate facts schema mismatch');
  if (!SAFE_CANDIDATE_ID.test(value?.candidateId ?? '')) errors.push('unsafe candidate id');
  if (path.basename(file) !== `${value?.candidateId}.candidate.json`)
    errors.push('candidate filename mismatch');
  if (value?.validation?.valid !== true) errors.push('candidate validation failed');
  if (!Array.isArray(value?.semanticDiff)) errors.push('missing semantic diff');
  if (!Array.isArray(value?.sourceSnapshotIds)) errors.push('missing source snapshot ids');
  if (computeCandidateHash(value) !== value?.candidateHash) errors.push('candidate hash mismatch');
  if (trustedCanonicalHashes && trustedCanonicalHashes[value?.profileId] !== value?.baseProfileHash)
    errors.push('base profile hash does not match canonical serialization');
  if (!Array.isArray(value?.sourceChanges)) errors.push('missing source changes');
  else
    for (const change of value.sourceChanges) {
      if (!SAFE_ID.test(change?.sourceId ?? '')) errors.push('invalid source change id');
      if (!/^sha256:[a-f0-9]{64}$/.test(change?.afterContentHash ?? ''))
        errors.push('invalid source change hash');
      if (
        change?.beforeContentHash !== undefined &&
        !/^sha256:[a-f0-9]{64}$/.test(change.beforeContentHash)
      )
        errors.push('invalid prior source change hash');
      if (change?.requiresManualExtraction !== true)
        errors.push('source change must require manual extraction');
      const candidateSource = value?.profile?.sources?.find(
        (source) => source?.id === change?.sourceId,
      );
      if (candidateSource?.latestSuccessfulRetrieval?.contentHash !== change?.afterContentHash)
        errors.push('source change hash does not match candidate source');
      const canonicalSourceHash =
        trustedCanonicalSourceHashes?.[value?.profileId]?.[change?.sourceId];
      if (
        trustedCanonicalSourceHashes &&
        !Object.hasOwn(trustedCanonicalSourceHashes?.[value?.profileId] ?? {}, change?.sourceId)
      )
        errors.push('source change source is not canonical');
      if ((change?.beforeContentHash ?? null) !== (canonicalSourceHash ?? null))
        errors.push('source change prior hash does not match canonical source');
      if (
        !(value?.sourceSnapshotIds ?? []).includes(
          `${change?.sourceId}@${change?.afterContentHash}`,
        )
      )
        errors.push('source change has no matching snapshot id');
      const evidenceName = String(change?.afterContentHash ?? '').replace(/^sha256:/, '');
      const evidenceFile = regularFiles(auditRoot, evidenceName).find((candidate) =>
        candidate.split(path.sep).slice(-3, -1).join('/').endsWith('evidence/sha256'),
      );
      if (!evidenceFile) errors.push('source change evidence artifact is missing');
      else {
        const evidenceHash = `sha256:${createHash('sha256').update(fs.readFileSync(evidenceFile)).digest('hex')}`;
        if (evidenceHash !== change?.afterContentHash)
          errors.push('source change evidence artifact hash mismatch');
      }
    }
  for (const snapshotId of value?.sourceSnapshotIds ?? []) {
    const match = /^([a-z0-9]+(?:-[a-z0-9]+)*)@(sha256:[a-f0-9]{64})$/.exec(snapshotId);
    if (!match) {
      errors.push('invalid source snapshot id');
      continue;
    }
    const [, sourceId, contentHash] = match;
    const candidateSource = value?.profile?.sources?.find((source) => source?.id === sourceId);
    if (candidateSource?.latestSuccessfulRetrieval?.contentHash !== contentHash)
      errors.push('snapshot hash does not match candidate source');
    const evidenceName = contentHash.replace(/^sha256:/, '');
    const evidenceFile = regularFiles(auditRoot, evidenceName).find((candidate) =>
      candidate.split(path.sep).slice(-3, -1).join('/').endsWith('evidence/sha256'),
    );
    if (!evidenceFile) errors.push('snapshot evidence artifact is missing');
    else if (
      `sha256:${createHash('sha256').update(fs.readFileSync(evidenceFile)).digest('hex')}` !==
      contentHash
    )
      errors.push('snapshot evidence artifact hash mismatch');
  }
  return errors;
}

export function buildManifest(
  root,
  roster,
  fullAudit = false,
  canonicalRoster = roster,
  trustedCanonicalHashes,
  trustedCanonicalSourceHashes,
) {
  if (typeof fullAudit !== 'boolean') throw new Error('invalid full-audit attestation');
  const expected = [...new Set(roster)].sort();
  const canonical = [...new Set(canonicalRoster)].sort();
  if (!expected.length || expected.some((id) => !SAFE_ID.test(id)))
    throw new Error('invalid canonical roster');
  if (!canonical.length || canonical.some((id) => !SAFE_ID.test(id)))
    throw new Error('invalid complete canonical roster');
  const verifiedFullAudit =
    fullAudit &&
    expected.length === canonical.length &&
    expected.every((id, index) => id === canonical[index]);
  const runs = new Map();
  for (const file of regularFiles(root, 'run.json')) {
    const run = readJson(file);
    if (!expected.includes(run?.profileId) || runs.has(run.profileId)) continue;
    const resultFile = path.join(path.dirname(file), 'result.json');
    const result = readJson(resultFile);
    const resolved = run?.complete === true && ['clean', 'drift'].includes(result?.status);
    runs.set(run.profileId, {
      profileId: run.profileId,
      mode: run.mode,
      resolved,
      status: result?.status ?? 'invalid-output',
      exitCode: run.exitCode,
    });
  }
  const runtimeResults = expected.map(
    (profileId) => runs.get(profileId) ?? { profileId, resolved: false, status: 'missing' },
  );
  const rejectedCandidates = [];
  const candidates = [];
  for (const file of regularFiles(root, '.candidate.json')) {
    const value = readJson(file);
    const errors = validateCandidate(
      value,
      file,
      expected,
      trustedCanonicalHashes,
      trustedCanonicalSourceHashes,
      root,
    );
    if (errors.length) {
      rejectedCandidates.push({
        file: path.relative(root, file),
        risk: 'high',
        reasons: ['invalid-candidate'],
        errors,
      });
      continue;
    }
    candidates.push({
      sourceFile: file,
      file: path.relative(root, file),
      profileId: value.profileId,
      candidateId: value.candidateId,
      ...classifyCandidate(value),
    });
  }
  for (const run of runtimeResults) {
    if (
      run.status === 'drift' &&
      !candidates.some((candidate) => candidate.profileId === run.profileId)
    )
      run.resolved = false;
  }
  const complete = runtimeResults.every((run) => run.resolved) && rejectedCandidates.length === 0;
  const deepEnough = runtimeResults.every((run) => run.mode === 'weekly' || run.mode === 'monthly');
  return {
    schemaVersion: 1,
    requiresHumanReview: true,
    complete,
    fullAudit: verifiedFullAudit,
    canMutateReview: verifiedFullAudit && complete && candidates.length > 0,
    canCloseStale: verifiedFullAudit && complete && deepEnough && candidates.length === 0,
    runtimeResults,
    unresolvedProfiles: runtimeResults.filter((run) => !run.resolved).map((run) => run.profileId),
    rejectedCandidates,
    generatedCandidates: candidates,
  };
}

export function materializeReview(
  input,
  output,
  roster,
  summaryOutput,
  fullAudit = false,
  canonicalRoster = roster,
  trustedCanonicalHashes,
  trustedCanonicalSourceHashes,
) {
  const manifest = buildManifest(
    input,
    roster,
    fullAudit,
    canonicalRoster,
    trustedCanonicalHashes,
    trustedCanonicalSourceHashes,
  );
  if (summaryOutput) {
    fs.mkdirSync(summaryOutput, { recursive: true });
    fs.writeFileSync(
      path.join(summaryOutput, 'manifest.json'),
      `${JSON.stringify(manifest, null, 2)}\n`,
    );
  }
  if (!manifest.canMutateReview) return manifest;
  fs.mkdirSync(output, { recursive: true });
  for (const candidate of manifest.generatedCandidates) {
    const target = path.join(
      output,
      candidate.profileId,
      `${candidate.candidateId}.candidate.json`,
    );
    fs.mkdirSync(path.dirname(target), { recursive: true });
    fs.copyFileSync(candidate.sourceFile, target);
    candidate.file = path.relative(output, target);
    delete candidate.sourceFile;
  }
  fs.writeFileSync(path.join(output, 'manifest.json'), `${JSON.stringify(manifest, null, 2)}\n`);
  return manifest;
}

if (process.argv[1] && import.meta.url === new URL(`file://${process.argv[1]}`).href) {
  const input = path.resolve(process.argv[2] || 'profile-refresh-artifacts');
  const output = path.resolve(process.argv[3] || 'profile-updates');
  const summary = path.resolve(process.argv[4] || 'profile-refresh-summary');
  const roster = JSON.parse(process.env.EXPECTED_AGENTS || '[]');
  const canonicalRoster = JSON.parse(process.env.CANONICAL_AGENTS || '[]');
  const trustedCanonicalHashes = JSON.parse(process.env.CANONICAL_PROFILE_HASHES || '{}');
  const trustedCanonicalSourceHashes = JSON.parse(process.env.CANONICAL_SOURCE_HASHES || '{}');
  if (!['true', 'false'].includes(process.env.FULL_AUDIT ?? ''))
    throw new Error('FULL_AUDIT must be true or false');
  const manifest = materializeReview(
    input,
    output,
    roster,
    summary,
    process.env.FULL_AUDIT === 'true',
    canonicalRoster,
    trustedCanonicalHashes,
    trustedCanonicalSourceHashes,
  );
  if (process.env.GITHUB_OUTPUT) {
    fs.appendFileSync(
      process.env.GITHUB_OUTPUT,
      `has-candidates=${manifest.generatedCandidates.length > 0}\ncomplete=${manifest.complete}\ncan-mutate-review=${manifest.canMutateReview}\ncan-close-stale=${manifest.canCloseStale}\n`,
    );
  }
}
