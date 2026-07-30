/**
 * useConfigureCounts — the count badges shown against every CONFIGURE nav
 * section (Sidebar.tsx). Unlike the WORKSPACE counts (which come straight off the
 * cheap in-memory `report`), the Configure sections mix two tiers:
 *
 *   - CHEAP (report-derived, synchronous): instructions, skills, rules, memory —
 *     each page's `collect*` helper run against `report.agents`.
 *   - FETCHED (async): settings, hooks, mcp, keybindings each require reading and
 *     parsing their on-disk file(s), and sync requires a dry-run plan from the
 *     server. These match the number each page actually surfaces.
 *
 * Scope is the CURRENT PROJECT INSTANCE — the same scope the Workspace counts and
 * the cheap collectors already use. Inherited/global entries the pages show under
 * their own headings are deliberately not folded in, so the badge tracks the
 * project the sidebar's legend points at.
 *
 * Every fetched count is best-effort: a missing file counts as zero for that
 * source (an absent settings.json genuinely has zero hooks), and a hard failure
 * leaves that section's count `undefined` so no badge renders rather than a
 * misleading `0`. Reads are keyed to the instance + report so the badges refresh
 * on an instance switch or a WS report push; the heavier sync dry-run is keyed to
 * the instance alone so a report push does not re-run it.
 */

import { useEffect, useMemo, useState } from 'react';
import { ApiClient } from '../api/client.js';
import { bootstrapToken } from '../api/token.js';
import { useAppState } from '../state/index.js';
import { collectInstructionFiles } from '../pages/instructions/logic.js';
import { collectEntries } from '../pages/skills/logic.js';
import { collectRules } from '../pages/rules/logic.js';
import { collectMemoryFiles } from '../pages/memory/logic.js';
import { collectMcpCandidates, parseMcpFile } from '../pages/mcp/logic.js';
import { parseHooksBlock } from '../pages/hooks/logic.js';
import { parseKeybindings } from '../pages/keybindings/logic.js';
import { effectiveRows } from '../pages/settings/effective.js';
import { SOURCE_CANDIDATES } from '../pages/sync/logic.js';

/** One count key per CONFIGURE nav section. */
export type ConfigureCountKey =
  | 'settings'
  | 'instructions'
  | 'skills'
  | 'hooks'
  | 'rules'
  | 'memory'
  | 'mcp'
  | 'keybindings'
  | 'sync';

/** A count per section; `undefined` = not yet loaded or unavailable (no badge). */
export type ConfigureCounts = Record<ConfigureCountKey, number | undefined>;

/** The two settings files (project + local) that carry settings/hooks blocks. */
const SETTINGS_PATH = '.claude/settings.json';
const LOCAL_SETTINGS_PATH = '.claude/settings.local.json';
const KEYBINDINGS_PATH = '.claude/keybindings.json';

/** Parse settings.json content to a plain object, or `undefined` when malformed. */
function parseSettingsObject(content: string): Record<string, unknown> | undefined {
  try {
    const value: unknown = JSON.parse(content);
    return typeof value === 'object' && value !== null && !Array.isArray(value)
      ? (value as Record<string, unknown>)
      : undefined;
  } catch {
    return undefined;
  }
}

export function useConfigureCounts(): ConfigureCounts {
  const { report, getFile, currentInstance } = useAppState();
  const instanceId = currentInstance?.id;

  // Cheap, synchronous counts (undefined until the first report arrives).
  const cheap = useMemo(
    () => ({
      instructions: report ? collectInstructionFiles(report.agents).length : undefined,
      skills: report ? collectEntries(report).length : undefined,
      rules: report ? collectRules(report).length : undefined,
      memory: report ? collectMemoryFiles(report).length : undefined,
    }),
    [report],
  );

  // MCP candidate paths drive one of the fetched counts; their identity keys the
  // fetch effect so a report push with an unchanged file set does not refetch.
  const mcpCandidates = useMemo(() => collectMcpCandidates(report?.agents ?? []), [report]);
  const candidateKey = mcpCandidates.join('\n');

  const [fetched, setFetched] = useState<{
    settings?: number;
    hooks?: number;
    mcp?: number;
    keybindings?: number;
  }>({});
  const [sync, setSync] = useState<number | undefined>();

  // Fetch + parse the file-backed counts (settings, hooks, mcp, keybindings).
  useEffect(() => {
    if (!report) return;
    let cancelled = false;

    // Read a file's content, or null when it is absent / unreadable.
    const read = (path: string) =>
      getFile(path)
        .then((f) => f.content)
        .catch(() => null);

    void (async () => {
      const [settingsContent, localContent, keybindingsContent, ...mcpContents] = await Promise.all(
        [
          read(SETTINGS_PATH),
          read(LOCAL_SETTINGS_PATH),
          read(KEYBINDINGS_PATH),
          ...mcpCandidates.map(read),
        ],
      );
      if (cancelled) return;

      const settingsObj = settingsContent ? parseSettingsObject(settingsContent) : undefined;
      const localObj = localContent ? parseSettingsObject(localContent) : undefined;
      const settings = effectiveRows({ project: settingsObj, local: localObj }).filter(
        (r) => r.win !== 'default',
      ).length;

      const hookCount = (content: string | null): number => {
        if (!content) return 0;
        const parsed = parseHooksBlock(content);
        return parsed.ok ? parsed.entries.length : 0;
      };
      const hooks = hookCount(settingsContent) + hookCount(localContent);

      const mcp = mcpContents.reduce(
        (sum, content) => sum + (content ? parseMcpFile(content).servers.length : 0),
        0,
      );

      const keybindings = keybindingsContent
        ? parseKeybindings(keybindingsContent).bindings.length
        : 0;

      setFetched({ settings, hooks, mcp, keybindings });
    })();

    return () => {
      cancelled = true;
    };
  }, [getFile, report, candidateKey, mcpCandidates]);

  // Sync target count via a dry-run plan — keyed on the instance only, so it does
  // not re-run on every report push. A failed plan leaves the count unset.
  useEffect(() => {
    const token = bootstrapToken();
    if (token === undefined) return;
    let cancelled = false;
    const client = new ApiClient(token);
    const source = SOURCE_CANDIDATES[0] ?? 'CLAUDE.md';

    client
      .syncInstructions(source, { dryRun: true, instance: instanceId })
      .then((res) => {
        if (!cancelled) setSync(res.targets.length);
      })
      .catch(() => {
        if (!cancelled) setSync(undefined);
      });

    return () => {
      cancelled = true;
    };
  }, [instanceId]);

  return {
    settings: fetched.settings,
    instructions: cheap.instructions,
    skills: cheap.skills,
    hooks: fetched.hooks,
    rules: cheap.rules,
    memory: cheap.memory,
    mcp: fetched.mcp,
    keybindings: fetched.keybindings,
    sync,
  };
}
