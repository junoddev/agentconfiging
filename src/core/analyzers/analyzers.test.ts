/**
 * Per-analyzer behavior tests: every analyzer has at least one firing and
 * one non-firing case, driven by the committed fixture manifests
 * (fixtures/manifests/*.json → parseManifest → detect → buildAnalyzerInput)
 * or by small synthetic manifests — zero I/O inside analyze().
 */

import fs from 'node:fs';
import path from 'node:path';
import { describe, expect, it } from 'vitest';
import { detect } from '../detectors/index.js';
import { parseManifest, type Manifest } from '../manifest.js';
import { buildAnalyzerInput, type AnalyzerEnv, type AnalyzerInput } from '../report.js';
import { allAnalyzers } from './index.js';
import type { Analyzer } from './types.js';

const manifestsDir = path.resolve(process.cwd(), 'fixtures/manifests');

function loadFixture(name: string, env?: AnalyzerEnv): AnalyzerInput {
  const manifest = parseManifest(
    JSON.parse(fs.readFileSync(path.join(manifestsDir, name), 'utf-8')),
  );
  return buildAnalyzerInput(manifest, detect(manifest), env);
}

/** Synthetic manifest from (path, content) pairs — sizes/hashes are dummies. */
function makeManifest(files: Record<string, string>, cwdBasename = 'proj'): Manifest {
  return {
    root: '/tmp/proj',
    cwdBasename,
    files: Object.entries(files).map(([p, content]) => ({
      path: p,
      size: content.length,
      sha256: '0'.repeat(64),
      content,
    })),
    stats: { fileCount: Object.keys(files).length, totalBytes: 0 },
  };
}

function makeInput(files: Record<string, string>, cwdBasename = 'proj'): AnalyzerInput {
  const manifest = makeManifest(files, cwdBasename);
  return buildAnalyzerInput(manifest, detect(manifest));
}

function analyzer(id: string): Analyzer {
  const found = allAnalyzers().find((a) => a.id === id);
  if (!found) throw new Error(`analyzer not registered: ${id}`);
  return found;
}

describe('broken-import', () => {
  it('fires on claude-rich for the missing docs/ROADMAP.md import', () => {
    const findings = analyzer('broken-import').analyze(loadFixture('claude-rich.json'));
    expect(findings).toHaveLength(1);
    expect(findings[0]?.id).toBe('broken-import-docs-roadmap-md');
    expect(findings[0]?.severity).toBe('warning');
    expect(findings[0]?.detail).toContain('docs/ROADMAP.md');
  });

  it('does not fire when every import resolves', () => {
    const input = makeInput({
      'CLAUDE.md': '# X\n\nSee @docs/GUIDE.md.\n',
      'docs/GUIDE.md': '# Guide\n',
    });
    expect(analyzer('broken-import').analyze(input)).toEqual([]);
  });

  it('skips imports it cannot judge from manifest facts', () => {
    const input = makeInput({
      'CLAUDE.md': '# X\n\n@~/global.md and @../outside.md and @/abs/path.md\n',
    });
    expect(analyzer('broken-import').analyze(input)).toEqual([]);
  });
});

describe('subagent-references-missing-tool', () => {
  it('fires on claude-rich for SchemaDiff in migration-writer', () => {
    const findings = analyzer('subagent-references-missing-tool').analyze(
      loadFixture('claude-rich.json'),
    );
    expect(findings).toHaveLength(1);
    expect(findings[0]?.id).toBe('subagent-references-missing-tool-migration-writer-schemadiff');
    expect(findings[0]?.title).toContain('SchemaDiff');
    // Info, not warning: the known-tools data list WILL lag new harness
    // tools, so an unrecognized name is a hint, not an accusation.
    expect(findings[0]?.severity).toBe('info');
    expect(findings[0]?.detail).toContain('may be a newer tool or a typo');
  });

  it('does not fire for current-harness tools like AskUserQuestion and EnterWorktree', () => {
    const input = makeInput({
      '.claude/agents/ok.md':
        '---\nname: ok\ntools: AskUserQuestion, EnterWorktree, ExitWorktree, Artifact, TaskCreate, Workflow\n---\nBody.\n',
    });
    expect(analyzer('subagent-references-missing-tool').analyze(input)).toEqual([]);
  });

  it('does not fire for known tools, mcp__ names, or patterns', () => {
    const input = makeInput({
      '.claude/agents/ok.md':
        '---\nname: ok\ntools: Read, bash, mcp__db__query, Bash(git:*)\n---\nBody.\n',
    });
    expect(analyzer('subagent-references-missing-tool').analyze(input)).toEqual([]);
  });
});

describe('mcp-command-not-on-path', () => {
  it('is skipped entirely when the env bag is absent', () => {
    const findings = analyzer('mcp-command-not-on-path').analyze(loadFixture('claude-rich.json'));
    expect(findings).toEqual([]);
  });

  it('fires for a bare command missing from env.pathCommands', () => {
    const findings = analyzer('mcp-command-not-on-path').analyze(
      loadFixture('claude-rich.json', { pathCommands: ['node', 'npm'] }),
    );
    // npx (postgres server) missing; ./tools/bus-mcp is path-form and never checked.
    expect(findings).toHaveLength(1);
    expect(findings[0]?.id).toBe('mcp-command-not-on-path-postgres-npx');
  });

  it('does not fire when the command is on PATH', () => {
    const findings = analyzer('mcp-command-not-on-path').analyze(
      loadFixture('claude-rich.json', { pathCommands: ['npx'] }),
    );
    expect(findings).toEqual([]);
  });
});

describe('hook-script-missing', () => {
  it('fires when a hook references a .claude/ script absent from the manifest', () => {
    const input = makeInput({
      '.claude/settings.json': JSON.stringify({
        hooks: {
          PreToolUse: [
            { matcher: 'Bash', hooks: [{ type: 'command', command: './.claude/hooks/gone.sh' }] },
          ],
        },
      }),
    });
    const findings = analyzer('hook-script-missing').analyze(input);
    expect(findings).toHaveLength(1);
    expect(findings[0]?.severity).toBe('error');
    expect(findings[0]?.id).toBe('hook-script-missing-pretooluse-claude-hooks-gone-sh');
  });

  it('does not fire on claude-rich (all hook scripts present)', () => {
    expect(analyzer('hook-script-missing').analyze(loadFixture('claude-rich.json'))).toEqual([]);
  });

  it('ignores bare-executable hook commands', () => {
    const input = makeInput({
      '.claude/settings.json': JSON.stringify({
        hooks: { Stop: [{ hooks: [{ type: 'command', command: 'npx prettier --write .' }] }] },
      }),
    });
    expect(analyzer('hook-script-missing').analyze(input)).toEqual([]);
  });
});

describe('duplicate-rules', () => {
  it('fires on multi-runtime for .cursorrules + .cursor/rules overlap', () => {
    const findings = analyzer('duplicate-rules').analyze(loadFixture('multi-runtime.json'));
    expect(findings.map((f) => f.id)).toContain('duplicate-rules-cursorrules-and-cursor-rules');
  });

  it('fires for two .claude/rules files with the same title', () => {
    const input = makeInput({
      '.claude/rules/a.md': '# Testing rules\n\n- one\n',
      '.claude/rules/b.md': '# Testing rules\n\n- two\n',
    });
    const findings = analyzer('duplicate-rules').analyze(input);
    expect(findings).toHaveLength(1);
    expect(findings[0]?.id).toBe('duplicate-rules-testing-rules');
  });

  it('does not fire for namespaced rules: same title in different directories, different bodies', () => {
    const input = makeInput({
      '.claude/rules/frontend/style.md':
        '# Style\n\n- Components are PascalCase files.\n- CSS modules only, no inline styles.\n',
      '.claude/rules/backend/style.md':
        '# Style\n\n- Handlers are verbNoun functions.\n- SQL lives in the repository layer.\n',
    });
    expect(analyzer('duplicate-rules').analyze(input)).toEqual([]);
  });

  it('fires for same title in different directories when the bodies are near-copies', () => {
    const body = '# Style\n\n- Prettier formats everything.\n- No default exports.\n';
    const input = makeInput({
      '.claude/rules/frontend/style.md': body,
      '.claude/rules/backend/style.md': body,
    });
    const findings = analyzer('duplicate-rules').analyze(input);
    expect(findings.map((f) => f.id)).toEqual(['duplicate-rules-style']);
  });

  it('does not fire on claude-rich (distinct rule titles, no .cursorrules)', () => {
    expect(analyzer('duplicate-rules').analyze(loadFixture('claude-rich.json'))).toEqual([]);
  });
});

describe('conflicting-instructions', () => {
  it('fires on multi-runtime where CLAUDE.md and AGENTS.md share no directives', () => {
    const findings = analyzer('conflicting-instructions').analyze(
      loadFixture('multi-runtime.json'),
    );
    expect(findings).toHaveLength(1);
    expect(findings[0]?.id).toBe('conflicting-instructions-claude-md-agents-md');
    expect(findings[0]?.severity).toBe('warning');
  });

  it('does not fire when the guides share their directives', () => {
    const guide = '# X\n\n- run npm test\n- indent with tabs\n- amounts in cents\n';
    const input = makeInput({ 'CLAUDE.md': guide, 'AGENTS.md': guide });
    expect(analyzer('conflicting-instructions').analyze(input)).toEqual([]);
  });

  it('does not fire on paraphrased directives (token-level similarity, not exact lines)', () => {
    const input = makeInput({
      'CLAUDE.md':
        '# X\n\n- Run `npm test` before committing\n- Currency amounts are integer minor units\n- PSP calls retry 3 times with backoff\n',
      'AGENTS.md':
        '# X\n\n- Before you commit, run npm test\n- Amounts of currency are integer minor units\n- Retry PSP calls 3 times with backoff\n',
    });
    expect(analyzer('conflicting-instructions').analyze(input)).toEqual([]);
  });

  it('does not fire with a single guide (claude-rich)', () => {
    expect(analyzer('conflicting-instructions').analyze(loadFixture('claude-rich.json'))).toEqual(
      [],
    );
  });
});

describe('rules-drift', () => {
  it('fires on multi-runtime where .cursorrules and CLAUDE.md diverge', () => {
    const findings = analyzer('rules-drift').analyze(loadFixture('multi-runtime.json'));
    expect(findings).toHaveLength(1);
    expect(findings[0]?.id).toBe('rules-drift');
  });

  it('does not fire without a .cursorrules file (claude-rich)', () => {
    expect(analyzer('rules-drift').analyze(loadFixture('claude-rich.json'))).toEqual([]);
  });

  it('does not fire when the files agree', () => {
    const input = makeInput({
      '.cursorrules': '- run npm test\n- indent with tabs\n',
      'CLAUDE.md': '# X\n\n- run npm test\n- indent with tabs\n',
    });
    expect(analyzer('rules-drift').analyze(input)).toEqual([]);
  });
});

describe('missing-project-guide', () => {
  it('fires with a create-file fix when Claude Code is detected without CLAUDE.md', () => {
    const input = makeInput({ '.claude/settings.json': '{}' });
    const findings = analyzer('missing-project-guide').analyze(input);
    expect(findings).toHaveLength(1);
    expect(findings[0]?.id).toBe('missing-project-guide-claude-md');
    expect(findings[0]?.fix?.kind).toBe('create-file');
    expect(findings[0]?.fix?.edits[0]?.path).toBe('CLAUDE.md');
  });

  it('points the stub at an existing guide when one exists', () => {
    const input = makeInput({ '.claude/settings.json': '{}', 'AGENTS.md': '# Guide\n- x\n' });
    const findings = analyzer('missing-project-guide').analyze(input);
    const claudeFinding = findings.find((f) => f.id === 'missing-project-guide-claude-md');
    expect(claudeFinding?.fix?.edits[0]?.patch).toContain('AGENTS.md');
  });

  it('does not fire when the guide exists (claude-basic)', () => {
    expect(analyzer('missing-project-guide').analyze(loadFixture('claude-basic.json'))).toEqual([]);
  });

  it('is skipped for global-scope manifests', () => {
    const input = makeInput({ 'settings.json': '{}' }, '.claude');
    expect(analyzer('missing-project-guide').analyze(input)).toEqual([]);
  });
});

describe('no-agents-no-skills', () => {
  it('fires on claude-basic (settings but no agents/skills)', () => {
    const findings = analyzer('no-agents-no-skills').analyze(loadFixture('claude-basic.json'));
    expect(findings.map((f) => f.id)).toEqual(['no-agents-no-skills']);
  });

  it('does not fire on claude-rich (has both)', () => {
    expect(analyzer('no-agents-no-skills').analyze(loadFixture('claude-rich.json'))).toEqual([]);
  });
});

describe('permissive-permissions', () => {
  it('fires for bypassPermissions and wildcard allows', () => {
    const input = makeInput({
      '.claude/settings.json': JSON.stringify({
        permissions: { defaultMode: 'bypassPermissions', allow: ['*', 'Bash(*)'] },
      }),
    });
    const findings = analyzer('permissive-permissions').analyze(input);
    expect(findings).toHaveLength(1);
    expect(findings[0]?.detail).toContain('bypassPermissions');
    expect(findings[0]?.detail).toContain('`*`');
    expect(findings[0]?.detail).toContain('Bash(*)');
  });

  it('checks settings.local.json too', () => {
    const input = makeInput({
      '.claude/settings.local.json': JSON.stringify({ permissions: { allow: ['*'] } }),
    });
    const findings = analyzer('permissive-permissions').analyze(input);
    expect(findings.map((f) => f.id)).toEqual([
      'permissive-permissions-claude-settings-local-json',
    ]);
  });

  it('does not fire on claude-rich (scoped allows, acceptEdits)', () => {
    expect(analyzer('permissive-permissions').analyze(loadFixture('claude-rich.json'))).toEqual([]);
  });
});

describe('settings-local-committed', () => {
  it('fires on claude-rich (settings.local.json present, no .gitignore) with a create-file fix', () => {
    const findings = analyzer('settings-local-committed').analyze(loadFixture('claude-rich.json'));
    expect(findings).toHaveLength(1);
    expect(findings[0]?.severity).toBe('error');
    expect(findings[0]?.fix).toEqual({
      kind: 'create-file',
      edits: [{ path: '.gitignore', patch: '.claude/settings.local.json\n' }],
    });
  });

  it('fires with a replace-file fix when .gitignore exists but lacks the entry', () => {
    const input = makeInput({
      '.claude/settings.local.json': '{}',
      '.gitignore': 'node_modules',
    });
    const findings = analyzer('settings-local-committed').analyze(input);
    expect(findings[0]?.fix).toEqual({
      kind: 'replace-file',
      edits: [{ path: '.gitignore', patch: 'node_modules\n.claude/settings.local.json\n' }],
    });
  });

  it('does not fire when .gitignore already covers it', () => {
    const input = makeInput({
      '.claude/settings.local.json': '{}',
      '.gitignore': '.claude/settings.local.json\n',
    });
    expect(analyzer('settings-local-committed').analyze(input)).toEqual([]);
  });
});

describe('stale-model-ref', () => {
  it('fires at warning with a replace-file fix for a retired model id', () => {
    const settings = JSON.stringify({ model: 'claude-3-opus-20240229' });
    const input = makeInput({ '.claude/settings.json': settings });
    const findings = analyzer('stale-model-ref').analyze(input);
    expect(findings).toHaveLength(1);
    expect(findings[0]?.severity).toBe('warning');
    expect(findings[0]?.fix?.kind).toBe('replace-file');
    expect(findings[0]?.fix?.edits[0]?.patch).toBe(JSON.stringify({ model: 'claude-opus-4-5' }));
  });

  it('constrains the fix to the model field: a stale id inside an env string survives', () => {
    const settings = JSON.stringify({
      model: 'claude-3-opus-20240229',
      env: { NOTE: 'we benchmarked claude-3-opus-20240229 back then' },
    });
    const input = makeInput({ '.claude/settings.json': settings });
    const findings = analyzer('stale-model-ref').analyze(input);
    expect(findings).toHaveLength(1);
    const patch = findings[0]?.fix?.edits[0]?.patch ?? '';
    expect(patch).toContain('"model":"claude-opus-4-5"');
    expect(patch).toContain('we benchmarked claude-3-opus-20240229 back then');
  });

  it('rewrites only the frontmatter model line, not the body', () => {
    const content =
      '---\nname: x\nmodel: claude-3-5-sonnet-20241022\n---\n\nTuned for claude-3-5-sonnet-20241022 output.\n';
    const input = makeInput({ '.claude/agents/x.md': content });
    const findings = analyzer('stale-model-ref').analyze(input);
    expect(findings).toHaveLength(1);
    const patch = findings[0]?.fix?.edits[0]?.patch ?? '';
    expect(patch).toContain('model: claude-sonnet-4-5\n');
    expect(patch).toContain('Tuned for claude-3-5-sonnet-20241022 output.');
  });

  it('fires at info for a versioned id in neither list', () => {
    const input = makeInput({
      '.claude/agents/x.md': '---\nname: x\nmodel: claude-sonnet-9-9\n---\nBody.\n',
    });
    const findings = analyzer('stale-model-ref').analyze(input);
    expect(findings).toHaveLength(1);
    expect(findings[0]?.severity).toBe('info');
    expect(findings[0]?.fix).toBeUndefined();
  });

  it('does not fire on claude-rich (current id + aliases)', () => {
    expect(analyzer('stale-model-ref').analyze(loadFixture('claude-rich.json'))).toEqual([]);
  });
});

describe('tiny-project-guide', () => {
  it('fires for a sub-200-char guide', () => {
    const input = makeInput({ 'CLAUDE.md': '# Tiny\n\nUse good judgment.\n' });
    const findings = analyzer('tiny-project-guide').analyze(input);
    expect(findings.map((f) => f.id)).toEqual(['tiny-project-guide-claude-md']);
  });

  it('does not fire on claude-rich (substantive guide)', () => {
    expect(analyzer('tiny-project-guide').analyze(loadFixture('claude-rich.json'))).toEqual([]);
  });
});
