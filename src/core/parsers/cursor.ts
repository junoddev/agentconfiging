/**
 * Cursor rule models: `.cursor/rules/*.mdc` frontmatter rules.
 *
 * Cursor's editor writes bare comma-separated globs
 * (`globs: *.tsx,src/components/**`) which is NOT strict YAML — the lenient
 * frontmatter fallback salvages the raw string and it is comma-split here.
 */

import { parseFrontmatter } from './frontmatter.js';
import { failed, parsed, problem, type ParseResult } from './result.js';
import { inputSizeProblem, optionalBoolean, optionalString, toStringList } from './values.js';

export interface CursorRule {
  description?: string;
  globs: string[];
  alwaysApply: boolean;
  body: string;
}

export function parseCursorRule(content: string): ParseResult<CursorRule> {
  const sizeProblem = inputSizeProblem(content);
  if (sizeProblem) return failed([sizeProblem]);
  const fm = parseFrontmatter(content);
  const problems = [...fm.problems];
  if (!fm.hasFrontmatter) {
    problems.push(problem('frontmatter', 'missing frontmatter block'));
  }
  const model: CursorRule = {
    globs: toStringList(fm.data['globs'], 'frontmatter.globs', problems),
    alwaysApply:
      optionalBoolean(fm.data['alwaysApply'], 'frontmatter.alwaysApply', problems) ?? false,
    body: fm.body,
  };
  const description = optionalString(fm.data['description'], 'frontmatter.description', problems);
  if (description !== undefined) model.description = description;
  return parsed(model, problems);
}
