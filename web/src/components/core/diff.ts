/** DiffPanel pure logic and model types (docs/DESIGN.md §6). DOM-free.
 *  DiffPanel renders an already-parsed diff model — parsing raw diff text
 *  lives elsewhere. */

export type DiffLineKind = 'add' | 'del' | 'ctx';

export interface DiffLine {
  kind: DiffLineKind;
  /** Line content WITHOUT the leading +/-/space marker. Rendered verbatim as
   *  a text node — never as markup. */
  text: string;
}

export interface DiffHunk {
  /** Hunk header, e.g. `@@ -1,3 +1,4 @@`. */
  header: string;
  lines: readonly DiffLine[];
}

/** Line kind → CSS class list for the rendered diff line. */
export function diffLineClass(kind: DiffLineKind): string {
  switch (kind) {
    case 'add':
      return 'diff__line diff__line--add';
    case 'del':
      return 'diff__line diff__line--del';
    case 'ctx':
      return 'diff__line';
  }
}

/** Line kind → unified-diff marker column. */
export function diffLinePrefix(kind: DiffLineKind): '+' | '-' | ' ' {
  switch (kind) {
    case 'add':
      return '+';
    case 'del':
      return '-';
    case 'ctx':
      return ' ';
  }
}
