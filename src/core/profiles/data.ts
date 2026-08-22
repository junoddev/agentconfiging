import { BASELINE_RUNTIME_FORMATS } from './baseline.js';
import type { RuntimeFormat } from '../runtimes/types.js';
import { CAPABILITY_AREAS } from './types.js';
import type { AgentProfile, InstructionArtifact, ProfileFact, ProfileSource } from './types.js';
import {
  CLAUDE_CATALOG_DATE,
  CLAUDE_CURRENT_MODELS_SEED,
  CLAUDE_HOOK_EVENTS_SEED,
  CLAUDE_SETTINGS_SEED,
  CLAUDE_STALE_MODELS_SEED,
  CLAUDE_TOOLS_SEED,
} from './claude-seed.js';
import { RUNTIME_SOURCE_MANIFESTS } from './source-manifests.js';

const SNAPSHOT_AT = '2026-07-26T00:00:00Z';
const BASELINE_PROMOTED_AT = '2026-08-15T00:00:00Z';
const VENDORS: Record<string, string> = {
  aider: 'Aider-AI',
  'claude-code': 'Anthropic',
  codex: 'OpenAI',
  continue: 'Continue',
  copilot: 'GitHub',
  cursor: 'Anysphere',
  'gemini-cli': 'Google',
  opencode: 'SST',
  'amazon-q': 'Amazon Web Services',
  cline: 'Cline',
  junie: 'JetBrains',
  qodo: 'Qodo',
  roo: 'Roo Code',
  windsurf: 'Codeium',
  zed: 'Zed Industries',
};

const GENERIC_PRODUCT_DOCS = new Set(['amazon-q', 'junie', 'qodo']);
const ALLOWED_DOC_REDIRECTS: Partial<Record<string, string[]>> = {
  'claude-code': ['https://code.claude.com/docs/en/memory'],
  cline: ['https://docs.cline.bot/customization/cline-rules'],
  codex: [
    'https://learn.chatgpt.com/docs/agent-configuration/agents-md',
    'https://developers.openai.com/codex',
    'https://learn.chatgpt.com/docs',
  ],
  copilot: [
    'https://docs.github.com/en/copilot/how-tos/copilot-on-github/customize-copilot/add-custom-instructions/add-repository-instructions',
  ],
  cursor: ['https://cursor.com/docs'],
  roo: ['https://roocodeinc.github.io/Roo-Code/features/custom-instructions/'],
  windsurf: ['https://docs.devin.ai/desktop/cascade/memories'],
};

function slug(value: string): string {
  return value
    .toLowerCase()
    .replace(/^~\//, 'home-')
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-|-$/g, '');
}

function artifactFacts(
  runtime: RuntimeFormat,
  sourceId: string,
  hasConfigurationReference: boolean,
): ProfileFact<InstructionArtifact>[] {
  const facts: ProfileFact<InstructionArtifact>[] = [];
  const add = (path: string, scope: 'project' | 'global', index: number): void => {
    facts.push({
      factId: `instruction-${scope}-${String(index + 1).padStart(2, '0')}-${slug(path)}`,
      value: {
        path,
        format: runtime.format,
        scope,
        layout: runtime.layout,
        ...(runtime.scopeNotes ? { loadBehavior: runtime.scopeNotes } : {}),
        ...(runtime.rulesDirPattern && scope === 'project'
          ? { rulesDirPattern: runtime.rulesDirPattern }
          : {}),
      },
      // The legacy table orders candidates but does not provide affirmative
      // lifecycle evidence. Do not infer deprecation/legacy status from position.
      lifecycle: 'current',
      applicability: { observedFrom: SNAPSHOT_AT },
      evidence: [{ sourceId, locator: '#instructions', checkedAt: SNAPSHOT_AT }],
      confidence:
        runtime.confidence === 'verified' && hasConfigurationReference ? 'verified' : 'unknown',
      lastChangedAt: SNAPSHOT_AT,
    });
  };
  runtime.instructionPaths.forEach((path, index) => add(path, 'project', index));
  runtime.globalPaths?.forEach((path, index) => add(path, 'global', index));
  return facts.sort((a, b) => a.factId.localeCompare(b.factId));
}

function makeProfile(runtime: RuntimeFormat): AgentProfile {
  const sourceManifest =
    RUNTIME_SOURCE_MANIFESTS[runtime.id as keyof typeof RUNTIME_SOURCE_MANIFESTS];
  if (!sourceManifest) throw new Error(`missing source manifest for ${runtime.id}`);
  const sourceId = `${runtime.id}-instruction-docs`;
  const configurationUrl =
    runtime.id === 'codex'
      ? 'https://developers.openai.com/codex/guides/agents-md'
      : runtime.docsUrl;
  const hasConfigurationReference = !GENERIC_PRODUCT_DOCS.has(runtime.id);
  const hasVerifiedConfiguration = hasConfigurationReference && runtime.confidence === 'verified';
  const facts = Object.fromEntries(
    CAPABILITY_AREAS.map((area) => [area, []]),
  ) as unknown as AgentProfile['facts'];
  facts.instructionArtifacts = artifactFacts(runtime, sourceId, hasConfigurationReference);
  const coverage = Object.fromEntries(
    CAPABILITY_AREAS.map((area) => [
      area,
      area === 'instructionArtifacts' && hasVerifiedConfiguration ? 'partial' : 'unknown',
    ]),
  ) as AgentProfile['coverage'];
  if (runtime.id === 'claude-code') {
    const checkedAt = `${CLAUDE_CATALOG_DATE}T00:00:00Z`;
    const evidence = () => [
      { sourceId: 'agentconfig-legacy-claude-catalog', locator: '#catalog-snapshot', checkedAt },
    ];
    const fact = <T>(
      factId: string,
      value: T,
      lifecycle: 'current' | 'legacy' = 'current',
    ): ProfileFact<T> => ({
      factId,
      value,
      lifecycle,
      applicability: { observedFrom: checkedAt },
      evidence: evidence(),
      confidence: 'unknown',
    });
    facts.settings = CLAUDE_SETTINGS_SEED.map((value) =>
      fact(`setting-${slug(value.key)}`, value),
    ).sort((a, b) => a.factId.localeCompare(b.factId));
    facts.tools = CLAUDE_TOOLS_SEED.map((value) => fact(`tool-${slug(value.name)}`, value));
    facts.models = [
      ...CLAUDE_CURRENT_MODELS_SEED.map((value) => fact(`model-${slug(value.id)}`, value)),
      ...CLAUDE_STALE_MODELS_SEED.map((value) =>
        fact(`compatibility-model-${slug(value.id)}`, value, 'legacy'),
      ),
    ].sort((a, b) => a.factId.localeCompare(b.factId));
    facts.hookEvents = CLAUDE_HOOK_EVENTS_SEED.map((value) =>
      fact(`hook-${slug(value.name)}`, value),
    ).sort((a, b) => a.factId.localeCompare(b.factId));
    coverage.settings = 'unknown';
    coverage.tools = 'unknown';
    coverage.models = 'unknown';
    coverage.hookEvents = 'unknown';
  }
  const claudeCatalogCovers: ProfileSource['covers'] = [
    'hookEvents',
    'models',
    'settings',
    'tools',
  ];
  return {
    schemaVersion: 1,
    profileRevision: 1,
    id: runtime.id,
    aliases: [],
    displayName: runtime.displayName,
    vendor: VENDORS[runtime.id] ?? runtime.displayName,
    productFamily: runtime.displayName,
    sources: (
      [
        {
          id: sourceId,
          kind: hasConfigurationReference ? 'official-config' : 'official-product',
          url: configurationUrl,
          required: hasConfigurationReference,
          covers: hasConfigurationReference ? sourceManifest.stable.covers : [],
          versionScheme: 'rolling',
          retrievalPolicy: {
            method: 'http',
            maxAgeDays: sourceManifest.stable.cadence === 'monthly' ? 30 : 7,
            ...(ALLOWED_DOC_REDIRECTS[runtime.id]
              ? { allowedRedirectUrls: ALLOWED_DOC_REDIRECTS[runtime.id] }
              : {}),
          },
          freshness: {
            status: 'unavailable',
            reason: 'Baseline import has no stored source snapshot.',
          },
        },
        ...(runtime.id === 'claude-code'
          ? [
              {
                id: 'agentconfig-legacy-claude-catalog',
                kind: 'independent-docs' as const,
                url: 'https://github.com/junoddev/agentconfiging',
                required: false,
                covers: claudeCatalogCovers,
                versionScheme: 'rolling' as const,
                retrievalPolicy: {
                  method: 'http' as const,
                  maxAgeDays: 30,
                },
                freshness: {
                  status: 'unavailable' as const,
                  reason: `Migrated internal snapshot dated ${CLAUDE_CATALOG_DATE}; upstream source snapshots were not retained.`,
                },
              },
            ]
          : []),
        {
          id: `${runtime.id}-product-docs`,
          kind: 'official-product',
          url: runtime.id === 'codex' ? 'https://developers.openai.com/codex/' : runtime.docsUrl,
          required: false,
          covers: sourceManifest.volatile.covers,
          versionScheme: 'rolling',
          retrievalPolicy: {
            method: 'http',
            maxAgeDays: sourceManifest.volatile.cadence === 'weekly' ? 7 : 30,
            ...(ALLOWED_DOC_REDIRECTS[runtime.id]
              ? { allowedRedirectUrls: ALLOWED_DOC_REDIRECTS[runtime.id] }
              : {}),
          },
          freshness: {
            status: 'unavailable',
            reason: 'Baseline import has no stored source snapshot.',
          },
        },
        ...(configurationUrl !== runtime.docsUrl
          ? [
              {
                id: `${runtime.id}-shared-convention-docs`,
                kind: 'independent-docs' as const,
                url: runtime.docsUrl,
                required: false,
                covers: [],
                versionScheme: 'rolling' as const,
                retrievalPolicy: { method: 'http' as const, maxAgeDays: 30 },
                freshness: {
                  status: 'unavailable' as const,
                  reason: 'Baseline import has no stored source snapshot.',
                },
              },
            ]
          : []),
      ] satisfies ProfileSource[]
    ).sort((a, b) => a.id.localeCompare(b.id)),
    maintainer: {
      supportTier: runtime.firstClass ? 'first-class' : 'profile-sync-only',
      ...(runtime.firstClass ? { detectorId: runtime.id } : {}),
      owner: sourceManifest.owner,
      scaffoldPath: runtime.scaffoldPath,
      scaffoldTemplate: runtime.scaffoldTemplate,
      detectionMarkers: [...runtime.detectionMarkers],
      docsUrl: runtime.docsUrl,
      confidence: runtime.confidence,
    },
    coverage,
    facts,
    promotion: {
      method: 'baseline-import',
      promotedAt: BASELINE_PROMOTED_AT,
      promoterId: 'runtime-maintainers',
      provenance: 'src/core/profiles/baseline.ts',
    },
  };
}

/** Canonical seed profiles. Runtime consumers remain on RUNTIME_FORMATS until E14.3. */
export const AGENT_PROFILES: readonly AgentProfile[] = BASELINE_RUNTIME_FORMATS.map(
  makeProfile,
).sort((a, b) => a.id.localeCompare(b.id));
