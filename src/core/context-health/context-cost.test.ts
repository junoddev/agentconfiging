/**
 * Context-cost tests (agentconfig-ub3.2). Synthetic manifests keep the pass
 * pure and pin per-agent token attribution from DetectedAgent.files.
 */

import { describe, expect, it } from 'vitest';
import { type DetectedAgent, type Manifest, type ManifestFile } from '../index.js';
import { CAPS } from '../scanner.js';
import { computeContextCost, CONTEXT_COST_BUDGET_TOKENS } from './context-cost.js';

function file(
  path: string,
  content: string | undefined,
  size = content?.length ?? 128,
): ManifestFile {
  const out: ManifestFile = { path, size, sha256: '0'.repeat(64) };
  if (content !== undefined) out.content = content;
  else out.truncated = true;
  return out;
}

function manifest(files: ManifestFile[], opts: Partial<Manifest> = {}): Manifest {
  return {
    root: '/tmp/project',
    cwdBasename: 'project',
    files,
    stats: { fileCount: files.length, totalBytes: files.reduce((sum, f) => sum + f.size, 0) },
    scope: 'project',
    ...opts,
  };
}

function agent(kind: string, files: string[]): DetectedAgent {
  return { kind, confidence: 'high', files, extras: {} };
}

describe('computeContextCost', () => {
  it('groups token estimates by detected agent and category in deterministic order', () => {
    const cost = computeContextCost(
      manifest([
        file('AGENTS.md', 'a'.repeat(8)),
        file('CLAUDE.md', 'b'.repeat(12)),
        file('.claude/rules/style.md', 'c'.repeat(4)),
        file('.claude/hooks/check.sh', 'ignored runtime state'),
      ]),
      [
        agent('codex', ['AGENTS.md']),
        agent('claude-code', ['CLAUDE.md', '.claude/rules/style.md', '.claude/hooks/check.sh']),
      ],
    );

    expect(cost.budgetTokens).toBe(CONTEXT_COST_BUDGET_TOKENS);
    expect(cost.agents.map((a) => a.kind)).toEqual(['claude-code', 'codex']);
    expect(cost.agents[0]).toMatchObject({
      kind: 'claude-code',
      totalTokens: 4,
      byCategory: [
        { category: 'instructions', tokens: 3, files: 1 },
        { category: 'rules', tokens: 1, files: 1 },
      ],
      files: [
        { path: 'CLAUDE.md', tokens: 3, category: 'instructions' },
        { path: '.claude/rules/style.md', tokens: 1, category: 'rules' },
      ],
    });
    expect(cost.agents[1]?.totalTokens).toBe(2);
  });

  it('counts shared files once per agent but dedupes duplicate paths inside one agent', () => {
    const cost = computeContextCost(
      manifest([file('AGENTS.md', 'a'.repeat(8)), file('CLAUDE.md', 'b'.repeat(4))]),
      [
        agent('codex', ['AGENTS.md', 'AGENTS.md']),
        agent('claude-code', ['CLAUDE.md', 'AGENTS.md']),
      ],
    );

    const byKind = new Map(cost.agents.map((a) => [a.kind, a]));
    expect(byKind.get('codex')?.totalTokens).toBe(2);
    expect(byKind.get('codex')?.files).toHaveLength(1);
    expect(byKind.get('claude-code')?.totalTokens).toBe(3);
    expect(
      byKind
        .get('claude-code')
        ?.files.map((f) => f.path)
        .sort(),
    ).toEqual(['AGENTS.md', 'CLAUDE.md']);
  });

  it('attributes shared root AGENTS.md to opencode when the detector owns it', () => {
    const cost = computeContextCost(
      manifest([file('AGENTS.md', 'a'.repeat(8)), file('opencode.json', '{}')]),
      [agent('opencode', ['opencode.json', 'AGENTS.md'])],
    );
    expect(cost.agents[0]).toMatchObject({
      kind: 'opencode',
      totalTokens: 3,
      byCategory: [
        { category: 'instructions', tokens: 2, files: 1 },
        { category: 'settings', tokens: 1, files: 1 },
      ],
      files: [
        { path: 'AGENTS.md', tokens: 2, category: 'instructions' },
        { path: 'opencode.json', tokens: 1, category: 'settings' },
      ],
    });
  });

  it('classifies Codex project config paths as settings', () => {
    const cost = computeContextCost(
      manifest([file('.codex/config.toml', 'a'.repeat(8)), file('codex.toml', 'b'.repeat(12))]),
      [agent('codex', ['.codex/config.toml', 'codex.toml'])],
    );
    expect(cost.agents[0]).toMatchObject({
      totalTokens: 5,
      byCategory: [{ category: 'settings', tokens: 5, files: 2 }],
      files: [
        { path: 'codex.toml', tokens: 3, category: 'settings' },
        { path: '.codex/config.toml', tokens: 2, category: 'settings' },
      ],
    });
  });

  it('preserves Codex global root config.toml settings attribution', () => {
    const cost = computeContextCost(
      manifest([file('config.toml', 'a'.repeat(16))], {
        root: '/home/user/.codex',
        cwdBasename: '.codex',
        scope: 'global',
        localOnly: true,
      }),
      [agent('codex', ['config.toml'])],
    );
    expect(cost.agents[0]).toMatchObject({
      totalTokens: 4,
      byCategory: [{ category: 'settings', tokens: 4, files: 1 }],
      files: [{ path: 'config.toml', tokens: 4, category: 'settings' }],
    });
  });

  it('attributes root .mcp.json as Claude Code core MCP context cost', () => {
    const cost = computeContextCost(
      manifest([file('CLAUDE.md', 'a'.repeat(4)), file('.mcp.json', 'b'.repeat(12))]),
      [agent('claude-code', ['CLAUDE.md', '.mcp.json'])],
    );
    expect(cost.agents[0]).toMatchObject({
      kind: 'claude-code',
      totalTokens: 4,
      byCategory: [
        { category: 'mcp', tokens: 3, files: 1 },
        { category: 'instructions', tokens: 1, files: 1 },
      ],
      files: [
        { path: '.mcp.json', tokens: 3, category: 'mcp' },
        { path: 'CLAUDE.md', tokens: 1, category: 'instructions' },
      ],
    });
  });

  it('estimates missing config content from retained manifest size and attributes its category', () => {
    const size = CAPS.maxFileBytes + 4;
    const cost = computeContextCost(manifest([file('.claude/settings.json', undefined, size)]), [
      agent('claude-code', ['.claude/settings.json']),
    ]);
    expect(cost.agents[0]).toMatchObject({
      totalTokens: Math.ceil(size / 4),
      byCategory: [{ category: 'settings', tokens: Math.ceil(size / 4), files: 1 }],
      files: [{ path: '.claude/settings.json', tokens: Math.ceil(size / 4), category: 'settings' }],
    });
  });

  it('applies runtime fudge factors to missing-content size estimates', () => {
    const cost = computeContextCost(
      manifest([file('.claude/settings.json', undefined, 8)]),
      [agent('claude-code', ['.claude/settings.json'])],
      { runtimeFudgeFactors: { 'claude-code': 1.5 } },
    );
    expect(cost.agents[0]).toMatchObject({
      totalTokens: 3,
      byCategory: [{ category: 'settings', tokens: 3, files: 1 }],
    });
  });

  it('handles missing manifest files and zero detected agents', () => {
    const m = manifest([file('CLAUDE.md', 'abcd')]);

    expect(computeContextCost(m, [])).toEqual({
      budgetTokens: CONTEXT_COST_BUDGET_TOKENS,
      agents: [],
    });

    const [agentCost] = computeContextCost(m, [agent('claude-code', ['missing.md'])]).agents;
    expect(agentCost).toMatchObject({
      totalTokens: 0,
      byCategory: [],
      files: [],
    });
  });

  it('derives per-agent budget ratio and status from the token budget', () => {
    const m = manifest([
      file('AGENTS.md', 'a'.repeat(32)),
      file('CLAUDE.md', 'b'.repeat(8)),
      file('GEMINI.md', 'c'.repeat(4)),
    ]);

    const cost = computeContextCost(
      m,
      [
        agent('codex', ['AGENTS.md']),
        agent('claude-code', ['CLAUDE.md']),
        agent('gemini-cli', ['GEMINI.md']),
      ],
      { budgetTokens: 4 },
    );

    const byKind = new Map(cost.agents.map((a) => [a.kind, a]));
    expect(byKind.get('codex')).toMatchObject({ totalTokens: 8, budgetRatio: 2, status: 'over' });
    expect(byKind.get('claude-code')).toMatchObject({
      totalTokens: 2,
      budgetRatio: 0.5,
      status: 'ok',
    });
    expect(byKind.get('gemini-cli')).toMatchObject({
      totalTokens: 1,
      budgetRatio: 0.25,
      status: 'ok',
    });

    const warned = computeContextCost(m, [agent('codex', ['AGENTS.md'])], { budgetTokens: 10 });
    expect(warned.agents[0]?.status).toBe('warn');
  });
});
