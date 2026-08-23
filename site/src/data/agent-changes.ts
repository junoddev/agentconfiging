import changesJson from './agent-changes.json';
import promotedProfilesJson from '../../../src/core/profiles/promoted-profiles.json';

export type AgentChangeStatus = 'observed' | 'promoted';

export interface AgentChange {
  id: string;
  observedAt: string;
  agentId: string;
  agentName: string;
  title: string;
  summary: string;
  before: string;
  after: string;
  status: AgentChangeStatus;
  sourceUrl: string;
  candidateId?: string;
  profileRevision?: number;
  promotedAt?: string;
}

/** Content-safe summaries whose status is derived from the canonical promotion ledger. */
export const agentChanges: readonly AgentChange[] = (changesJson as AgentChange[])
  .map((change) => {
    const profile = promotedProfilesJson.find(
      (item) =>
        item.id === change.agentId &&
        item.promotion.method === 'reviewed-candidate' &&
        item.promotion.candidateId === change.candidateId,
    );
    return profile?.promotion.method === 'reviewed-candidate'
      ? {
          ...change,
          status: 'promoted' as const,
          profileRevision: profile.profileRevision,
          promotedAt: profile.promotion.promotedAt,
        }
      : change;
  })
  .sort((left, right) => right.observedAt.localeCompare(left.observedAt));
