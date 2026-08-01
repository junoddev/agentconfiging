/**
 * Minimal, SAFE Markdown block tokenizer for the preview panes (extracted from
 * instructions/logic.ts and rules/logic.ts, which carried identical copies;
 * RulePreview.tsx and both logic tests depend on its exact output).
 *
 * The React side renders each block as a TEXT node in an appropriate element —
 * there is no inline HTML and no `dangerouslySetInnerHTML`; the goal is light
 * structure (headings, code, lists, quotes, paragraphs), not fidelity. All input
 * is adversarially-parsed config and is only ever emitted as plain strings.
 */

/**
 * A preview block. Each renders as a TEXT node in an appropriate element — never
 * inline HTML.
 */
export type MarkdownBlock =
  | { kind: 'heading'; level: number; text: string }
  | { kind: 'code'; text: string }
  | { kind: 'list'; ordered: boolean; items: string[] }
  | { kind: 'quote'; text: string }
  | { kind: 'para'; text: string };

const FENCE_RE = /^\s*(?:```|~~~)/;
const HEADING_RE = /^(#{1,6})\s+(.*)$/;
const LIST_RE = /^\s*(?:[-*+]|\d+\.)\s+(.*)$/;
const ORDERED_RE = /^\s*\d+\.\s+/;
const QUOTE_RE = /^\s*>\s?(.*)$/;

/**
 * Tokenize Markdown into safe preview blocks. Fenced code is captured verbatim
 * (never scanned for structure); consecutive list items and paragraph lines are
 * grouped. Unterminated fences flush at end of input.
 */
export function tokenizeMarkdown(content: string): MarkdownBlock[] {
  const blocks: MarkdownBlock[] = [];
  const lines = content.split('\n');

  let para: string[] = [];
  let list: { ordered: boolean; items: string[] } | undefined;
  let code: string[] | undefined;

  const flushPara = () => {
    if (para.length > 0) {
      blocks.push({ kind: 'para', text: para.join('\n') });
      para = [];
    }
  };
  const flushList = () => {
    if (list) {
      blocks.push({ kind: 'list', ordered: list.ordered, items: list.items });
      list = undefined;
    }
  };
  const flushOpen = () => {
    flushPara();
    flushList();
  };

  for (const line of lines) {
    if (code !== undefined) {
      if (FENCE_RE.test(line)) {
        blocks.push({ kind: 'code', text: code.join('\n') });
        code = undefined;
      } else {
        code.push(line);
      }
      continue;
    }

    if (FENCE_RE.test(line)) {
      flushOpen();
      code = [];
      continue;
    }

    const heading = HEADING_RE.exec(line);
    if (heading) {
      flushOpen();
      blocks.push({ kind: 'heading', level: heading[1]?.length ?? 1, text: heading[2] ?? '' });
      continue;
    }

    const quote = QUOTE_RE.exec(line);
    if (quote) {
      flushOpen();
      blocks.push({ kind: 'quote', text: quote[1] ?? '' });
      continue;
    }

    const item = LIST_RE.exec(line);
    if (item) {
      flushPara();
      const ordered = ORDERED_RE.test(line);
      if (!list || list.ordered !== ordered) {
        flushList();
        list = { ordered, items: [] };
      }
      list.items.push(item[1] ?? '');
      continue;
    }

    if (line.trim() === '') {
      flushOpen();
      continue;
    }

    flushList();
    para.push(line);
  }

  if (code !== undefined) blocks.push({ kind: 'code', text: code.join('\n') });
  flushOpen();

  return blocks;
}
