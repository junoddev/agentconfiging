/**
 * Safe TOML parsing via smol-toml. Never throws; records in the returned
 * tree get null prototypes, depth/node count are capped, oversized input is
 * rejected unparsed. Duplicate keys are a hard error in TOML and smol-toml
 * reports them, so they surface as problems here.
 */

import { parse as parseTomlSource } from 'smol-toml';
import { failed, parsed, problem, problemFromError, type ParseResult } from './result.js';
import { inputSizeProblem, sanitize, type SafeRecord } from './values.js';

/** Parse TOML text (e.g. Codex `config.toml`) into a sanitized record. */
export function parseToml(content: string): ParseResult<SafeRecord> {
  const sizeProblem = inputSizeProblem(content);
  if (sizeProblem) return failed([sizeProblem]);
  if (content.trim().length === 0) {
    return failed([problem('$', 'empty input')]);
  }
  let raw: unknown;
  try {
    raw = parseTomlSource(content);
  } catch (error) {
    return failed([problemFromError('$', error)]);
  }
  const { value, problems } = sanitize(raw);
  return parsed(value as SafeRecord, problems);
}
