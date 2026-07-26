/**
 * Fixture tests for the pure instruction-sync engine (bead agentconfig-wmc.10).
 * Content in → plan out, no I/O. Pins the format-mapping decisions: verbatim
 * body, synthesized frontmatter for frontmattered targets, shared-file collapse,
 * source self-skip, and status computation.
 */

import { describe, expect, it } from 'vitest';
import { getRuntimeFormat, listSyncTargets, RUNTIME_FORMATS } from '../runtimes/index.js';
import type { RuntimeFormat } from '../runtimes/index.js';
import { syncPlan, syncStatus, targetPath } from './engine.js';

function rt(id: string): RuntimeFormat {
  const format = getRuntimeFormat(id);
  if (!format) throw new Error(`no runtime ${id}`);
  return format;
}

const CLAUDE_MD = '# Project rules\n\n- Run `npm test` before committing.\n- Keep PRs small.\n';

describe('targetPath', () => {
  it('uses the primary single file when the first location is a file', () => {
    expect(targetPath(rt('claude-code'))).toBe('CLAUDE.md');
    expect(targetPath(rt('cline'))).toBe('.clinerules');
    expect(targetPath(rt('windsurf'))).toBe('.windsurfrules');
    expect(targetPath(rt('zed'))).toBe('.rules');
  });

  it('uses the scaffold rule file when the primary location is a directory', () => {
    expect(targetPath(rt('cursor'))).toBe('.cursor/rules/project.mdc');
    expect(targetPath(rt('amazon-q'))).toBe('.amazonq/rules/project.md');
    expect(targetPath(rt('roo'))).toBe('.roo/rules/project.md');
  });
});

describe('syncPlan — markdown source', () => {
  const source = { path: 'CLAUDE.md', content: CLAUDE_MD };

  it('copies the body verbatim to a plain-markdown target', () => {
    const plan = syncPlan(source, [rt('codex')]);
    expect(plan).toHaveLength(1);
    const entry = plan[0]!;
    expect(entry.path).toBe('AGENTS.md');
    // Body preserved exactly (single trailing newline already present).
    expect(entry.content).toBe(CLAUDE_MD);
    expect(entry.lossy).toBe(false);
  });

  it('synthesizes cursor frontmatter and keeps the body below it', () => {
    const plan = syncPlan(source, [rt('cursor')]);
    const entry = plan[0]!;
    expect(entry.path).toBe('.cursor/rules/project.mdc');
    expect(entry.content).toBe(
      `---\ndescription: Project rules\nalwaysApply: true\n---\n\n${CLAUDE_MD}`,
    );
    expect(entry.lossy).toBe(true);
    expect(entry.note).toContain('frontmatter synthesized');
  });

  it('synthesizes continue frontmatter keyed on name', () => {
    const plan = syncPlan(source, [rt('continue')]);
    const entry = plan[0]!;
    expect(entry.content.startsWith('---\nname: Project rules\n---\n\n')).toBe(true);
    expect(entry.content.endsWith(CLAUDE_MD)).toBe(true);
  });

  it('collapses runtimes that share a file into one entry', () => {
    const plan = syncPlan(source, [rt('codex'), rt('opencode')]);
    expect(plan).toHaveLength(1);
    expect(plan[0]!.path).toBe('AGENTS.md');
    expect(plan[0]!.runtimeIds).toEqual(['codex', 'opencode']);
  });

  it('skips a target that would regenerate the source itself', () => {
    const agentsSource = { path: 'AGENTS.md', content: CLAUDE_MD };
    const plan = syncPlan(agentsSource, [rt('codex'), rt('opencode'), rt('claude-code')]);
    // codex + opencode both map to AGENTS.md (== source) → skipped; only CLAUDE.md remains.
    expect(plan.map((e) => e.path)).toEqual(['CLAUDE.md']);
  });

  it('flags rules-dir targets as written to one rule file', () => {
    const plan = syncPlan(source, [rt('amazon-q')]);
    expect(plan[0]!.note).toContain('written as one rule file');
    expect(plan[0]!.lossy).toBe(true);
  });

  it('marks a default description when the source has no H1', () => {
    const plan = syncPlan({ path: 'CLAUDE.md', content: '- just a bullet\n' }, [rt('cursor')]);
    expect(plan[0]!.content.startsWith('---\ndescription: Project conventions\n')).toBe(true);
  });
});

describe('syncPlan — frontmattered source', () => {
  it('strips source frontmatter before flowing the body to a markdown target', () => {
    const source = {
      path: '.cursor/rules/project.mdc',
      content: '---\ndescription: x\nalwaysApply: true\n---\n\n# Heading\n\n- do a thing\n',
    };
    const plan = syncPlan(source, [rt('claude-code')]);
    const entry = plan[0]!;
    expect(entry.path).toBe('CLAUDE.md');
    expect(entry.content).toBe('# Heading\n\n- do a thing\n');
    expect(entry.note).toContain('source frontmatter dropped');
  });
});

describe('syncPlan — all targets', () => {
  it('plans every runtime except the source without throwing', () => {
    const plan = syncPlan({ path: 'CLAUDE.md', content: CLAUDE_MD }, listSyncTargets());
    // Every entry has a non-empty concrete path and content.
    expect(plan.length).toBeGreaterThan(5);
    for (const entry of plan) {
      expect(entry.path).not.toBe('CLAUDE.md');
      expect(entry.path.endsWith('/')).toBe(false);
      expect(entry.content.length).toBeGreaterThan(0);
    }
  });

  it('never emits a path outside the known runtime target set', () => {
    const known = new Set(RUNTIME_FORMATS.map((r) => targetPath(r)));
    const plan = syncPlan({ path: 'CLAUDE.md', content: CLAUDE_MD }, listSyncTargets());
    for (const entry of plan) expect(known.has(entry.path)).toBe(true);
  });
});

describe('syncStatus', () => {
  it('is new when the target is absent', () => {
    expect(syncStatus('x\n', undefined)).toBe('new');
  });
  it('is in-sync on an exact match', () => {
    expect(syncStatus('x\n', 'x\n')).toBe('in-sync');
  });
  it('is changed on any difference', () => {
    expect(syncStatus('x\n', 'y\n')).toBe('changed');
  });
});
