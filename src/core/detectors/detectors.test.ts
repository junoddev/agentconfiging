/**
 * Fixture detection matrix over the canonical corpus
 * (fixtures/manifests/*.json). Signal sets and confidence thresholds are
 * ported from ../markdowning's Elixir detectors; expectations here pin
 * the ported semantics.
 */

import fs from 'node:fs';
import path from 'node:path';
import { describe, expect, it } from 'vitest';
import { parseManifest } from '../manifest.js';
import { detect, type DetectedAgent } from './index.js';

const manifestsDir = path.resolve(process.cwd(), 'fixtures/manifests');

function detectFixture(name: string): DetectedAgent[] {
  const raw: unknown = JSON.parse(
    fs.readFileSync(path.join(manifestsDir, `${name}.json`), 'utf-8'),
  );
  return detect(parseManifest(raw));
}

function only(agents: DetectedAgent[], kind: string): DetectedAgent {
  expect(agents.map((a) => a.kind)).toEqual([kind]);
  const agent = agents[0];
  if (!agent) throw new Error('unreachable');
  return agent;
}

describe('detect() fixture matrix', () => {
  it('negative-plain: detects nothing', () => {
    expect(detectFixture('negative-plain')).toEqual([]);
  });

  it('claude-basic: claude-code, medium (2 signals: CLAUDE.md + settings.json)', () => {
    const agent = only(detectFixture('claude-basic'), 'claude-code');
    expect(agent.confidence).toBe('medium');
    expect([...agent.files].sort()).toEqual(['.claude/settings.json', 'CLAUDE.md']);
    expect(agent.extras).toMatchObject({
      claudeMdWords: 53,
      hasSettings: true,
      hasLocalSettings: false,
      agentsCount: 0,
      skillsCount: 0,
    });
  });

  it('claude-rich: claude-code, high (all 5 signals), full .claude/ tree in files', () => {
    const agent = only(detectFixture('claude-rich'), 'claude-code');
    expect(agent.confidence).toBe('high');
    expect(agent.files).toHaveLength(18); // CLAUDE.md + 17 files under .claude/
    expect(agent.files).toContain('CLAUDE.md');
    expect(agent.files).toContain('.claude/settings.local.json');
    expect(agent.files).toContain('.claude/skills/release-notes/SKILL.md');
    // Not claude signals: root .mcp.json and docs/ are outside the signal set.
    expect(agent.files).not.toContain('.mcp.json');
    expect(agent.files).not.toContain('docs/ARCHITECTURE.md');
    expect(agent.extras).toMatchObject({ agentsCount: 2, skillsCount: 3, hasLocalSettings: true });
  });

  it('cursor-basic: cursor, high (.cursorrules + rules dir)', () => {
    const agent = only(detectFixture('cursor-basic'), 'cursor');
    expect(agent.confidence).toBe('high');
    expect([...agent.files].sort()).toEqual([
      '.cursor/rules/api-design.mdc',
      '.cursor/rules/components.mdc',
      '.cursor/rules/typescript.mdc',
      '.cursorrules',
    ]);
    expect(agent.extras).toMatchObject({ ruleCount: 3, hasCursorrules: true });
  });

  it('copilot-basic: copilot, medium (fixed), includes scoped instructions file', () => {
    const agent = only(detectFixture('copilot-basic'), 'copilot');
    expect(agent.confidence).toBe('medium');
    expect([...agent.files].sort()).toEqual([
      '.github/copilot-instructions.md',
      '.github/instructions/api.instructions.md',
    ]);
    expect(agent.extras).toMatchObject({ scopedInstructionsCount: 1 });
  });

  it('codex-basic: codex, medium (AGENTS.md alone is a single shared-marker signal)', () => {
    const agent = only(detectFixture('codex-basic'), 'codex');
    expect(agent.confidence).toBe('medium');
    expect(agent.files).toEqual(['AGENTS.md']);
    expect(agent.extras['agentsMdWords']).toBeGreaterThan(0);
  });

  it('codex-global: codex, high (global ~/.codex root: dir + AGENTS.md + config.toml)', () => {
    const agent = only(detectFixture('codex-global'), 'codex');
    expect(agent.confidence).toBe('high');
    expect([...agent.files].sort()).toEqual(['AGENTS.md', 'config.toml']);
  });

  it('continue-basic: continue, high (config file present), models from JSON config', () => {
    const agent = only(detectFixture('continue-basic'), 'continue');
    expect(agent.confidence).toBe('high');
    expect([...agent.files].sort()).toEqual([
      '.continue/config.json',
      '.continue/config.yaml',
      '.continuerules',
    ]);
    expect(agent.extras['models']).toEqual(['claude-sonnet-4-5']);
  });

  it('aider-basic: aider, high (conf + ignore)', () => {
    const agent = only(detectFixture('aider-basic'), 'aider');
    expect(agent.confidence).toBe('high');
    expect(agent.files).toEqual(['.aider.conf.yml', '.aiderignore']);
    expect(agent.extras).toMatchObject({ hasConf: true, hasIgnore: true });
  });

  it('gemini-basic: gemini-cli, high (GEMINI.md + .gemini/)', () => {
    const agent = only(detectFixture('gemini-basic'), 'gemini-cli');
    expect(agent.confidence).toBe('high');
    expect([...agent.files].sort()).toEqual(['.gemini/settings.json', 'GEMINI.md']);
    expect(agent.extras['geminiMdWords']).toBe(60);
  });

  it('opencode-basic: opencode, medium (fixed), model extracted from opencode.json', () => {
    const agent = only(detectFixture('opencode-basic'), 'opencode');
    expect(agent.confidence).toBe('medium');
    expect([...agent.files].sort()).toEqual([
      '.opencode/agent/reviewer.md',
      '.opencode/command/deploy.md',
      'opencode.json',
    ]);
    expect(agent.extras['providers']).toEqual([]);
    expect(agent.extras['model']).toBe('anthropic/claude-sonnet-4-5');
  });

  it('opencode providers: reports only provider name strings, never provider config objects', () => {
    const raw = {
      root: '/tmp/proj',
      cwdBasename: 'proj',
      files: [
        {
          path: 'opencode.json',
          size: 1,
          sha256: 'a'.repeat(64),
          content: JSON.stringify({
            providers: [
              'anthropic',
              { name: 'openai', apiKey: 'sk-SHOULD-NOT-LEAK' },
              { id: 'nameless', token: 'tok-SHOULD-NOT-LEAK' },
              42,
            ],
          }),
        },
      ],
      stats: { fileCount: 1, totalBytes: 1 },
    };

    const agent = only(detect(parseManifest(raw)), 'opencode');
    expect(agent.extras['providers']).toEqual(['anthropic', 'openai']);
    expect(JSON.stringify(agent.extras)).not.toContain('SHOULD-NOT-LEAK');
    expect(JSON.stringify(agent.extras)).not.toContain('apiKey');
    expect(JSON.stringify(agent.extras)).not.toContain('token');
  });

  it('opencode provider map: current schema reports only map keys as provider names', () => {
    const raw = {
      root: '/tmp/proj',
      cwdBasename: 'proj',
      files: [
        {
          path: 'opencode.json',
          size: 1,
          sha256: 'a'.repeat(64),
          content: JSON.stringify({
            provider: {
              anthropic: { options: { apiKey: 'sk-SHOULD-NOT-LEAK' } },
              openai: { options: { token: 'tok-SHOULD-NOT-LEAK' } },
            },
          }),
        },
      ],
      stats: { fileCount: 1, totalBytes: 1 },
    };

    const agent = only(detect(parseManifest(raw)), 'opencode');
    expect(agent.extras['providers']).toEqual(['anthropic', 'openai']);
    expect(JSON.stringify(agent.extras)).not.toContain('SHOULD-NOT-LEAK');
    expect(JSON.stringify(agent.extras)).not.toContain('apiKey');
    expect(JSON.stringify(agent.extras)).not.toContain('token');
  });

  it('multi-runtime: detects exactly Claude + Codex + Copilot + Cursor (no gemini from AGENTS.md)', () => {
    const agents = detectFixture('multi-runtime');
    const byKind = new Map(agents.map((a) => [a.kind, a]));
    expect([...byKind.keys()].sort()).toEqual(['claude-code', 'codex', 'copilot', 'cursor']);
    expect(byKind.get('claude-code')?.confidence).toBe('low'); // CLAUDE.md alone = 1 signal
    expect(byKind.get('codex')?.confidence).toBe('medium'); // AGENTS.md alone = 1 signal
    expect(byKind.get('copilot')?.confidence).toBe('medium'); // fixed
    expect(byKind.get('cursor')?.confidence).toBe('high'); // .cursorrules + rules dir
  });

  it("scope guard: a project-scope repo literally named '.claude' gets no global treatment", () => {
    const raw = {
      root: '/home/user/projects/.claude',
      cwdBasename: '.claude',
      files: [
        { path: 'settings.json', size: 2, sha256: 'a'.repeat(64), content: '{}' },
        { path: 'agents/reviewer.md', size: 1, sha256: 'b'.repeat(64), content: 'x' },
        { path: 'skills/audit/SKILL.md', size: 1, sha256: 'c'.repeat(64), content: 'x' },
      ],
      stats: { fileCount: 3, totalBytes: 4 },
    };

    // Explicit project scope: the global adaptation must NOT apply — these
    // root-level paths are not .claude/ config in a repo, so nothing detects.
    expect(detect(parseManifest({ ...raw, scope: 'project' }))).toEqual([]);

    // Scope absent (the fixture convention): cwdBasename '.claude' means the
    // manifest root IS ~/.claude, and the same layout detects high.
    const agent = only(detect(parseManifest(raw)), 'claude-code');
    expect(agent.confidence).toBe('high');
  });

  it('detect() is pure: does not mutate the manifest', () => {
    const raw: unknown = JSON.parse(
      fs.readFileSync(path.join(manifestsDir, 'multi-runtime.json'), 'utf-8'),
    );
    const manifest = parseManifest(raw);
    const before = JSON.stringify(manifest);
    detect(manifest);
    expect(JSON.stringify(manifest)).toBe(before);
  });
});
