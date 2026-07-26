/**
 * stale-model-ref — UPGRADED from ../markdowning
 * `analyzers/stale_model_ref.ex`.
 *
 * The Elixir version regex-grepped EVERY file's raw contents for retired
 * model names. This version checks PARSED model fields only — settings
 * `model` (settings.json + settings.local.json) and subagent / command
 * frontmatter `model` — against the data file (stale-models.ts):
 *   - exact member of STALE_MODEL_REPLACEMENTS → warning, with a machine
 *     fix substituting the suggested replacement — ONLY inside the model
 *     field itself (`"model": "<id>"` in JSON, `model: <id>` in
 *     frontmatter), never in unrelated strings that happen to mention the
 *     id (env values, prose);
 *   - a versioned id (contains a digit) in neither list → info,
 *     "unrecognized as of MODEL_DATA_DATE" (it may simply be newer than
 *     the data).
 */

import { findFile } from '../detectors/shared.js';
import type { Finding, Fix } from '../findings.js';
import type { AnalyzerInput } from '../report.js';
import { registerAnalyzer } from './registry.js';
import { findingId } from './shared.js';
import { KNOWN_CURRENT_MODELS, MODEL_DATA_DATE, STALE_MODEL_REPLACEMENTS } from './stale-models.js';

interface ModelRef {
  path: string;
  field: string;
  value: string;
}

function escapeRegExp(text: string): string {
  return text.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

/**
 * Build a fix that rewrites the stale id ONLY where it appears as the
 * model-field value: `"model": "<id>"` (JSON settings) or a `model: <id>`
 * frontmatter line. Returns undefined when the field occurrence cannot be
 * located textually (no fix rather than a risky one).
 */
function buildFix(ref: ModelRef, content: string, replacement: string): Fix | undefined {
  const escaped = escapeRegExp(ref.value);
  const pattern =
    ref.field === 'model'
      ? new RegExp(`("model"\\s*:\\s*")${escaped}(")`)
      : new RegExp(`(^\\s*model\\s*:\\s*["']?)${escaped}(["']?\\s*)$`, 'm');
  if (!pattern.test(content)) return undefined;
  return {
    kind: 'replace-file',
    edits: [{ path: ref.path, patch: content.replace(pattern, `$1${replacement}$2`) }],
  };
}

function collectModelRefs(input: AnalyzerInput): ModelRef[] {
  const refs: ModelRef[] = [];
  const { settings, localSettings, subagents, commands } = input.parsed;
  for (const file of [settings, localSettings]) {
    if (file?.model.model !== undefined) {
      refs.push({ path: file.path, field: 'model', value: file.model.model });
    }
  }
  for (const file of [...subagents, ...commands]) {
    if (file.model.model !== undefined) {
      refs.push({ path: file.path, field: 'frontmatter.model', value: file.model.model });
    }
  }
  return refs;
}

registerAnalyzer({
  id: 'stale-model-ref',

  analyze(input: AnalyzerInput): Finding[] {
    const findings: Finding[] = [];
    for (const ref of collectModelRefs(input)) {
      const replacement = STALE_MODEL_REPLACEMENTS[ref.value];
      if (replacement !== undefined) {
        const finding: Finding = {
          id: findingId('stale-model-ref', ref.path, ref.value),
          severity: 'warning',
          agent: 'claude-code',
          title: `Stale model reference in \`${ref.path}\``,
          detail:
            `\`${ref.path}\` sets ${ref.field} to \`${ref.value}\`, which has been retired ` +
            'or superseded. A stale model name typically falls back to a default or fails silently.',
          suggestion: `Update the reference to a current model, e.g. \`${replacement}\`.`,
        };
        const content = findFile(input.manifest, ref.path)?.content;
        if (typeof content === 'string') {
          const fix = buildFix(ref, content, replacement);
          if (fix) finding.fix = fix;
        }
        findings.push(finding);
      } else if (/\d/.test(ref.value) && !KNOWN_CURRENT_MODELS.includes(ref.value)) {
        findings.push({
          id: findingId('stale-model-ref', ref.path, ref.value),
          severity: 'info',
          agent: 'claude-code',
          title: `Unrecognized model id in \`${ref.path}\``,
          detail:
            `\`${ref.path}\` sets ${ref.field} to \`${ref.value}\`, which is not in the ` +
            `known-current model list (data as of ${MODEL_DATA_DATE}). It may be stale — ` +
            'or newer than this tool’s data.',
          suggestion: 'Verify the model id against the provider’s current model list.',
        });
      }
    }
    return findings;
  },
});
