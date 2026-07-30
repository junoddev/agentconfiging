/**
 * Rendered rule preview (bead agentconfig-wmc.6; Console conversion 4u1.4).
 * Given raw rule content, it re-parses on every render so the preview stays
 * live with the editor draft, and shows: PATH FILTERS (globs as `.code`
 * chips), the description, and a SAFE markdown render of the body.
 *
 * SAFETY: every value here comes from adversarially-parsed config. Globs,
 * description, and body all render as TEXT NODES only — the tokenizer strips
 * markdown structure to plain strings, and nothing uses dangerouslySetInnerHTML.
 */

import { useMemo, type ReactNode } from 'react';
import { parseRule, tokenizeMarkdown, type MarkdownBlock } from './logic.js';

/** Path-filter chips: the globs a rule is scoped to, or an "always" note. */
export function PathFilters({
  globs,
  alwaysApply,
  hasFrontmatter,
}: {
  globs: readonly string[];
  alwaysApply: boolean;
  hasFrontmatter: boolean;
}) {
  return (
    <div className="rule-filters">
      <span className="meta">path filters</span>
      {globs.length > 0 ? (
        globs.map((glob, i) => (
          <span key={`${glob}-${i}`} className="code" title={glob}>
            {glob}
          </span>
        ))
      ) : (
        // No globs — always in context. Cursor uses `alwaysApply`; a plain
        // `.claude/rules/*.md` has no frontmatter and is likewise unscoped.
        <span className="meta">
          {alwaysApply || !hasFrontmatter ? 'always · no path filter' : 'no path filter'}
        </span>
      )}
    </div>
  );
}

/** One safe preview block → a text-node element. */
function renderBlock(block: MarkdownBlock, key: number): ReactNode {
  switch (block.kind) {
    case 'heading':
      return (
        <p key={key} className="rule-md-h" style={{ fontSize: `${1.4 - block.level * 0.1}em` }}>
          {block.text}
        </p>
      );
    case 'code':
      return (
        <pre key={key} className="rule-md-code mono">
          {block.text}
        </pre>
      );
    case 'quote':
      return (
        <p key={key} className="rule-md-quote">
          {block.text}
        </p>
      );
    case 'list':
      return block.ordered ? (
        <ol key={key} className="rule-md-list">
          {block.items.map((item, i) => (
            <li key={i}>{item}</li>
          ))}
        </ol>
      ) : (
        <ul key={key} className="rule-md-list">
          {block.items.map((item, i) => (
            <li key={i}>{item}</li>
          ))}
        </ul>
      );
    case 'para':
      return (
        <p key={key} className="rule-md-para">
          {block.text}
        </p>
      );
  }
}

/** Full rule preview: path-filter chips, description, and safe markdown body. */
export function RulePreview({ content }: { content: string }) {
  const parsed = useMemo(() => parseRule(content), [content]);
  const blocks = useMemo(() => tokenizeMarkdown(parsed.body), [parsed.body]);
  return (
    <div className="rule-preview">
      <PathFilters
        globs={parsed.pathFilters}
        alwaysApply={parsed.alwaysApply}
        hasFrontmatter={parsed.hasFrontmatter}
      />
      {parsed.description !== '' && <p className="rule-desc">{parsed.description}</p>}
      <div className="rule-md">{blocks.map((b, i) => renderBlock(b, i))}</div>
    </div>
  );
}
