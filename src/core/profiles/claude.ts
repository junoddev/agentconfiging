import { AGENT_PROFILES } from './data.js';
import {
  CLAUDE_CURRENT_MODELS_SEED,
  CLAUDE_HOOK_EVENTS_SEED,
  CLAUDE_SETTINGS_SEED,
  CLAUDE_TOOLS_SEED,
} from './claude-seed.js';
import type {
  HookEventDefinition,
  ModelDefinition,
  ProfileFact,
  SettingDefinition,
  ToolDefinition,
} from './types.js';

export interface ClaudeCatalogProjection {
  checkedAt: string;
  settings: readonly SettingDefinition[];
  tools: readonly string[];
  currentModels: readonly string[];
  staleModelReplacements: Readonly<Record<string, string>>;
  hookEvents: readonly HookEventDefinition[];
}

function values<T>(facts: readonly ProfileFact[]): T[] {
  return facts.filter((fact) => fact.lifecycle === 'current').map((fact) => fact.value as T);
}

function inSeedOrder<T>(
  items: readonly T[],
  key: (item: T) => string,
  order: readonly string[],
): T[] {
  const positions = new Map(order.map((value, index) => [value, index]));
  return [...items].sort(
    (left, right) =>
      (positions.get(key(left)) ?? Infinity) - (positions.get(key(right)) ?? Infinity),
  );
}

/**
 * Safe compatibility projection of the canonical Claude profile. It excludes
 * source locators, hashes, promotion metadata, and all other raw evidence.
 */
export function projectClaudeCatalog(): ClaudeCatalogProjection {
  const profile = AGENT_PROFILES.find((candidate) => candidate.id === 'claude-code');
  if (!profile) throw new Error('canonical Claude Code profile is missing');
  const modelFacts = profile.facts.models as ProfileFact<ModelDefinition>[];
  const checkedAt = [
    ...profile.facts.settings,
    ...profile.facts.tools,
    ...modelFacts,
    ...profile.facts.hookEvents,
  ]
    .flatMap((fact) => fact.evidence.map((item) => item.checkedAt))
    .sort()
    .at(-1);
  if (!checkedAt) throw new Error('canonical Claude Code catalog has no evidence date');
  return {
    checkedAt: checkedAt.slice(0, 10),
    settings: inSeedOrder(
      values<SettingDefinition>(profile.facts.settings),
      (setting) => setting.key,
      CLAUDE_SETTINGS_SEED.map((setting) => setting.key),
    ),
    tools: inSeedOrder(
      values<ToolDefinition>(profile.facts.tools),
      (tool) => tool.name,
      CLAUDE_TOOLS_SEED.map((tool) => tool.name),
    ).map((tool) => tool.name),
    currentModels: inSeedOrder(
      modelFacts
        .filter((fact) => fact.value.purpose === 'runtime-capability')
        .map((fact) => fact.value),
      (model) => model.id,
      CLAUDE_CURRENT_MODELS_SEED.map((model) => model.id),
    ).map((model) => model.id),
    staleModelReplacements: Object.fromEntries(
      modelFacts
        .filter(
          (fact) =>
            fact.value.purpose === 'cross-provider-reference-compatibility' &&
            fact.value.replacement,
        )
        .map((fact) => [fact.value.id, fact.value.replacement!]),
    ),
    hookEvents: inSeedOrder(
      values<HookEventDefinition>(profile.facts.hookEvents),
      (event) => event.name,
      CLAUDE_HOOK_EVENTS_SEED.map((event) => event.name),
    ),
  };
}

export const CLAUDE_CATALOG = projectClaudeCatalog();
