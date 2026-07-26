/**
 * Plain-markdown instruction guides: AGENTS.md, GEMINI.md, .cursorrules,
 * .continuerules, and similar single-file guides. Structural only — the
 * text itself is adversarial data and is carried verbatim.
 */

import { failed, parsed, problem, type ParseProblem, type ParseResult } from './result.js';
import { createFenceFilter, inputSizeProblem } from './values.js';

export interface GuideHeading {
  /** Heading level (1–6). */
  level: number;
  text: string;
}

export interface Guide {
  /** Text of the first level-1 heading, if any. */
  title?: string;
  headings: GuideHeading[];
  body: string;
}

export function parseGuide(content: string): ParseResult<Guide> {
  const sizeProblem = inputSizeProblem(content);
  if (sizeProblem) return failed([sizeProblem]);
  const problems: ParseProblem[] = [];
  if (content.trim().length === 0) problems.push(problem('$', 'empty content'));
  const headings: GuideHeading[] = [];
  const skipLine = createFenceFilter();
  for (const line of content.split('\n')) {
    if (skipLine(line)) continue;
    const match = /^(#{1,6})\s+(.+?)\s*$/.exec(line);
    if (match && match[1] !== undefined && match[2] !== undefined) {
      headings.push({ level: match[1].length, text: match[2] });
    }
  }
  const model: Guide = { headings, body: content };
  const title = headings.find((h) => h.level === 1)?.text;
  if (title !== undefined) model.title = title;
  return parsed(model, problems);
}

/** First `#` heading of a markdown string (fence-aware). */
export function firstHeadingOf(content: string): string | undefined {
  const result = parseGuide(content);
  return result.ok ? result.model.title : undefined;
}
