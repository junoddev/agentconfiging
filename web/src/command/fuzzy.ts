/**
 * Tiny pure subsequence fuzzy matcher for the command palette — no dependency
 * (DESIGN §6: CommandPalette is a mono, numbered, fuzzy-filtered list). A query
 * matches a target when its characters appear in order (case-insensitive). The
 * score rewards consecutive runs and word-boundary hits so the tightest matches
 * rank first; ties break toward shorter targets.
 */

export interface FuzzyMatch {
  matched: boolean;
  /** Higher is a better match. Meaningless when `matched` is false (0). */
  score: number;
  /** Positions in the target hit by the query, in order (for highlighting). */
  indices: number[];
}

/** A char that starts a new "word" — the char after it earns a boundary bonus. */
const BOUNDARY = /[^a-z0-9]/i;

export function fuzzyMatch(query: string, target: string): FuzzyMatch {
  const q = query.toLowerCase();
  const t = target.toLowerCase();
  if (q === '') return { matched: true, score: 0, indices: [] };

  const indices: number[] = [];
  let score = 0;
  let qi = 0;
  let prev = -2;
  for (let ti = 0; ti < t.length && qi < q.length; ti++) {
    if (t[ti] !== q[qi]) continue;
    indices.push(ti);
    score += 1;
    if (ti === prev + 1) score += 5; // consecutive run
    if (ti === 0 || BOUNDARY.test(t[ti - 1] as string)) score += 3; // word start
    prev = ti;
    qi++;
  }
  if (qi < q.length) return { matched: false, score: 0, indices: [] };
  // Mild tie-breaker: a tighter (shorter) target beats a longer one.
  return { matched: true, score: score - t.length * 0.01, indices };
}
