/**
 * pipeline/template — {{input}} / {{NodeName}} templating (SPEC §5 row 12,
 * bead agentconfig-ira.1). PURE, and SECURITY-CRITICAL: templating is STRING
 * SUBSTITUTION over the run context and NOTHING MORE. It NEVER calls eval,
 * Function, or any code path — a `{{...}}` whose contents look like code (e.g.
 * `{{process.exit(1)}}` or `{{__proto__}}`) is treated as an ordinary reference
 * NAME, resolved by literal lookup, and substituted as inert text. There is no
 * expression grammar to exploit.
 *
 * REFERENCE FORMS:
 *   - {{input}}      → the pipeline's run input (as a string; see stringify).
 *   - {{NodeName}}   → the output of the upstream node whose `name` is NodeName.
 *
 * A reference name is the text between the braces, trimmed. The allowed name
 * charset (letters, digits, space, `_ . -`) is deliberately narrow — it is a
 * KEY into a lookup table, never evaluated. Anything not matching the pattern is
 * left verbatim in the output (not a reference).
 *
 * UNRESOLVED REFERENCES resolve to the EMPTY STRING (documented behaviour), and
 * NEVER to code execution. validatePipeline (validate.ts) rejects a pipeline
 * whose static template references cannot resolve to `input` or an upstream
 * node, so at run time an unresolved reference is the safe fallback, not the
 * norm.
 */

/** The template reference matcher. The captured group is the raw name (later
 *  trimmed). The name charset excludes `{`, `}`, and every structural char, so
 *  nested/mismatched braces cannot form an injection. */
export const REF_PATTERN = /\{\{\s*([A-Za-z0-9 _.-]+?)\s*\}\}/g;

/** The reserved reference name for the pipeline run input. */
export const INPUT_REF = 'input';

/** The lookup surface a template resolves against. */
export interface TemplateContext {
  /** The pipeline run input. */
  input: unknown;
  /** Upstream node outputs, keyed by node NAME. */
  outputs: Record<string, unknown>;
}

/**
 * Render a value as substitution text. Strings pass through; null/undefined
 * become ''; everything else is JSON-serialized (objects/arrays/numbers/bools).
 * This is a pure text projection — the value is NEVER executed.
 */
export function stringifyValue(value: unknown): string {
  if (typeof value === 'string') return value;
  if (value === null || value === undefined) return '';
  try {
    return JSON.stringify(value) ?? '';
  } catch {
    return '';
  }
}

/**
 * Extract the ordered list of reference names in a template (deduped by first
 * appearance). Used by validation to check every reference resolves to `input`
 * or an upstream node.
 */
export function extractRefs(template: string): string[] {
  if (typeof template !== 'string') return [];
  const out: string[] = [];
  for (const match of template.matchAll(REF_PATTERN)) {
    const name = (match[1] ?? '').trim();
    if (name !== '' && !out.includes(name)) out.push(name);
  }
  return out;
}

/**
 * Substitute every {{ref}} in `template` with its value from `context`, as
 * text. Pure string replacement — no eval, ever. An unresolved reference (not
 * `input`, not a known upstream output) becomes ''.
 */
export function resolveTemplate(template: string, context: TemplateContext): string {
  if (typeof template !== 'string') return '';
  return template.replace(REF_PATTERN, (_full, rawName: string) => {
    const name = rawName.trim();
    if (name === INPUT_REF) return stringifyValue(context.input);
    // Own-property lookup only — never walk the prototype chain, so a name like
    // `constructor` or `toString` resolves to '' (absent), not a function.
    if (Object.prototype.hasOwnProperty.call(context.outputs, name)) {
      return stringifyValue(context.outputs[name]);
    }
    return '';
  });
}
