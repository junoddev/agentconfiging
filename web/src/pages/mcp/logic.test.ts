import { describe, expect, it } from 'vitest';
import {
  collectCloudServers,
  collectGlobalMcpCandidates,
  collectMcpCandidates,
  formatArgsText,
  formatKeyVals,
  hasRedactionMarks,
  isEnvRef,
  isMcpCandidate,
  parseArgsText,
  parseKeyVals,
  parseMcpFile,
  parseServer,
  removeServer,
  serializeMcpDoc,
  serverToConfig,
  upsertServer,
} from './logic.js';

// Mirrors fixtures/trees/claude-rich/.mcp.json (stdio + env-ref + http).
const ROOT_MCP = JSON.stringify({
  mcpServers: {
    postgres: {
      command: 'npx',
      args: ['-y', '@modelcontextprotocol/server-postgres', 'postgres://localhost:5432/db'],
      env: { PGOPTIONS: '-c statement_timeout=5000' },
    },
    'bus-inspector': {
      command: './tools/bus-mcp',
      args: ['--read-only'],
      env: { BUS_URL: '${ORBIT_BUS_URL}' },
    },
    docs: {
      type: 'http',
      url: 'https://mcp.example.com/docs',
      headers: { 'X-Team': 'orbit' },
    },
  },
});

// Mirrors the mcpServers block inside .gemini/settings.json (with sibling keys +
// an unmodeled `timeout`).
const SETTINGS = JSON.stringify({
  model: { name: 'gemini-2.5-pro' },
  mcpServers: {
    papers: { command: 'uvx', args: ['papers-mcp'], timeout: 30000 },
  },
  privacy: { usageStatisticsEnabled: false },
});

describe('parseMcpFile', () => {
  it('parses the root .mcp.json block into servers', () => {
    const parsed = parseMcpFile(ROOT_MCP);
    expect(parsed.parseError).toBe(false);
    expect(parsed.hasBlock).toBe(true);
    expect(parsed.servers.map((s) => s.name)).toEqual(['postgres', 'bus-inspector', 'docs']);
    expect(parsed.servers[0]!.transport).toBe('stdio');
    expect(parsed.servers[2]!.transport).toBe('http');
    expect(parsed.servers[2]!.url).toBe('https://mcp.example.com/docs');
  });

  it('parses a nested mcpServers block inside a settings file', () => {
    const parsed = parseMcpFile(SETTINGS);
    expect(parsed.hasBlock).toBe(true);
    expect(parsed.servers).toHaveLength(1);
    expect(parsed.servers[0]!.name).toBe('papers');
    expect(parsed.servers[0]!.extra).toEqual({ timeout: 30000 });
  });

  it('reports a parse error on malformed JSON without throwing', () => {
    const parsed = parseMcpFile('{ "mcpServers": { oops }');
    expect(parsed.parseError).toBe(true);
    expect(parsed.doc).toBeNull();
    expect(parsed.servers).toEqual([]);
  });

  it('treats a document with no mcpServers key as blockless', () => {
    const parsed = parseMcpFile('{ "model": { "name": "x" } }');
    expect(parsed.parseError).toBe(false);
    expect(parsed.hasBlock).toBe(false);
    expect(parsed.servers).toEqual([]);
  });

  it('skips malformed (non-object) server entries but keeps the good ones', () => {
    const parsed = parseMcpFile(
      JSON.stringify({ mcpServers: { good: { command: 'x' }, bad: 'nope', alsoBad: [1, 2] } }),
    );
    expect(parsed.servers.map((s) => s.name)).toEqual(['good']);
  });

  it('tolerates a non-object document', () => {
    expect(parseMcpFile('[]').hasBlock).toBe(false);
    expect(parseMcpFile('42').hasBlock).toBe(false);
  });
});

describe('server round-trip (parseServer <-> serverToConfig)', () => {
  it('round-trips every shape from the fixtures value-equally', () => {
    for (const content of [ROOT_MCP, SETTINGS]) {
      const doc = JSON.parse(content) as { mcpServers: Record<string, unknown> };
      for (const [name, raw] of Object.entries(doc.mcpServers)) {
        const server = parseServer(name, raw);
        expect(server).not.toBeNull();
        expect(serverToConfig(server!)).toEqual(raw);
      }
    }
  });

  it('preserves unmodeled keys (e.g. timeout) through a round-trip', () => {
    const raw = { command: 'uvx', args: ['papers-mcp'], timeout: 30000 };
    expect(serverToConfig(parseServer('papers', raw)!)).toEqual(raw);
  });

  it('defaults http type to "http" when the source omitted it', () => {
    const server = parseServer('remote', { url: 'https://x.example/mcp' });
    expect(server?.transport).toBe('http');
    expect(serverToConfig(server!)).toEqual({ type: 'http', url: 'https://x.example/mcp' });
  });
});

describe('serializeMcpDoc', () => {
  it('replaces the block while preserving sibling keys, ending with a newline', () => {
    const parsed = parseMcpFile(SETTINGS);
    const out = serializeMcpDoc(parsed.doc!, parsed.servers);
    expect(out.endsWith('\n')).toBe(true);
    const reparsed = JSON.parse(out) as Record<string, unknown>;
    expect(reparsed.model).toEqual({ name: 'gemini-2.5-pro' });
    expect(reparsed.privacy).toEqual({ usageStatisticsEnabled: false });
    expect((reparsed.mcpServers as Record<string, unknown>).papers).toBeDefined();
  });

  it('authors a fresh .mcp.json from an empty doc', () => {
    const server = parseServer('memory', { command: 'npx', args: ['-y', 'x'] })!;
    const out = serializeMcpDoc({}, [server]);
    expect(JSON.parse(out)).toEqual({
      mcpServers: { memory: { command: 'npx', args: ['-y', 'x'] } },
    });
  });

  it('is a full parse→serialize→parse fixed point for the block', () => {
    const parsed = parseMcpFile(ROOT_MCP);
    const out = serializeMcpDoc(parsed.doc!, parsed.servers);
    expect(JSON.parse(out)).toEqual(JSON.parse(ROOT_MCP));
  });
});

describe('upsertServer / removeServer', () => {
  const base = parseMcpFile(ROOT_MCP).servers;

  it('appends a new server', () => {
    const next = upsertServer(base, parseServer('memory', { command: 'npx' })!);
    expect(next.map((s) => s.name)).toContain('memory');
    expect(next).toHaveLength(base.length + 1);
  });

  it('replaces a server with the same name in place of duplicating', () => {
    const next = upsertServer(base, parseServer('docs', { command: 'local' })!);
    expect(next.filter((s) => s.name === 'docs')).toHaveLength(1);
  });

  it('drops the old name on a rename (replaceName)', () => {
    const renamed = parseServer('docs-v2', { type: 'http', url: 'https://x' })!;
    const next = upsertServer(base, renamed, 'docs');
    const names = next.map((s) => s.name);
    expect(names).toContain('docs-v2');
    expect(names).not.toContain('docs');
  });

  it('removes by name', () => {
    expect(removeServer(base, 'postgres').map((s) => s.name)).toEqual(['bus-inspector', 'docs']);
  });
});

describe('redaction detection (the save trap guard)', () => {
  it('flags content carrying any [REDACTED:*] mark', () => {
    expect(hasRedactionMarks('{ "env": { "K": "[REDACTED:openai]" } }')).toBe(true);
    expect(hasRedactionMarks('{ "env": { "K": "[REDACTED:github]" } }')).toBe(true);
  });

  it('is false for clean content (incl. ${VAR} refs, which are not secrets)', () => {
    expect(hasRedactionMarks(ROOT_MCP)).toBe(false);
    expect(hasRedactionMarks('{ "env": { "K": "${TOKEN}" } }')).toBe(false);
  });

  it('redacted content is still valid JSON and parses (so it can be shown read-only)', () => {
    const redacted = JSON.stringify({
      mcpServers: { s: { command: 'x', env: { API_KEY: '[REDACTED:openai]' } } },
    });
    const parsed = parseMcpFile(redacted);
    expect(parsed.parseError).toBe(false);
    expect(parsed.servers[0]!.env).toEqual({ API_KEY: '[REDACTED:openai]' });
    expect(hasRedactionMarks(redacted)).toBe(true);
  });
});

describe('isEnvRef (${VAR} refs stay literal, never expanded)', () => {
  it('detects ${VAR} references', () => {
    expect(isEnvRef('${GITHUB_TOKEN}')).toBe(true);
    expect(isEnvRef('prefix-${X}-suffix')).toBe(true);
  });

  it('is false for plain literal values', () => {
    expect(isEnvRef('sk-abc123')).toBe(false);
    expect(isEnvRef('-c statement_timeout=5000')).toBe(false);
    expect(isEnvRef('')).toBe(false);
  });

  it('a ref survives a parse→serialize round-trip verbatim (unexpanded)', () => {
    const server = parseServer('bus', { command: 'x', env: { BUS_URL: '${ORBIT_BUS_URL}' } })!;
    const out = serverToConfig(server) as { env: Record<string, string> };
    expect(out.env.BUS_URL).toBe('${ORBIT_BUS_URL}');
  });
});

describe('candidate discovery', () => {
  it('recognizes .mcp.json and settings files by basename', () => {
    expect(isMcpCandidate('.mcp.json')).toBe(true);
    expect(isMcpCandidate('.claude/settings.json')).toBe(true);
    expect(isMcpCandidate('.claude/settings.local.json')).toBe(true);
    expect(isMcpCandidate('.gemini/settings.json')).toBe(true);
    expect(isMcpCandidate('CLAUDE.md')).toBe(false);
    expect(isMcpCandidate('opencode.json')).toBe(false);
  });

  it('collects a de-duplicated, sorted candidate set across agents', () => {
    const agents = [
      { files: ['.mcp.json', 'CLAUDE.md', '.claude/settings.json'] },
      { files: ['.mcp.json', '.claude/settings.local.json'] },
    ];
    expect(collectMcpCandidates(agents)).toEqual([
      '.claude/settings.json',
      '.claude/settings.local.json',
      '.mcp.json',
    ]);
  });
});

describe('collectGlobalMcpCandidates (inherited home dirs, bead 71h.4)', () => {
  it('joins entry roots and relative candidate files into absolute paths', () => {
    const entries = [
      {
        root: '/Users/x/.claude',
        agents: [{ files: ['settings.json', 'CLAUDE.md', '.mcp.json'] }],
      },
      { root: '/Users/x/.gemini', agents: [{ files: ['settings.json'] }] },
    ];
    expect(collectGlobalMcpCandidates(entries)).toEqual([
      { root: '/Users/x/.claude', path: '/Users/x/.claude/.mcp.json' },
      { root: '/Users/x/.claude', path: '/Users/x/.claude/settings.json' },
      { root: '/Users/x/.gemini', path: '/Users/x/.gemini/settings.json' },
    ]);
  });

  it('ignores non-candidate files and de-duplicates across agents', () => {
    const entries = [
      {
        root: '/Users/x/.claude',
        agents: [
          { files: ['settings.json', 'agents/reviewer.md'] },
          { files: ['settings.json', 'keybindings.json'] },
        ],
      },
    ];
    expect(collectGlobalMcpCandidates(entries)).toEqual([
      { root: '/Users/x/.claude', path: '/Users/x/.claude/settings.json' },
    ]);
  });

  it('yields absolute paths only — never a project-relative write target', () => {
    const entries = [{ root: '/Users/x/.claude', agents: [{ files: ['settings.json'] }] }];
    for (const c of collectGlobalMcpCandidates(entries)) {
      expect(c.path.startsWith('/')).toBe(true);
    }
  });

  it('is a no-op for empty entries', () => {
    expect(collectGlobalMcpCandidates([])).toEqual([]);
  });
});

describe('collectCloudServers', () => {
  it('returns nothing when no agent surfaces cloud MCPs (v1 fixtures)', () => {
    expect(collectCloudServers([{ extras: {} }, { extras: { other: 1 } }])).toEqual([]);
  });

  it('parses a cloudMcpServers map from agent extras as read-only servers', () => {
    const agents = [
      { extras: { cloudMcpServers: { remote: { type: 'http', url: 'https://cloud/mcp' } } } },
    ];
    const servers = collectCloudServers(agents);
    expect(servers).toHaveLength(1);
    expect(servers[0]!.name).toBe('remote');
    expect(servers[0]!.transport).toBe('http');
  });
});

describe('form text helpers round-trip', () => {
  it('args: parse(format(x)) === x', () => {
    const args = ['-y', '@scope/pkg', '--flag'];
    expect(parseArgsText(formatArgsText(args))).toEqual(args);
  });

  it('key/vals: parse(format(x)) === x, keeping ${VAR} refs literal', () => {
    const env = { PGOPTIONS: '-c timeout=5000', BUS_URL: '${ORBIT_BUS_URL}' };
    expect(parseKeyVals(formatKeyVals(env))).toEqual(env);
  });

  it('ignores blank and separator-less lines', () => {
    expect(parseKeyVals('A=1\n\n  \nnoeq\nB=2')).toEqual({ A: '1', B: '2' });
    expect(parseArgsText('a\n\n  \nb')).toEqual(['a', 'b']);
  });
});
