import type { RuntimeFormat } from '../runtimes/types.js';
import { AGENT_PROFILES } from './data.js';
import type { AgentProfile, InstructionArtifact } from './types.js';

function currentArtifacts(profile: AgentProfile): InstructionArtifact[] {
  return profile.facts.instructionArtifacts
    .filter((fact) => fact.lifecycle !== 'removed')
    .map((fact) => fact.value);
}

/**
 * Project a canonical profile into the stable RuntimeFormat compatibility API.
 * Detector heuristics and parsers intentionally remain executable modules and
 * are not represented here.
 */
export function projectRuntimeFormat(profile: AgentProfile): RuntimeFormat {
  const artifacts = currentArtifacts(profile);
  const project = artifacts.filter((artifact) => artifact.scope === 'project');
  const global = artifacts.filter((artifact) => artifact.scope === 'global');
  const primary = project[0];
  if (!primary) throw new Error(`profile ${profile.id} has no project instruction artifact`);

  return {
    id: profile.id,
    displayName: profile.displayName,
    firstClass: profile.maintainer.supportTier === 'first-class',
    format: primary.format,
    layout: primary.layout,
    instructionPaths: project.map((artifact) => artifact.path),
    ...(primary.rulesDirPattern ? { rulesDirPattern: primary.rulesDirPattern } : {}),
    ...(global.length > 0 ? { globalPaths: global.map((artifact) => artifact.path) } : {}),
    ...(primary.loadBehavior ? { scopeNotes: primary.loadBehavior } : {}),
    scaffoldPath: profile.maintainer.scaffoldPath,
    scaffoldTemplate: profile.maintainer.scaffoldTemplate,
    detectionMarkers: [...profile.maintainer.detectionMarkers],
    docsUrl: profile.maintainer.docsUrl,
    confidence: profile.maintainer.confidence,
  };
}

/** Historical RuntimeFormat surface, now derived exclusively from profiles. */
export const RUNTIME_FORMATS: readonly RuntimeFormat[] = AGENT_PROFILES.map(
  projectRuntimeFormat,
).sort((a, b) =>
  a.firstClass === b.firstClass ? a.id.localeCompare(b.id) : a.firstClass ? -1 : 1,
);
