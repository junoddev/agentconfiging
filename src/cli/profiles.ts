import { auditAgentProfile } from '../core/profiles/audit.js';
import { publicProfileAuditResult } from '../core/profiles/audit.js';
import {
  getAgentProfile,
  listAgentProfiles,
  publicProfileDetail,
  publicProfileSummary,
} from '../core/profiles/index.js';
import type { ReportIo } from './report.js';

export function runProfilesList(io: ReportIo): number {
  io.stdout(
    `${JSON.stringify(listAgentProfiles().map((profile) => publicProfileSummary(profile)))}\n`,
  );
  return 0;
}

export function runProfilesShow(id: string, io: ReportIo): number {
  const profile = getAgentProfile(id);
  if (!profile) {
    io.stderr(`unknown profile: ${id}\n`);
    return 1;
  }
  io.stdout(`${JSON.stringify(publicProfileDetail(profile), null, 2)}\n`);
  return 0;
}

export async function runProfilesAudit(
  id: string | undefined,
  opts: {
    cacheDir?: string;
    candidateDir?: string;
    source?: string[];
    metadataOnly?: boolean;
    codexAssisted?: boolean;
    cadence?: 'daily' | 'weekly' | 'monthly';
    all?: boolean;
  },
  io: ReportIo,
  audit: typeof auditAgentProfile = auditAgentProfile,
): Promise<number> {
  const ids = opts.all ? listAgentProfiles().map((profile) => profile.id) : id ? [id] : [];
  if (!ids.length) {
    io.stderr('profiles audit requires <id> or --all\n');
    return 64;
  }
  const results = [];
  for (const profileId of ids)
    results.push(
      await audit({
        profileId,
        cacheDir: opts.cacheDir,
        candidateDir: opts.candidateDir,
        sourceIds: opts.source,
        metadataOnly: opts.metadataOnly,
        codexAssisted: opts.codexAssisted,
        cadence: opts.cadence,
      }),
    );
  const output = results.map(publicProfileAuditResult);
  io.stdout(`${JSON.stringify(opts.all ? output : output[0], null, 2)}\n`);
  if (results.some((result) => result.status === 'invalid')) return 3;
  if (results.some((result) => result.status === 'fetch-failure')) return 2;
  return results.some((result) => result.status === 'drift') ? 1 : 0;
}
