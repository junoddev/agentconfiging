/**
 * diff — a dependency-free unified-diff generator for the WRITE API dry-run
 * (SPEC §4.3, bead agentconfig-gxo.3). No new deps: an LCS over lines drives a
 * standard textual unified diff with 3 lines of context. The web layer parses
 * the TEXT into `{hunks:[{header,lines:[{kind,text}]}]}` for DiffPanel — this
 * function only ever returns the diff string (empty string when identical).
 *
 * `create` diffs against the empty string (`--- /dev/null`); `modify` diffs the
 * current on-disk content against the proposed content.
 */

const CONTEXT = 3;

/** Split into content lines, dropping the single trailing empty from a final \n. */
function splitLines(text: string): string[] {
  if (text === '') return [];
  const parts = text.split('\n');
  if (parts[parts.length - 1] === '') parts.pop();
  return parts;
}

interface Op {
  kind: ' ' | '-' | '+';
  text: string;
}

/** Longest-common-subsequence edit script over two line arrays. */
function diffOps(a: string[], b: string[]): Op[] {
  const n = a.length;
  const m = b.length;
  // dp[i][j] = LCS length of a[i:] and b[j:]. Rows are always length m+1.
  const dp: number[][] = Array.from({ length: n + 1 }, () => new Array<number>(m + 1).fill(0));
  for (let i = n - 1; i >= 0; i -= 1) {
    const row = dp[i]!;
    const next = dp[i + 1]!;
    const ai = a[i]!;
    for (let j = m - 1; j >= 0; j -= 1) {
      row[j] = ai === b[j]! ? next[j + 1]! + 1 : Math.max(next[j]!, row[j + 1]!);
    }
  }
  const ops: Op[] = [];
  let i = 0;
  let j = 0;
  while (i < n && j < m) {
    if (a[i]! === b[j]!) {
      ops.push({ kind: ' ', text: a[i]! });
      i += 1;
      j += 1;
    } else if (dp[i + 1]![j]! >= dp[i]![j + 1]!) {
      ops.push({ kind: '-', text: a[i]! });
      i += 1;
    } else {
      ops.push({ kind: '+', text: b[j]! });
      j += 1;
    }
  }
  while (i < n) ops.push({ kind: '-', text: a[i++]! });
  while (j < m) ops.push({ kind: '+', text: b[j++]! });
  return ops;
}

export function unifiedDiff(oldText: string, newText: string, relPath: string): string {
  const a = splitLines(oldText);
  const b = splitLines(newText);
  const ops = diffOps(a, b);
  if (!ops.some((o) => o.kind !== ' ')) return '';

  // 0-based old/new line index at the position of each op.
  const aNums: number[] = [];
  const bNums: number[] = [];
  let ai = 0;
  let bi = 0;
  for (const o of ops) {
    aNums.push(ai);
    bNums.push(bi);
    if (o.kind === ' ') {
      ai += 1;
      bi += 1;
    } else if (o.kind === '-') {
      ai += 1;
    } else {
      bi += 1;
    }
  }

  // Merge each change's ±CONTEXT window into hunk ranges over the ops array.
  const ranges: { lo: number; hi: number }[] = [];
  ops.forEach((o, idx) => {
    if (o.kind === ' ') return;
    const lo = Math.max(0, idx - CONTEXT);
    const hi = Math.min(ops.length - 1, idx + CONTEXT);
    const last = ranges[ranges.length - 1];
    if (last && lo <= last.hi + 1) last.hi = Math.max(last.hi, hi);
    else ranges.push({ lo, hi });
  });

  const lines: string[] = [
    `--- ${oldText === '' ? '/dev/null' : `a/${relPath}`}`,
    `+++ ${newText === '' ? '/dev/null' : `b/${relPath}`}`,
  ];

  for (const { lo, hi } of ranges) {
    let oldCount = 0;
    let newCount = 0;
    for (let k = lo; k <= hi; k += 1) {
      if (ops[k]!.kind !== '+') oldCount += 1;
      if (ops[k]!.kind !== '-') newCount += 1;
    }
    const oldStart = oldCount > 0 ? aNums[lo]! + 1 : aNums[lo]!;
    const newStart = newCount > 0 ? bNums[lo]! + 1 : bNums[lo]!;
    lines.push(`@@ -${oldStart},${oldCount} +${newStart},${newCount} @@`);
    for (let k = lo; k <= hi; k += 1) {
      const op = ops[k]!;
      lines.push(`${op.kind}${op.text}`);
    }
  }

  return lines.join('\n') + '\n';
}
