import { createHash } from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';

import {
  isCurrentProfileCandidate,
  type ProfileCandidateEnvelope,
} from '../src/core/profiles/audit.js';
import {
  AGENT_PROFILES,
  getAgentProfile,
  serializeAgentProfiles,
} from '../src/core/profiles/index.js';
import type { AgentProfile } from '../src/core/profiles/types.js';
import { validateCanonicalAgentProfiles } from '../src/core/profiles/validate.js';

const root = process.cwd();
const promotedFile = path.join(root, 'src/core/profiles/promoted-profiles.json');
const changesFile = path.join(root, 'site/src/data/agent-changes.json');

function arg(name: string): string {
  const index = process.argv.indexOf(`--${name}`);
  const value = index < 0 ? undefined : process.argv[index + 1];
  if (!value || value.startsWith('--')) throw new Error(`missing --${name}`);
  return value;
}

function stableJson(value: unknown): string {
  const normalize = (item: unknown): unknown => {
    if (Array.isArray(item)) return item.map(normalize);
    if (item && typeof item === 'object')
      return Object.fromEntries(
        Object.entries(item)
          .sort(([left], [right]) => left.localeCompare(right))
          .map(([key, child]) => [key, normalize(child)]),
      );
    return item;
  };
  return `${JSON.stringify(normalize(value), null, 2)}\n`;
}

/** Avoids a self-referential hash by hashing the canonical profile with this field blank. */
function canonicalHash(profile: AgentProfile): string {
  const copy = structuredClone(profile);
  if (copy.promotion.method === 'reviewed-candidate') copy.promotion.canonicalHash = '';
  return `sha256:${createHash('sha256')
    .update(serializeAgentProfiles([copy]))
    .digest('hex')}`;
}

const candidatePath = path.resolve(arg('candidate'));
const approverId = arg('approver');
const promoterId = arg('promoter');
const approvedAt = arg('approved-at');
const changeId = arg('change-id');
const comment = arg('comment');
if (!/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}Z$/.test(approvedAt))
  throw new Error('--approved-at must be an RFC 3339 UTC timestamp with seconds');

const candidate = JSON.parse(fs.readFileSync(candidatePath, 'utf8')) as ProfileCandidateEnvelope;
const canonical = getAgentProfile(candidate.profileId);
if (!canonical || !isCurrentProfileCandidate(candidate, canonical, path.basename(candidatePath)))
  throw new Error(
    'candidate is invalid, stale, already promoted, or does not match canonical state',
  );

const promoted = structuredClone(candidate.profile);
promoted.profileRevision = canonical.profileRevision + 1;
promoted.promotion = {
  method: 'reviewed-candidate',
  promotedAt: approvedAt,
  promoterId,
  candidateId: candidate.candidateId,
  candidateHash: candidate.candidateHash,
  basedOnProfileRevision: candidate.basedOnProfileRevision,
  canonicalHash: '',
  approvals: [
    {
      approverId,
      approvedAt,
      candidateId: candidate.candidateId,
      candidateHash: candidate.candidateHash,
      basedOnProfileRevision: candidate.basedOnProfileRevision,
      decision: 'approve',
      comment,
    },
  ],
};
promoted.promotion.canonicalHash = canonicalHash(promoted);

const ledger = JSON.parse(fs.readFileSync(promotedFile, 'utf8')) as AgentProfile[];
if (ledger.some((profile) => profile.id === promoted.id))
  throw new Error(`promoted ledger already contains ${promoted.id}`);
const nextCanonical = AGENT_PROFILES.map((profile) =>
  profile.id === promoted.id ? promoted : profile,
);
const issues = validateCanonicalAgentProfiles(nextCanonical, new Date(approvedAt));
if (issues.length) throw new Error(`promoted canonical set is invalid: ${JSON.stringify(issues)}`);

type Change = Record<string, unknown> & {
  id: string;
  agentId: string;
  status: string;
  candidateId?: string;
};
const changes = JSON.parse(fs.readFileSync(changesFile, 'utf8')) as Change[];
const change = changes.find((item) => item.id === changeId);
if (
  !change ||
  change.agentId !== candidate.profileId ||
  change.candidateId !== candidate.candidateId
)
  throw new Error('change entry is missing or does not identify this candidate');

const nextLedger = [...ledger, promoted].sort((left, right) => left.id.localeCompare(right.id));
const temporaryFile = `${promotedFile}.${process.pid}.tmp`;
fs.writeFileSync(temporaryFile, stableJson(nextLedger), { flag: 'wx' });
fs.renameSync(temporaryFile, promotedFile);
process.stdout.write(
  `${JSON.stringify({ profileId: promoted.id, profileRevision: promoted.profileRevision, candidateId: candidate.candidateId, canonicalHash: promoted.promotion.canonicalHash })}\n`,
);
