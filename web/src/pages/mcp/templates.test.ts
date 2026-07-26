import { describe, expect, it } from 'vitest';
import { isEnvRef, parseServer, serverToConfig } from './logic.js';
import { MCP_TEMPLATES, cloneTemplate } from './templates.js';

describe('MCP_TEMPLATES', () => {
  it('offers the four expected starters', () => {
    expect(MCP_TEMPLATES.map((t) => t.id)).toEqual(['filesystem', 'github', 'postgres', 'memory']);
  });

  it('each template is a valid, serializable stdio server', () => {
    for (const t of MCP_TEMPLATES) {
      expect(t.server.transport).toBe('stdio');
      expect(t.server.command).toBeTruthy();
      // Serializing then reparsing yields the same server (a valid config value).
      const config = serverToConfig(t.server);
      const reparsed = parseServer(t.server.name, config);
      expect(reparsed).not.toBeNull();
      expect(reparsed!.command).toBe(t.server.command);
    }
  });

  it('the github template uses a ${VAR} token REFERENCE, never a literal secret', () => {
    const github = MCP_TEMPLATES.find((t) => t.id === 'github')!;
    const token = github.server.env?.GITHUB_PERSONAL_ACCESS_TOKEN ?? '';
    expect(isEnvRef(token)).toBe(true);
    expect(token).toBe('${GITHUB_TOKEN}');
  });
});

describe('cloneTemplate', () => {
  it('returns an independent copy (mutating the clone leaves the template intact)', () => {
    const github = MCP_TEMPLATES.find((t) => t.id === 'github')!;
    const clone = cloneTemplate(github);
    clone.name = 'renamed';
    clone.args?.push('--extra');
    clone.env!.NEW = 'x';
    expect(github.server.name).toBe('github');
    expect(github.server.args).toEqual(['-y', '@modelcontextprotocol/server-github']);
    expect(github.server.env).toEqual({ GITHUB_PERSONAL_ACCESS_TOKEN: '${GITHUB_TOKEN}' });
  });
});
