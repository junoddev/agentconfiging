import fs from 'node:fs';
import path from 'node:path';
import { describe, expect, it } from 'vitest';
import {
  parseClaudeCommand,
  parseClaudeMd,
  parseClaudeMemory,
  parseClaudeRule,
  parseClaudeSettings,
  parseClaudeSkill,
  parseClaudeSubagent,
  parseKeybindings,
} from './claude.js';
import { parseMcpJson } from './mcp.js';

const treeDir = path.resolve(process.cwd(), 'fixtures/trees/claude-rich');

function load(rel: string): string {
  return fs.readFileSync(path.join(treeDir, rel), 'utf-8');
}

describe('parseClaudeSubagent', () => {
  it('parses code-reviewer with tools and model', () => {
    const result = parseClaudeSubagent(load('.claude/agents/code-reviewer.md'));
    expect(result.ok).toBe(true);
    expect(result.problems).toEqual([]);
    expect(result.model?.name).toBe('code-reviewer');
    expect(result.model?.description).toContain('saga correctness');
    expect(result.model?.tools).toEqual(['Read', 'Grep', 'Glob', 'Bash']);
    expect(result.model?.model).toBe('opus');
    expect(result.model?.body).toContain('Orbit code reviewer');
  });

  it('surfaces the nonexistent SchemaDiff tool reference in migration-writer', () => {
    const result = parseClaudeSubagent(load('.claude/agents/migration-writer.md'));
    expect(result.ok).toBe(true);
    // The analyzer flags this later; the parser must surface it verbatim.
    expect(result.model?.tools).toContain('SchemaDiff');
    expect(result.model?.tools).toEqual(['Read', 'Write', 'Bash', 'SchemaDiff']);
  });
});

describe('parseClaudeSkill', () => {
  it('parses release-notes (no allowed-tools)', () => {
    const result = parseClaudeSkill(load('.claude/skills/release-notes/SKILL.md'));
    expect(result.ok).toBe(true);
    expect(result.model?.name).toBe('release-notes');
    expect(result.model?.allowedTools).toEqual([]);
    expect(result.model?.body).toContain('# Release notes');
  });

  it('parses saga-audit with allowed-tools', () => {
    const result = parseClaudeSkill(load('.claude/skills/saga-audit/SKILL.md'));
    expect(result.ok).toBe(true);
    expect(result.model?.allowedTools).toEqual(['Read', 'Grep', 'Glob']);
  });
});

describe('parseClaudeCommand', () => {
  it('parses fix-issue: paren-aware allowed-tools, $ARGUMENTS, !`cmd` lines', () => {
    const result = parseClaudeCommand(load('.claude/commands/fix-issue.md'));
    expect(result.ok).toBe(true);
    expect(result.model?.allowedTools).toEqual([
      'Bash(gh issue view:*)',
      'Bash(git checkout:*)',
      'Read',
      'Edit',
      'Write',
    ]);
    expect(result.model?.argumentHint).toBe('<issue-number>');
    expect(result.model?.usesArguments).toBe(true);
    // Inert strings only — never executed.
    expect(result.model?.shellCommands).toEqual([
      'git branch --show-current',
      'gh issue view $ARGUMENTS',
    ]);
  });

  it('parses the namespaced review/security command', () => {
    const result = parseClaudeCommand(load('.claude/commands/review/security.md'));
    expect(result.ok).toBe(true);
    expect(result.model?.description).toBe('Security-focused review of the working diff');
    expect(result.model?.allowedTools).toEqual(['Read', 'Grep', 'Bash(git diff:*)']);
    expect(result.model?.usesArguments).toBe(false);
    expect(result.model?.shellCommands).toEqual([]);
  });
});

describe('parseClaudeRule', () => {
  it('parses plain markdown rules with a title', () => {
    const result = parseClaudeRule(load('.claude/rules/testing.md'));
    expect(result.ok).toBe(true);
    expect(result.model?.title).toBe('Testing rules');
    expect(result.model?.body).toContain('Snapshot tests are banned.');
  });
  it('detects $ARGUMENTS in the body only, not in frontmatter', () => {
    const result = parseClaudeCommand(
      '---\nargument-hint: pass $ARGUMENTS here\n---\nNo placeholders in this body.',
    );
    expect(result.ok).toBe(true);
    expect(result.model?.usesArguments).toBe(false);
  });
});

describe('parseClaudeMemory', () => {
  it('parses type/name/description frontmatter', () => {
    const context = parseClaudeMemory(load('.claude/memory/context.md'));
    expect(context.ok).toBe(true);
    expect(context.model?.type).toBe('context');
    expect(context.model?.name).toBe('fulfillment-partners');

    const decision = parseClaudeMemory(load('.claude/memory/decisions.md'));
    expect(decision.model?.type).toBe('decision');
    expect(decision.model?.description).toContain('transactional outbox');
  });
});

describe('parseClaudeSettings', () => {
  it('parses settings.json: model, env, statusLine, permissions, hooks', () => {
    const result = parseClaudeSettings(load('.claude/settings.json'));
    expect(result.ok).toBe(true);
    expect(result.problems).toEqual([]);
    const model = result.model;
    expect(model?.model).toBe('claude-opus-4-5');
    expect(model?.env).toEqual([
      { key: 'NODE_OPTIONS', value: '--max-old-space-size=4096' },
      { key: 'ORBIT_TEST_DB', value: 'postgres://localhost:5432/orbit_test' },
    ]);
    expect(model?.statusLine).toEqual({ type: 'command', command: '.claude/statusline.sh' });
    expect(model?.permissions?.defaultMode).toBe('acceptEdits');
    expect(model?.permissions?.allow).toHaveLength(5);
    expect(model?.permissions?.deny).toContain('Bash(git push:*)');
    expect(model?.permissions?.ask).toEqual(['Bash(npm run db:migrate:*)']);
    expect(model?.permissions?.additionalDirectories).toEqual(['../orbit-contracts']);
    expect(model?.hooks.map((h) => h.event)).toEqual([
      'PreToolUse',
      'PostToolUse',
      'SessionStart',
      'Stop',
    ]);
    expect(model?.hooks[0]?.matcher).toBe('Bash');
    expect(model?.hooks[0]?.hooks).toEqual([
      { type: 'command', command: '.claude/hooks/check-cmd.sh' },
    ]);
    expect(model?.hooks[1]?.matcher).toBe('Edit|Write');
    expect(model?.hooks[3]?.matcher).toBeUndefined();
    expect(model?.unknownKeys).toEqual([]);
  });

  it('parses settings.local.json overrides (fake secrets stay inert strings)', () => {
    const result = parseClaudeSettings(load('.claude/settings.local.json'));
    expect(result.ok).toBe(true);
    expect(result.model?.enableAllProjectMcpServers).toBe(false);
    expect(result.model?.permissions?.allow).toEqual([
      'Bash(docker compose:*)',
      'WebFetch(domain:docs.example.com)',
    ]);
    expect(result.model?.env.map((e) => e.key)).toEqual([
      'OPENAI_API_KEY',
      'GITHUB_TOKEN',
      'ORBIT_BUS_URL',
    ]);
    expect(result.model?.unknownKeys).toEqual([]);
  });
});

describe('parseKeybindings', () => {
  it('treats keybindings.json as opaque JSON with a bindings array', () => {
    const result = parseKeybindings(load('.claude/keybindings.json'));
    expect(result.ok).toBe(true);
    expect(result.model?.bindings).toHaveLength(3);
  });
});

describe('parseClaudeMd', () => {
  it('finds all @import references, including the broken one', () => {
    const result = parseClaudeMd(load('CLAUDE.md'));
    expect(result.ok).toBe(true);
    expect(result.model?.title).toBe('Orbit');
    expect(result.model?.imports.map((i) => i.path)).toEqual([
      'docs/ARCHITECTURE.md',
      '.claude/rules/style.md',
      '.claude/rules/testing.md',
      'docs/ROADMAP.md', // deliberately broken target — parser surfaces it, analyzer flags it
    ]);
    for (const ref of result.model?.imports ?? []) {
      expect(ref.line).toBeGreaterThan(0);
    }
  });

  it('ignores @-tokens inside fenced code blocks and email-like text', () => {
    const result = parseClaudeMd(
      '# T\n\n```bash\ncat @inside/fence.md\n```\n\nmail me at user@example.com\nsee @docs/real.md\n',
    );
    expect(result.model?.imports.map((i) => i.path)).toEqual(['docs/real.md']);
  });

  it('does not let a ~~~ line close a ``` fence (marker-aware tracking)', () => {
    const result = parseClaudeMd('```\n@hidden/a.md\n~~~\n@fake/b.md\n```\n@real/c.md\n');
    expect(result.model?.imports.map((i) => i.path)).toEqual(['real/c.md']);
  });
});

describe('parseMcpJson', () => {
  it('parses stdio, ${VAR} env expansion, and http servers from .mcp.json', () => {
    const result = parseMcpJson(load('.mcp.json'));
    expect(result.ok).toBe(true);
    expect(result.problems).toEqual([]);
    const servers = result.model?.servers ?? [];
    expect(servers.map((s) => s.name)).toEqual(['postgres', 'bus-inspector', 'docs']);

    const postgres = servers[0];
    expect(postgres?.transport).toBe('stdio');
    expect(postgres?.command).toBe('npx');
    expect(postgres?.args).toHaveLength(3);
    expect(postgres?.env).toEqual([{ key: 'PGOPTIONS', value: '-c statement_timeout=5000' }]);
    expect(postgres?.envVarRefs).toEqual([]);

    const bus = servers[1];
    expect(bus?.command).toBe('./tools/bus-mcp');
    expect(bus?.envVarRefs).toEqual(['ORBIT_BUS_URL']);

    const docs = servers[2];
    expect(docs?.type).toBe('http');
    expect(docs?.transport).toBe('http');
    expect(docs?.url).toBe('https://mcp.example.com/docs');
    expect(docs?.headers).toEqual([{ key: 'X-Team', value: 'orbit' }]);
  });
});
