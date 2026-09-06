import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import type { Hono } from 'hono';
import {
  getAgentProfile,
  listAgentProfiles,
  publicProfileDetail,
  publicProfileSummary,
} from '../core/profiles/index.js';
import { isCurrentProfileCandidate } from '../core/profiles/audit.js';
import { jsonError } from './http.js';

export function pendingCandidates(candidateDir?: string): ReadonlySet<string> {
  const state = process.env['AGENTCONFIGING_STATE_DIR']?.trim();
  const xdg = process.env['XDG_STATE_HOME']?.trim();
  const dir =
    candidateDir ??
    path.join(
      state
        ? path.resolve(state)
        : path.join(xdg || path.join(os.homedir(), '.local', 'state'), 'agentconfiging'),
      'profile-candidates',
    );
  const ids = new Set<string>();
  let names: string[];
  try {
    names = fs.readdirSync(dir).sort();
  } catch {
    return ids;
  }
  for (const name of names) {
    try {
      if (!name.endsWith('.candidate.json')) continue;
      const file = path.join(dir, name);
      const stat = fs.lstatSync(file);
      if (!stat.isFile() || stat.size > 2_000_000) continue;
      const value: unknown = JSON.parse(fs.readFileSync(file, 'utf8'));
      const id =
        value && typeof value === 'object'
          ? (value as { profileId?: unknown }).profileId
          : undefined;
      const canonical = typeof id === 'string' ? getAgentProfile(id) : undefined;
      if (canonical && isCurrentProfileCandidate(value, canonical, name)) ids.add(canonical.id);
    } catch {
      // One malformed, unreadable or racy file cannot hide later valid candidates.
    }
  }
  return ids;
}

export function registerProfileRoutes(
  app: Hono,
  configuredPendingDriftIds?: ReadonlySet<string>,
): void {
  app.get('/api/profiles', (c) => {
    const driftIds = configuredPendingDriftIds ?? pendingCandidates();
    return c.json({
      profiles: listAgentProfiles().map((profile) =>
        publicProfileSummary(profile, driftIds.has(profile.id)),
      ),
    });
  });
  app.get('/api/profiles/:id', (c) => {
    const profile = getAgentProfile(c.req.param('id'));
    const driftIds = configuredPendingDriftIds ?? pendingCandidates();
    return profile
      ? c.json(publicProfileDetail(profile, driftIds.has(profile.id)))
      : jsonError(404, 'unknown profile');
  });
}
