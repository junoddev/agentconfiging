/**
 * GitHub Copilot instruction models: `.github/copilot-instructions.md`
 * (plain markdown, no frontmatter) and `.github/instructions/*.instructions.md`
 * (path-scoped via `applyTo` frontmatter).
 */

import { parseFrontmatter } from './frontmatter.js';
import { failed, parsed, type ParseResult } from './result.js';
import { inputSizeProblem, toStringList } from './values.js';
import { firstHeadingOf } from './guides.js';

export interface CopilotInstructions {
  /** Glob scopes from `applyTo` frontmatter; empty for repo-wide instructions. */
  applyTo: string[];
  title?: string;
  body: string;
}

export function parseCopilotInstructions(content: string): ParseResult<CopilotInstructions> {
  const sizeProblem = inputSizeProblem(content);
  if (sizeProblem) return failed([sizeProblem]);
  // Frontmatter is optional here: copilot-instructions.md has none.
  const fm = parseFrontmatter(content);
  const problems = [...fm.problems];
  const model: CopilotInstructions = {
    applyTo: toStringList(fm.data['applyTo'], 'frontmatter.applyTo', problems),
    body: fm.body,
  };
  const title = firstHeadingOf(fm.body);
  if (title !== undefined) model.title = title;
  return parsed(model, problems);
}
