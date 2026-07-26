/**
 * Safe JSON parsing. Never throws; every record in the returned tree has a
 * null prototype (see values.ts), depth/node count are capped, oversized
 * input is rejected unparsed.
 *
 * Known limitation: duplicate keys cannot be detected — JSON.parse applies
 * last-wins before any hook can observe the source, and reporting them
 * would require a custom JSON tokenizer. The YAML and TOML parsers DO
 * report duplicate keys; for JSON the last occurrence silently wins.
 */

import { failed, parsed, problem, problemFromError, type ParseResult } from './result.js';
import { inputSizeProblem, isRecord, sanitize, type SafeRecord } from './values.js';

/** Parse arbitrary JSON text into a sanitized value tree. */
export function parseJson(content: string): ParseResult<unknown> {
  const sizeProblem = inputSizeProblem(content);
  if (sizeProblem) return failed([sizeProblem]);
  if (content.trim().length === 0) {
    return failed([problem('$', 'empty input')]);
  }
  let raw: unknown;
  try {
    raw = JSON.parse(content);
  } catch (error) {
    return failed([problemFromError('$', error)]);
  }
  const { value, problems } = sanitize(raw);
  return parsed(value, problems);
}

/** Parse JSON text that must be an object at the root. */
export function parseJsonRecord(content: string): ParseResult<SafeRecord> {
  const result = parseJson(content);
  if (!result.ok) return failed(result.problems);
  if (!isRecord(result.model)) {
    return failed([...result.problems, problem('$', 'expected a JSON object at the root')]);
  }
  return parsed(result.model as SafeRecord, result.problems);
}
