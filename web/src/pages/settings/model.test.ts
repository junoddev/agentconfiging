import { describe, expect, it } from 'vitest';
import {
  emptyModel,
  hasRedactions,
  parseSettings,
  serializeSettings,
  type SettingsModel,
} from './model.js';

describe('hasRedactions', () => {
  it('is true only when a file carries redaction spans', () => {
    expect(hasRedactions([])).toBe(false);
    expect(hasRedactions([{ start: 0, end: 5, id: 'openai' }])).toBe(true);
  });
});

describe('parseSettings', () => {
  it('extracts the managed fields', () => {
    const parsed = parseSettings(
      JSON.stringify({
        model: 'claude-opus-4-5',
        permissions: { defaultMode: 'acceptEdits', allow: ['Read(src/**)'], deny: ['Read(.env)'] },
        env: { NODE_OPTIONS: '--max-old-space-size=4096' },
        statusLine: { type: 'command', command: '.claude/statusline.sh' },
      }),
    );
    expect(parsed.ok).toBe(true);
    if (!parsed.ok) return;
    expect(parsed.model.model).toBe('claude-opus-4-5');
    expect(parsed.model.defaultMode).toBe('acceptEdits');
    expect(parsed.model.allow).toEqual(['Read(src/**)']);
    expect(parsed.model.deny).toEqual(['Read(.env)']);
    expect(parsed.model.ask).toEqual([]);
    expect(parsed.model.env).toEqual([['NODE_OPTIONS', '--max-old-space-size=4096']]);
    expect(parsed.model.statusLineCommand).toBe('.claude/statusline.sh');
  });

  it('reports hooks presence without editing them', () => {
    const parsed = parseSettings(JSON.stringify({ hooks: { PreToolUse: [], PostToolUse: [] } }));
    expect(parsed.ok).toBe(true);
    if (!parsed.ok) return;
    expect(parsed.hasHooks).toBe(true);
    expect(parsed.hookEventCount).toBe(2);
  });

  it('fails on invalid JSON and on non-object roots', () => {
    expect(parseSettings('{not json').ok).toBe(false);
    expect(parseSettings('[]').ok).toBe(false);
    expect(parseSettings('"x"').ok).toBe(false);
  });

  it('parses redacted content (values are placeholders, still valid JSON)', () => {
    const parsed = parseSettings(JSON.stringify({ env: { OPENAI_KEY: '[REDACTED:openai]' } }));
    expect(parsed.ok).toBe(true);
    if (!parsed.ok) return;
    expect(parsed.model.env).toEqual([['OPENAI_KEY', '[REDACTED:openai]']]);
  });
});

describe('serializeSettings', () => {
  it('round-trips managed fields and preserves unknown keys (hooks)', () => {
    const raw = {
      model: 'old',
      hooks: { PreToolUse: [{ matcher: 'Bash' }] },
      permissions: { additionalDirectories: ['../shared'], allow: ['Read(a)'] },
    };
    const parsed = parseSettings(JSON.stringify(raw));
    expect(parsed.ok).toBe(true);
    if (!parsed.ok) return;

    const edited: SettingsModel = {
      ...parsed.model,
      model: 'claude-new',
      allow: ['Read(a)', 'Bash(npm test:*)'],
    };
    const out = serializeSettings(parsed.raw, edited);
    const reparsed = JSON.parse(out) as Record<string, unknown>;

    expect(reparsed['model']).toBe('claude-new');
    // Unknown keys survive untouched.
    expect(reparsed['hooks']).toEqual({ PreToolUse: [{ matcher: 'Bash' }] });
    const perms = reparsed['permissions'] as Record<string, unknown>;
    expect(perms['additionalDirectories']).toEqual(['../shared']);
    expect(perms['allow']).toEqual(['Read(a)', 'Bash(npm test:*)']);
    expect(out.endsWith('\n')).toBe(true);
  });

  it('deletes emptied fields rather than writing blanks', () => {
    const parsed = parseSettings(
      JSON.stringify({ model: 'x', env: { A: '1' }, permissions: { allow: ['Read(a)'] } }),
    );
    expect(parsed.ok).toBe(true);
    if (!parsed.ok) return;

    const cleared: SettingsModel = {
      ...emptyModel(),
    };
    const out = serializeSettings(parsed.raw, cleared);
    const reparsed = JSON.parse(out) as Record<string, unknown>;
    expect('model' in reparsed).toBe(false);
    expect('env' in reparsed).toBe(false);
    expect('permissions' in reparsed).toBe(false);
  });

  it('drops blank env keys and trims list rules', () => {
    const model: SettingsModel = {
      ...emptyModel(),
      env: [
        ['', 'orphan'],
        ['KEEP', 'v'],
      ],
      allow: ['  Read(a)  ', '', '  '],
    };
    const out = serializeSettings({}, model);
    const reparsed = JSON.parse(out) as Record<string, unknown>;
    expect(reparsed['env']).toEqual({ KEEP: 'v' });
    expect((reparsed['permissions'] as Record<string, unknown>)['allow']).toEqual(['Read(a)']);
  });

  it('writes statusLine only when a command is present', () => {
    const withCmd = serializeSettings(
      {},
      { ...emptyModel(), statusLineType: 'command', statusLineCommand: './s.sh' },
    );
    expect((JSON.parse(withCmd) as Record<string, unknown>)['statusLine']).toEqual({
      type: 'command',
      command: './s.sh',
    });
    const without = serializeSettings({}, emptyModel());
    expect('statusLine' in (JSON.parse(without) as Record<string, unknown>)).toBe(false);
  });
});
