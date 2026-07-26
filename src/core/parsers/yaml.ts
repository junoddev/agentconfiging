/**
 * Safe YAML parsing via the `yaml` package. Never throws; alias expansion is
 * bounded (maxAliasCount), cyclic/shared anchor graphs are collapsed by
 * sanitize(), records get null prototypes, depth and node count are capped,
 * and oversized or pathologically nested input is rejected before parsing.
 */

import { parseDocument } from 'yaml';
import {
  failed,
  parsed,
  problem,
  problemFromError,
  scrubMessage,
  type ParseProblem,
  type ParseResult,
} from './result.js';
import { flowNestingTooDeep, inputSizeProblem, sanitize } from './values.js';

export const YAML_MAX_ALIAS_COUNT = 100;

/**
 * Parse a YAML document (e.g. Continue `config.yaml`, `.aider.conf.yml`).
 * Empty/whitespace-only input fails like the JSON/TOML parsers do; non-empty
 * bare scalars are valid YAML, so the model may be a string/number/etc.
 * Duplicate keys keep the last value and are reported as problems.
 */
export function parseYaml(content: string): ParseResult<unknown> {
  const sizeProblem = inputSizeProblem(content);
  if (sizeProblem) return failed([sizeProblem]);
  if (content.trim().length === 0) {
    return failed([problem('$', 'empty input')]);
  }
  if (flowNestingTooDeep(content)) {
    return failed([problem('$', 'pathological bracket nesting; not parsed')]);
  }

  let raw: unknown;
  const problems: ParseProblem[] = [];
  try {
    const doc = parseDocument(content, { strict: false, uniqueKeys: true });
    for (const err of doc.errors) {
      const line = err.linePos?.[0]?.line;
      problems.push(
        problem(
          line === undefined ? '$' : `$ (line ${line})`,
          scrubMessage(err.message.split('\n', 1)[0] ?? err.message),
        ),
      );
    }
    raw = doc.toJS({ maxAliasCount: YAML_MAX_ALIAS_COUNT });
  } catch (error) {
    return failed([...problems, problemFromError('$', error)]);
  }
  const sanitized = sanitize(raw);
  return parsed(sanitized.value, [...problems, ...sanitized.problems]);
}
