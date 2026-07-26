/**
 * Shared pure helpers for analyzer modules.
 *
 * `directiveLines` + `directiveSimilarity` power the content-aware upgrades
 * of the two word-count heuristics from ../markdowning
 * (conflicting_instructions, cursor_and_claude_rules_drift): instead of
 * comparing raw word counts or raw word-token Jaccard over whole files,
 * guides are compared by their normalized directive lines (bullet /
 * numbered items) — the parts that actually instruct — matched at token
 * level so paraphrased lines still count as similar.
 */

import type { DetectedAgent } from '../detectors/index.js';
import { slugify } from '../findings.js';
import { createFenceFilter } from '../parsers/index.js';
import type { AnalyzerInput } from '../report.js';

/** Stable, instance-qualified finding id: slugified join of the parts. */
export function findingId(...parts: string[]): string {
  return slugify(parts.join(' '));
}

/** The detected agent of a given kind, if any. */
export function detected(input: AnalyzerInput, kind: string): DetectedAgent | undefined {
  return input.agents.find((a) => a.kind === kind);
}

/** Content of a manifest file, or undefined when absent/withheld. */
export function contentOf(input: AnalyzerInput, path: string): string | undefined {
  return input.manifest.files.find((f) => f.path === path)?.content;
}

/** True when the manifest contains a file at exactly `path`. */
export function hasFile(input: AnalyzerInput, path: string): boolean {
  return input.manifest.files.some((f) => f.path === path);
}

const DIRECTIVE_PATTERN = /^\s*(?:[-*+]|\d+[.)])\s+(.+?)\s*$/;

/**
 * Normalized directive lines of a markdown body: bullet and numbered list
 * items, fence-aware, lowercased, backticks stripped, whitespace collapsed,
 * trailing punctuation dropped.
 */
export function directiveLines(body: string): string[] {
  const lines: string[] = [];
  const skipLine = createFenceFilter();
  for (const line of body.split('\n')) {
    if (skipLine(line)) continue;
    const match = DIRECTIVE_PATTERN.exec(line);
    if (!match || match[1] === undefined) continue;
    const normalized = match[1]
      .toLowerCase()
      .replace(/`/g, '')
      .replace(/\s+/g, ' ')
      .replace(/[.,;:!]+$/, '')
      .trim();
    if (normalized.length > 0) lines.push(normalized);
  }
  return lines;
}

/** Lowercased alphanumeric token set of a text. */
export function tokens(text: string): Set<string> {
  return new Set(
    text
      .toLowerCase()
      .split(/[^a-z0-9]+/)
      .filter((t) => t.length > 0),
  );
}

/** Token-set Jaccard: |A ∩ B| / |A ∪ B|. 0 when either side is empty. */
export function tokenJaccard(a: ReadonlySet<string>, b: ReadonlySet<string>): number {
  if (a.size === 0 || b.size === 0) return 0;
  let shared = 0;
  for (const t of a) if (b.has(t)) shared += 1;
  return shared / (a.size + b.size - shared);
}

/**
 * Directive similarity between two directive-line lists — the metric behind
 * the drift analyzers: for each line of the SMALLER side, take its best
 * token-Jaccard match on the other side, and average those best scores.
 *
 * Token-level matching keeps paraphrases similar where exact-line overlap
 * scores them 0: "run npm test before committing" vs "before you commit,
 * run npm test" share 4 of 7 tokens (≈0.57) despite being different lines.
 * Genuinely different instructions (different commands, values, topics)
 * still score near 0. Range 0..1; 0 when either side is empty.
 */
export function directiveSimilarity(a: readonly string[], b: readonly string[]): number {
  const [small, large] = a.length <= b.length ? [a, b] : [b, a];
  if (small.length === 0 || large.length === 0) return 0;
  const largeTokens = large.map((line) => tokens(line));
  let total = 0;
  for (const line of small) {
    const lineTokens = tokens(line);
    let best = 0;
    for (const candidate of largeTokens) {
      const score = tokenJaccard(lineTokens, candidate);
      if (score > best) best = score;
    }
    total += best;
  }
  return total / small.length;
}
