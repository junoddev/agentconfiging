import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { describe, expect, it } from 'vitest';
import { createClaudeExtensionAdapter, createCodexExtensionAdapter } from './extension-adapters.js';

describe('Claude extension adapter', () => {
  it('uses the existing fixed listing command and normalizes installed plugins', async () => {
    const calls: string[][] = [];
    const adapter = createClaudeExtensionAdapter({
      exec: async (args) => {
        calls.push(args);
        return {
          stdout: JSON.stringify([
            {
              pluginId: 'demo@official',
              name: 'demo',
              version: '1.2.3',
              scope: 'user',
              source: { url: 'https://example.test/demo', ref: 'ignored' },
              secret: 'must not cross the adapter boundary',
            },
          ]),
          stderr: '',
        };
      },
    });

    await expect(adapter.listInstalled()).resolves.toEqual({
      state: 'supported',
      extensions: [
        {
          providerId: 'claude',
          id: 'demo@official',
          name: 'demo',
          version: '1.2.3',
          scope: 'user',
          source: 'https://example.test/demo',
          enabled: true,
          kind: 'native',
        },
      ],
    });
    expect(calls).toEqual([['plugin', 'list', '--json']]);
  });

  it('degrades when the Claude CLI is absent or output is invalid', async () => {
    const missing = createClaudeExtensionAdapter({
      exec: async () => {
        const error = Object.assign(new Error('missing'), { code: 'ENOENT' });
        throw error;
      },
    });
    await expect(missing.listInstalled()).resolves.toMatchObject({
      state: 'unavailable',
      reason: 'claude CLI not found',
    });

    const invalid = createClaudeExtensionAdapter({
      exec: async () => ({ stdout: '{not json', stderr: '' }),
    });
    await expect(invalid.listInstalled()).resolves.toMatchObject({
      state: 'unavailable',
      reason: 'could not read Claude plugin output',
    });

    const timedOut = createClaudeExtensionAdapter({
      exec: async () => {
        throw Object.assign(new Error('timeout'), { killed: true });
      },
    });
    await expect(timedOut.listInstalled()).resolves.toMatchObject({
      state: 'unavailable',
      reason: 'claude CLI timed out',
    });

    const malformed = createClaudeExtensionAdapter({
      exec: async () => ({
        stdout: JSON.stringify({
          installed: [
            null,
            { pluginId: 'nested@source', source: { url: 'https://example.test', ref: 'v2' } },
            { pluginId: 42, source: ['not', 'a', 'source'] },
          ],
        }),
        stderr: 'untrusted stderr is ignored',
      }),
    });
    await expect(malformed.listInstalled()).resolves.toMatchObject({
      state: 'supported',
      extensions: [
        expect.objectContaining({
          id: 'nested@source',
          version: 'v2',
          source: 'https://example.test',
        }),
      ],
    });
  });
});

describe('Codex extension adapter', () => {
  it('lists only bounded, fixed Codex config artifacts and advertises no writes', async () => {
    const home = fs.mkdtempSync(path.join(os.tmpdir(), 'agentconfig-codex-home-'));
    const project = fs.mkdtempSync(path.join(os.tmpdir(), 'agentconfig-codex-project-'));
    fs.mkdirSync(path.join(home, '.codex', 'rules'), { recursive: true });
    fs.mkdirSync(path.join(project, '.codex', 'rules'), { recursive: true });
    fs.writeFileSync(path.join(home, '.codex', 'config.toml'), 'model = "gpt-5-codex"\n');
    fs.writeFileSync(path.join(home, '.codex', 'AGENTS.md'), '# global\n');
    fs.writeFileSync(
      path.join(home, '.codex', 'rules', 'safe.rules'),
      'prefix_rule(pattern=["git status"])\n',
    );
    fs.writeFileSync(path.join(project, 'AGENTS.md'), '# project\n');
    fs.writeFileSync(path.join(project, 'codex.toml'), 'model = "gpt-5-codex"\n');
    fs.writeFileSync(
      path.join(project, '.codex', 'rules', 'project.rules'),
      'prefix_rule(pattern=["git diff"])\n',
    );

    const adapter = createCodexExtensionAdapter({ homeDir: home, projectRoot: project });
    const inventory = await adapter.listInstalled();

    expect(inventory.state).toBe('detected');
    expect(inventory.extensions.map((item) => item.source).sort()).toEqual(
      [
        '.codex/rules/project.rules',
        'AGENTS.md',
        'codex.toml',
        '~/.codex/AGENTS.md',
        '~/.codex/config.toml',
        '~/.codex/rules/safe.rules',
      ].sort(),
    );
    expect(adapter.provider.capabilities).toEqual({
      list: true,
      detail: false,
      install: false,
      remove: false,
      update: false,
      enable: false,
      disable: false,
    });
  });

  it('skips symlinks and oversized files, and reports unavailable when nothing is readable', async () => {
    const home = fs.mkdtempSync(path.join(os.tmpdir(), 'agentconfig-codex-empty-'));
    const codex = path.join(home, '.codex');
    fs.mkdirSync(codex, { recursive: true });
    fs.writeFileSync(path.join(codex, 'config.toml'), 'x'.repeat(64 * 1024 + 1));
    fs.symlinkSync('/etc/passwd', path.join(codex, 'AGENTS.md'));

    fs.mkdirSync(path.join(codex, 'rules'), { recursive: true });
    fs.symlinkSync('/etc/passwd', path.join(codex, 'rules', 'escape.rules'));

    const inventory = await createCodexExtensionAdapter({ homeDir: home }).listInstalled();
    expect(inventory).toEqual({
      state: 'unavailable',
      extensions: [],
      reason: 'Codex configuration not found',
    });
  });
});
