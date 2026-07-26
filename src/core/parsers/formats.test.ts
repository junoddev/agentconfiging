import fs from 'node:fs';
import path from 'node:path';
import { describe, expect, it } from 'vitest';
import { parseFrontmatter } from './frontmatter.js';
import { parseJson, parseJsonRecord } from './json.js';
import { parseToml } from './toml.js';
import { parseYaml } from './yaml.js';
import { parseClaudeMd, parseClaudeSettings, parseClaudeSubagent } from './claude.js';
import { mcpServersFromValue } from './mcp.js';
import { parseCursorRule } from './cursor.js';
import { parseCopilotInstructions } from './copilot.js';
import { parseGuide } from './guides.js';
import { MAX_PROBLEMS, scrubMessage, type ParseProblem } from './result.js';
import { isRecord, sanitize, MAX_INPUT_LENGTH, type SafeRecord } from './values.js';

const treesDir = path.resolve(process.cwd(), 'fixtures/trees');

function load(rel: string): string {
  return fs.readFileSync(path.join(treesDir, rel), 'utf-8');
}

// ---------------------------------------------------------------------------
// Malformed / adversarial input — parsers never throw.

describe('malformed input resilience', () => {
  it('salvages truncated YAML frontmatter', () => {
    const result = parseClaudeSubagent('---\nname: partial\ndescription: cut off mid-file');
    expect(result.ok).toBe(true);
    expect(result.model?.name).toBe('partial');
    expect(result.problems.some((p) => p.message.includes('unterminated frontmatter'))).toBe(true);
  });

  it('reports an unclosed TOML table without throwing', () => {
    const result = parseToml('[server\nkey = "value"\n');
    expect(result.ok).toBe(false);
    expect(result.problems.length).toBeGreaterThan(0);
  });

  it('never pollutes Object.prototype via __proto__ keys', () => {
    const result = parseJsonRecord('{"__proto__": {"polluted": true}, "a": 1}');
    expect(result.ok).toBe(true);
    expect(({} as Record<string, unknown>)['polluted']).toBeUndefined();
    expect(result.model?.['a']).toBe(1);
    // The key survives as an inert own data property on a null-proto record.
    expect(Object.keys(result.model ?? {})).toContain('__proto__');

    const settings = parseClaudeSettings('{"env": {"__proto__": "x", "constructor": "y"}}');
    expect(settings.ok).toBe(true);
    expect(settings.model?.env).toEqual([
      { key: '__proto__', value: 'x' },
      { key: 'constructor', value: 'y' },
    ]);
    expect(({} as Record<string, unknown>)['polluted']).toBeUndefined();
  });

  it('caps 1000-deep nesting instead of walking it', () => {
    const deep = '['.repeat(1000) + ']'.repeat(1000);
    const json = parseJson(deep);
    expect(json.ok).toBe(true);
    expect(json.problems.some((p) => p.message.includes('nesting deeper'))).toBe(true);

    const yaml = parseYaml(deep); // also valid YAML flow sequence
    expect(yaml.ok).toBe(true);
    expect(yaml.problems.some((p) => p.message.includes('nesting deeper'))).toBe(true);
  });

  it('rejects binary garbage without throwing', () => {
    const garbage = '\x00\x01\x02\xff\xfePK\x03\x04binary';
    expect(parseJson(garbage).ok).toBe(false);
    expect(parseToml(garbage).ok).toBe(false);
    expect(() => parseYaml(garbage)).not.toThrow();
    const fm = parseFrontmatter(garbage);
    expect(fm.hasFrontmatter).toBe(false);
    expect(fm.body).toBe(garbage);
  });

  it('handles empty strings consistently (all structured parsers fail)', () => {
    expect(parseJson('').ok).toBe(false);
    expect(parseJson('').problems).toEqual([{ path: '$', message: 'empty input' }]);
    expect(parseToml('').ok).toBe(false);
    expect(parseYaml('').ok).toBe(false);
    expect(parseYaml('  \n ').ok).toBe(false);
    const guide = parseGuide('');
    expect(guide.ok).toBe(true);
    expect(guide.problems.some((p) => p.message === 'empty content')).toBe(true);
  });

  it('bounds YAML alias expansion (billion laughs)', () => {
    const bomb = [
      'a: &a [1, 1, 1, 1, 1, 1, 1, 1, 1, 1]',
      'b: &b [*a, *a, *a, *a, *a, *a, *a, *a, *a, *a]',
      'c: &c [*b, *b, *b, *b, *b, *b, *b, *b, *b, *b]',
      'd: &d [*c, *c, *c, *c, *c, *c, *c, *c, *c, *c]',
    ].join('\n');
    expect(() => parseYaml(bomb)).not.toThrow();
  });
});

// ---------------------------------------------------------------------------
// Cursor .mdc rules

describe('parseCursorRule', () => {
  it('parses strict-YAML list globs (typescript.mdc)', () => {
    const result = parseCursorRule(load('cursor-basic/.cursor/rules/typescript.mdc'));
    expect(result.ok).toBe(true);
    expect(result.problems).toEqual([]);
    expect(result.model?.globs).toEqual(['src/**/*.ts', 'src/**/*.tsx']);
    expect(result.model?.alwaysApply).toBe(false);
  });

  it('parses the alwaysApply variant (api-design.mdc)', () => {
    const result = parseCursorRule(load('cursor-basic/.cursor/rules/api-design.mdc'));
    expect(result.ok).toBe(true);
    expect(result.model?.alwaysApply).toBe(true);
    expect(result.model?.globs).toEqual([]);
  });

  it('salvages bare comma-separated globs, which are not strict YAML (components.mdc)', () => {
    const result = parseCursorRule(load('cursor-basic/.cursor/rules/components.mdc'));
    expect(result.ok).toBe(true);
    expect(result.model?.globs).toEqual(['*.tsx', 'src/components/**']);
    expect(result.model?.description).toBe('React component conventions');
    expect(result.model?.alwaysApply).toBe(false);
    expect(result.problems.length).toBeGreaterThan(0); // non-strict YAML reported
  });
});

// ---------------------------------------------------------------------------
// Copilot instructions

describe('parseCopilotInstructions', () => {
  it('parses repo-wide instructions without frontmatter', () => {
    const result = parseCopilotInstructions(load('copilot-basic/.github/copilot-instructions.md'));
    expect(result.ok).toBe(true);
    expect(result.problems).toEqual([]);
    expect(result.model?.applyTo).toEqual([]);
    expect(result.model?.title).toBe('Copilot instructions for billing-service');
  });

  it('parses path-scoped applyTo instructions', () => {
    const result = parseCopilotInstructions(
      load('copilot-basic/.github/instructions/api.instructions.md'),
    );
    expect(result.ok).toBe(true);
    expect(result.model?.applyTo).toEqual(['app/api/**/*.py']);
  });
});

// ---------------------------------------------------------------------------
// Plain-markdown guides: AGENTS.md / GEMINI.md / .cursorrules

describe('parseGuide', () => {
  it('parses AGENTS.md structure', () => {
    const result = parseGuide(load('codex-basic/AGENTS.md'));
    expect(result.ok).toBe(true);
    expect(result.model?.title).toBe('Agent guide — data-pipeline');
    expect(result.model?.headings).toContainEqual({ level: 2, text: 'Working here' });
  });

  it('parses GEMINI.md and untitled .cursorrules', () => {
    expect(parseGuide(load('gemini-basic/GEMINI.md')).model?.title).toBe(
      'Gemini CLI guide — ml-notebooks',
    );
    const cursorrules = parseGuide(load('cursor-basic/.cursorrules'));
    expect(cursorrules.ok).toBe(true);
    expect(cursorrules.model?.title).toBeUndefined();
    expect(cursorrules.model?.body).toContain('integer cents');
  });
});

// ---------------------------------------------------------------------------
// Generic format parsers over the other runtimes' fixtures

describe('TOML: codex-global config.toml', () => {
  it('parses model, mcp_servers, and profiles', () => {
    const result = parseToml(load('codex-global/config.toml'));
    expect(result.ok).toBe(true);
    const model = result.model as SafeRecord;
    expect(model['model']).toBe('gpt-5-codex');
    expect(model['approval_policy']).toBe('on-request');
    const mcpServers = model['mcp_servers'];
    expect(isRecord(mcpServers)).toBe(true);
    const docs = (mcpServers as SafeRecord)['docs'] as SafeRecord;
    expect(docs['command']).toBe('npx');
    expect((docs['env'] as SafeRecord)['DOCS_ROOT']).toBe('./docs');
    const profiles = model['profiles'] as SafeRecord;
    expect((profiles['fast'] as SafeRecord)['model']).toBe('gpt-5-codex-mini');
  });
});

describe('YAML: continue config.yaml and aider .aider.conf.yml', () => {
  it('parses continue config.yaml models and rules', () => {
    const result = parseYaml(load('continue-basic/.continue/config.yaml'));
    expect(result.ok).toBe(true);
    const model = result.model as SafeRecord;
    expect(Array.isArray(model['models'])).toBe(true);
    expect((model['models'] as unknown[]).length).toBe(2);
    expect((model['rules'] as unknown[]).length).toBe(2);
  });

  it('parses .aider.conf.yml', () => {
    const result = parseYaml(load('aider-basic/.aider.conf.yml'));
    expect(result.ok).toBe(true);
    const model = result.model as SafeRecord;
    expect(model['model']).toBe('sonnet');
    expect(model['read']).toEqual(['CONVENTIONS.md']);
    expect(model['lint-cmd']).toBe('ruff check --fix');
  });
});

describe('JSON: continue legacy config.json, gemini settings, opencode', () => {
  it('parses continue legacy config.json', () => {
    const result = parseJsonRecord(load('continue-basic/.continue/config.json'));
    expect(result.ok).toBe(true);
    expect((result.model?.['customCommands'] as unknown[]).length).toBe(1);
  });

  it('extracts mcpServers from nested gemini v2 settings.json', () => {
    const result = parseJsonRecord(load('gemini-basic/.gemini/settings.json'));
    expect(result.ok).toBe(true);
    const problems: ParseProblem[] = [];
    const servers = mcpServersFromValue(result.model?.['mcpServers'], '$.mcpServers', problems);
    expect(problems).toEqual([]);
    expect(servers).toHaveLength(1);
    expect(servers[0]?.name).toBe('papers');
    expect(servers[0]?.command).toBe('uvx');
    expect(servers[0]?.transport).toBe('stdio');
  });

  it('parses opencode.json including array-form mcp commands', () => {
    const result = parseJsonRecord(load('opencode-basic/opencode.json'));
    expect(result.ok).toBe(true);
    expect(result.model?.['model']).toBe('anthropic/claude-sonnet-4-5');
    const problems: ParseProblem[] = [];
    const servers = mcpServersFromValue(result.model?.['mcp'], '$.mcp', problems);
    expect(servers).toHaveLength(1);
    expect(servers[0]?.command).toBe('npx');
    expect(servers[0]?.args).toEqual(['-y', 'grafana-mcp']);
    expect(servers[0]?.transport).toBe('local');
  });

  it('parses opencode frontmattered command/agent markdown', () => {
    const command = parseFrontmatter(load('opencode-basic/.opencode/command/deploy.md'));
    expect(command.hasFrontmatter).toBe(true);
    expect(command.data['agent']).toBe('build');
    expect(command.body).toContain('$ARGUMENTS');

    const agent = parseFrontmatter(load('opencode-basic/.opencode/agent/reviewer.md'));
    expect(agent.data['mode']).toBe('subagent');
    const tools = agent.data['tools'];
    expect(isRecord(tools)).toBe(true);
    expect((tools as SafeRecord)['write']).toBe(false);
  });
});

// ---------------------------------------------------------------------------
// Adversarial-review round: cycles, DAGs, budgets, caps, scrubbing, dup keys.

describe('cyclic and shared alias graphs (review blocker)', () => {
  it('collapses the 14-byte cyclic alias bomb instead of expanding it', () => {
    // yaml's toJS legally returns a CYCLIC object for this input; without
    // cycle detection the sanitize walk would attempt 2^MAX_DEPTH expansion.
    const started = Date.now();
    const result = parseYaml('a: &a [*a, *a]');
    expect(Date.now() - started).toBeLessThan(1000);
    expect(result.problems.length).toBeGreaterThan(0);
    if (result.ok) {
      expect(result.problems.some((p) => p.message.includes('cyclic references'))).toBe(true);
      // The collapsed model is acyclic and JSON-serializable.
      expect(() => JSON.stringify(result.model)).not.toThrow();
    }
  });

  it('collapses an object-level cycle (map referencing itself)', () => {
    const result = parseYaml('root: &r\n  self: *r\n  n: 1');
    expect(result.problems.some((p) => p.message.includes('cyclic references'))).toBe(true);
    if (result.ok) {
      const root = (result.model as SafeRecord)['root'] as SafeRecord;
      expect(root['self']).toBeNull();
      expect(root['n']).toBe(1);
      expect(() => JSON.stringify(result.model)).not.toThrow();
    }
  });

  it('keeps SHARED (non-cyclic) anchors: same anchor referenced twice', () => {
    const result = parseYaml('common: &c [1, 2]\nagentA: *c\nagentB: *c');
    expect(result.ok).toBe(true);
    const model = result.model as SafeRecord;
    expect(model['common']).toEqual([1, 2]);
    expect(model['agentA']).toEqual([1, 2]);
    expect(model['agentB']).toEqual([1, 2]);
    expect(result.problems).toEqual([]);
  });

  it('keeps single-use anchors', () => {
    const result = parseYaml('x: &x [1, 2]\ny: *x');
    expect(result.ok).toBe(true);
    const model = result.model as SafeRecord;
    expect(model['x']).toEqual([1, 2]);
    expect(model['y']).toEqual([1, 2]);
    expect(result.problems).toEqual([]);
  });

  it('keeps Continue-style merge-key blocks (<<: *defaults)', () => {
    const src = [
      'defaults: &d',
      '  provider: anthropic',
      '  model: claude-sonnet-4-5',
      'main:',
      '  <<: *d',
      '  name: main',
    ].join('\n');
    const result = parseYaml(src);
    expect(result.ok).toBe(true);
    const main = (result.model as SafeRecord)['main'] as SafeRecord;
    // Whether or not the yaml lib applies the 1.1 merge semantics, the
    // aliased defaults must survive — never collapse to null.
    const provider = main['provider'] ?? (main['<<'] as SafeRecord | undefined)?.['provider'];
    expect(provider).toBe('anthropic');
    expect(main['name']).toBe('main');
  });

  it('collapses a branching-2 alias DAG instead of expanding 2^30 nodes', () => {
    const lines = ['x0: &x0 [1, 1]'];
    for (let i = 1; i < 30; i += 1) {
      lines.push(`x${i}: &x${i} [*x${i - 1}, *x${i - 1}]`);
    }
    const started = Date.now();
    const result = parseYaml(lines.join('\n'));
    expect(Date.now() - started).toBeLessThan(1000);
    // Either the alias budget rejected it or sanitize collapsed the shared
    // nodes — both are safe; it must return quickly with a report.
    expect(result.problems.length).toBeGreaterThan(0);
    if (result.ok) expect(() => JSON.stringify(result.model)).not.toThrow();
  });

  it('enforces the total node budget on huge (acyclic) structures', () => {
    const huge = Array.from({ length: 150_000 }, () => [] as unknown[]);
    const { problems } = sanitize(huge);
    expect(problems.some((p) => p.message.includes('node budget'))).toBe(true);
  });
});

describe('input-size and nesting guards', () => {
  it('rejects oversized input unparsed at every public entry', () => {
    const big = 'x'.repeat(MAX_INPUT_LENGTH + 1);
    for (const parse of [
      parseJson,
      parseYaml,
      parseToml,
      parseClaudeSubagent,
      parseClaudeMd,
      parseGuide,
      parseCursorRule,
      parseCopilotInstructions,
    ] as Array<(content: string) => { ok: boolean; problems: ParseProblem[] }>) {
      const result = parse(big);
      expect(result.ok).toBe(false);
      expect(result.problems.some((p) => p.message.includes('exceeds'))).toBe(true);
    }
  });

  it("rejects the reviewer's 1MB-of-braces case instantly", () => {
    const braces = '{'.repeat(1024 * 1024);
    const started = Date.now();
    const result = parseYaml(braces);
    expect(Date.now() - started).toBeLessThan(500);
    expect(result.ok).toBe(false);
  });

  it('rejects in-cap pathological bracket nesting before parsing (yaml)', () => {
    // 64 KiB of '{' is within the size cap but costs ~18s inside the yaml
    // library's error recovery — the flow pre-scan must reject it.
    const braces = '{'.repeat(64 * 1024);
    const started = Date.now();
    const result = parseYaml(braces);
    expect(Date.now() - started).toBeLessThan(500);
    expect(result.ok).toBe(false);
    expect(result.problems.some((p) => p.message.includes('bracket nesting'))).toBe(true);
    // Same guard on the frontmatter path.
    const fm = parseClaudeSubagent(`---\n${'{'.repeat(64 * 1024)}`);
    expect(fm.problems.some((p) => p.message.includes('bracket nesting'))).toBe(true);
    // Brackets inside quoted scalars do not trip the guard.
    expect(parseYaml(`k: "${'{'.repeat(5000)}"`).ok).toBe(true);
  });
});

describe('duplicate keys are reported (yaml/toml; json documented)', () => {
  it('reports yaml duplicate keys, last value wins', () => {
    const result = parseYaml('deny: [a]\ndeny: [b]');
    expect(result.ok).toBe(true);
    expect((result.model as SafeRecord)['deny']).toEqual(['b']);
    expect(result.problems.some((p) => /unique|duplicate/i.test(p.message))).toBe(true);
  });

  it('reports frontmatter duplicate keys without triggering the lenient fallback', () => {
    const result = parseClaudeSubagent('---\nname: one\nname: two\n---\nbody');
    expect(result.ok).toBe(true);
    expect(result.model?.name).toBe('two');
    expect(result.problems.some((p) => /unique|duplicate/i.test(p.message))).toBe(true);
    expect(result.problems.some((p) => p.message.includes('salvaged'))).toBe(false);
  });

  it('reports toml duplicate keys (hard error in TOML)', () => {
    const result = parseToml('a = 1\na = 2');
    expect(result.ok).toBe(false);
    expect(result.problems.length).toBeGreaterThan(0);
  });
});

describe('problem hygiene', () => {
  it('scrubs control characters out of every problem message', () => {
    const esc = String.fromCharCode(27);
    const bel = String.fromCharCode(7);
    expect(scrubMessage(`a${esc}[31mb${bel}`)).toBe(`a [31mb `);
    const inputs = [`k: "${esc}[31munterminated`, `${esc}[31m: *${bel}missing`, `a: 1\na: ${esc}2`];
    for (const input of inputs) {
      for (const p of parseYaml(input).problems) {
        for (let i = 0; i < p.message.length; i += 1) {
          expect(p.message.charCodeAt(i)).toBeGreaterThanOrEqual(0x20);
        }
      }
    }
  });

  it('caps the problems list with an overflow marker', () => {
    const allow = JSON.stringify({ permissions: { allow: Array(250).fill(0) } });
    const result = parseClaudeSettings(allow);
    expect(result.ok).toBe(true);
    expect(result.problems).toHaveLength(MAX_PROBLEMS + 1);
    expect(result.problems[MAX_PROBLEMS]?.message).toContain('truncated');
  });
});

describe('wrong-typed present fields always report (silent-drop sweep)', () => {
  it('reports wrong-typed settings fields', () => {
    const result = parseClaudeSettings(
      JSON.stringify({
        model: 5,
        statusLine: { type: 7, command: [] },
        enableAllProjectMcpServers: 'yes',
        permissions: { defaultMode: 1 },
        hooks: { Stop: [{ matcher: 3, hooks: [{ command: ['a'], timeout: '5s' }] }] },
      }),
    );
    expect(result.ok).toBe(true);
    const paths = result.problems.map((p) => p.path);
    expect(paths).toContain('$.model');
    expect(paths).toContain('$.statusLine.type');
    expect(paths).toContain('$.statusLine.command');
    expect(paths).toContain('$.enableAllProjectMcpServers');
    expect(paths).toContain('$.permissions.defaultMode');
    expect(paths).toContain('$.hooks.Stop[0].matcher');
    expect(paths).toContain('$.hooks.Stop[0].hooks[0].command');
    expect(paths).toContain('$.hooks.Stop[0].hooks[0].timeout');
  });

  it('reports wrong-typed mcp fields', () => {
    const problems: ParseProblem[] = [];
    const servers = mcpServersFromValue({ s: { url: 123, type: 9 } }, '$.mcpServers', problems);
    expect(servers).toHaveLength(1);
    const paths = problems.map((p) => p.path);
    expect(paths).toContain('$.mcpServers.s.url');
    expect(paths).toContain('$.mcpServers.s.type');
  });

  it('reports wrong-typed cursor rule fields', () => {
    const result = parseCursorRule('---\ndescription: 5\nalwaysApply: sometimes\n---\nbody');
    expect(result.ok).toBe(true);
    const paths = result.problems.map((p) => p.path);
    expect(paths).toContain('frontmatter.description');
    expect(paths).toContain('frontmatter.alwaysApply');
  });
});

describe('fence tracking is marker-aware', () => {
  it('does not let ~~~ close a ``` fence when scanning headings', () => {
    const md = '```\n~~~\n# NotATitle\n```\n# Real title\n';
    expect(parseGuide(md).model?.title).toBe('Real title');
  });
});
