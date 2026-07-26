/**
 * Model-staleness DATA (SPEC §4.1: "Model-staleness data lives in a data
 * file, not code"). Consumed by the `stale-model-ref` analyzer, which checks
 * these entries against PARSED model fields (settings.json `model`,
 * subagent/command frontmatter `model`) — never by grepping raw file text.
 *
 * Maintenance: refresh the lists and bump MODEL_DATA_DATE together.
 */

/** Date the lists below were last verified. */
export const MODEL_DATA_DATE = '2026-07-26';

/**
 * Model ids (and Claude Code aliases) known to be current as of
 * MODEL_DATA_DATE. Versioned ids absent from this list AND from
 * STALE_MODEL_REPLACEMENTS are reported at info severity as "unrecognized".
 */
export const KNOWN_CURRENT_MODELS: readonly string[] = [
  // Claude Code aliases — never stale.
  'default',
  'opus',
  'opusplan',
  'sonnet',
  'haiku',
  // Claude model ids.
  'claude-opus-4-5',
  'claude-sonnet-4-5',
  'claude-haiku-4-5',
  'claude-opus-4-1',
  'claude-sonnet-4-0',
];

/**
 * Known-retired model ids → suggested replacement. Exact-match against
 * parsed model fields; membership here fires `stale-model-ref` at warning
 * severity with a machine fix substituting the replacement.
 */
export const STALE_MODEL_REPLACEMENTS: Readonly<Record<string, string>> = {
  'claude-3-opus-20240229': 'claude-opus-4-5',
  'claude-3-sonnet-20240229': 'claude-sonnet-4-5',
  'claude-3-haiku-20240307': 'claude-haiku-4-5',
  'claude-3-5-sonnet-20240620': 'claude-sonnet-4-5',
  'claude-3-5-sonnet-20241022': 'claude-sonnet-4-5',
  'claude-3-5-haiku-20241022': 'claude-haiku-4-5',
  'claude-3-7-sonnet-20250219': 'claude-sonnet-4-5',
  'claude-2.1': 'claude-opus-4-5',
  'claude-2.0': 'claude-opus-4-5',
  'claude-instant-1.2': 'claude-haiku-4-5',
  'gpt-4': 'gpt-4o',
  'gpt-4-32k': 'gpt-4o',
  'gpt-3.5-turbo': 'gpt-4o-mini',
  'gemini-pro': 'gemini-2.5-pro',
  'gemini-1.0-pro': 'gemini-2.5-pro',
  'gemini-1.5-pro': 'gemini-2.5-pro',
  'gemini-1.5-flash': 'gemini-2.5-flash',
};
