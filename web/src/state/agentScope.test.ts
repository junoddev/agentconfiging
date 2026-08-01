import { describe, expect, it } from 'vitest';
import type { DetectedAgent } from '../api/types.js';
import {
  agentKindsForFile,
  availableAgents,
  displayNameForKind,
  isClaudeKind,
  otherAgentKinds,
  resolveActiveAgent,
  scopeReport,
  scopedAgents,
  sectionApplies,
} from './agentScope.js';

function agent(kind: string, files: string[] = []): DetectedAgent {
  return { kind, confidence: 'high', files, extras: {} };
}

const AGENTS = [
  agent('claude-code', ['CLAUDE.md', 'AGENTS.md', '.claude/settings.json']),
  agent('codex', ['AGENTS.md']),
  agent('cursor', ['.cursorrules']),
];

describe('resolveActiveAgent', () => {
  it('returns the stored kind when detected', () => {
    expect(resolveActiveAgent(AGENTS, 'cursor')?.kind).toBe('cursor');
  });

  it('falls back to the first detection when the stored kind is absent', () => {
    expect(resolveActiveAgent(AGENTS, 'gemini-cli')?.kind).toBe('claude-code');
    expect(resolveActiveAgent(AGENTS, undefined)?.kind).toBe('claude-code');
  });

  it('returns undefined when nothing is detected', () => {
    expect(resolveActiveAgent([], 'cursor')).toBeUndefined();
  });
});

describe('availableAgents', () => {
  it('keeps global-only runtimes available and de-duplicates shared detections', () => {
    const globalClaude = agent('claude-code', ['settings.json']);
    const globalCursor = agent('cursor', ['rules/project.mdc']);
    const result = availableAgents(
      [],
      [
        { agents: [globalClaude] },
        { agents: [agent('claude-code', ['keybindings.json']), globalCursor] },
      ],
    );

    expect(result.map((a) => a.kind)).toEqual(['claude-code', 'cursor']);
    expect(result[0]?.files).toEqual(['settings.json', 'keybindings.json']);
  });

  it('prefers the selected folder detection when the same runtime is global too', () => {
    const local = agent('claude-code', ['.claude/settings.json']);
    const result = availableAgents(
      [local],
      [{ agents: [agent('claude-code', ['settings.json'])] }],
    );
    expect(result[0]?.confidence).toBe(local.confidence);
    expect(result[0]?.files).toEqual(['.claude/settings.json', 'settings.json']);
  });
});

describe('scopedAgents / scopeReport', () => {
  it('filters to the matching kind', () => {
    expect(scopedAgents(AGENTS, 'codex').map((a) => a.kind)).toEqual(['codex']);
  });

  it('passes everything through with no kind (boot window)', () => {
    expect(scopedAgents(AGENTS, undefined)).toHaveLength(3);
  });

  it('scopeReport narrows only the agents slice', () => {
    const report = {
      version: '1',
      generatedAt: 'now',
      root: '/p',
      scope: 'project' as const,
      localOnly: false,
      agents: AGENTS,
      findings: [],
      stats: { fileCount: 0, totalBytes: 0 },
    };
    const scoped = scopeReport(report, 'cursor');
    expect(scoped.agents.map((a) => a.kind)).toEqual(['cursor']);
    expect(scoped.findings).toBe(report.findings);
    expect(scopeReport(report, undefined)).toBe(report);
  });
});

describe('agentKindsForFile / otherAgentKinds', () => {
  it('lists every kind referencing the path, sorted', () => {
    expect(agentKindsForFile(AGENTS, 'AGENTS.md')).toEqual(['claude-code', 'codex']);
    expect(agentKindsForFile(AGENTS, 'nope.md')).toEqual([]);
  });

  it('otherAgentKinds excludes the active kind', () => {
    expect(otherAgentKinds(AGENTS, 'AGENTS.md', 'claude-code')).toEqual(['codex']);
    expect(otherAgentKinds(AGENTS, 'CLAUDE.md', 'claude-code')).toEqual([]);
  });
});

describe('displayNameForKind / isClaudeKind', () => {
  it('maps detector kinds to runtime display names', () => {
    expect(displayNameForKind('claude-code')).toBe('Claude Code');
    expect(displayNameForKind('gemini-cli')).toBe('Gemini CLI');
  });

  it('an unknown kind displays as itself', () => {
    expect(displayNameForKind('mystery-agent')).toBe('mystery-agent');
  });

  it('only claude-code is a Claude surface', () => {
    expect(isClaudeKind('claude-code')).toBe(true);
    expect(isClaudeKind('cursor')).toBe(false);
    expect(isClaudeKind(undefined)).toBe(false);
  });
});

describe('sectionApplies', () => {
  it('Claude-layout sections apply to claude-code alone', () => {
    for (const section of [
      'settings',
      'skills',
      'hooks',
      'memory',
      'mcp',
      'keybindings',
    ] as const) {
      expect(sectionApplies(section, 'claude-code')).toBe(true);
      expect(sectionApplies(section, 'codex')).toBe(false);
      expect(sectionApplies(section, 'cursor')).toBe(false);
    }
  });

  it('rules applies to claude-code and cursor', () => {
    expect(sectionApplies('rules', 'claude-code')).toBe(true);
    expect(sectionApplies('rules', 'cursor')).toBe(true);
    expect(sectionApplies('rules', 'codex')).toBe(false);
  });

  it('instructions and sync apply to every runtime', () => {
    for (const kind of ['claude-code', 'codex', 'cursor', 'mystery-agent']) {
      expect(sectionApplies('instructions', kind)).toBe(true);
      expect(sectionApplies('sync', kind)).toBe(true);
    }
  });

  it('no active agent (boot window) shows every section', () => {
    expect(sectionApplies('hooks', undefined)).toBe(true);
    expect(sectionApplies('settings', undefined)).toBe(true);
  });
});
