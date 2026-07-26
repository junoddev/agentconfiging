/**
 * Rendered rule preview (bead agentconfig-wmc.6). Given raw rule content, it
 * re-parses on every render so the preview stays live with the editor draft,
 * and shows: PATH-FILTER badges (globs → chips), the description, and a SAFE
 * markdown render of the body.
 *
 * SAFETY: every value here comes from adversarially-parsed config. Globs,
 * description, and body all render as TEXT NODES only — the tokenizer strips
 * markdown structure to plain strings, and nothing uses dangerouslySetInnerHTML.
 */

import { useMemo, type ReactNode } from 'react';
import { parseRule, tokenizeMarkdown, type MarkdownBlock } from './logic.js';

/** Path-filter badges: the globs a rule is scoped to, or an "always" note. */
export function PathFilters({
  globs,
  alwaysApply,
  hasFrontmatter,
}: {
  globs: readonly string[];
  alwaysApply: boolean;
  hasFrontmatter: boolean;
}) {
  if (globs.length > 0) {
    return (
      <div className="rules__filters">
        <span className="micro-label rules__filters-label">PATH FILTERS</span>
        <div className="rules__badges">
          {globs.map((glob, i) => (
            <span key={`${glob}-${i}`} className="rules__badge mono-data" title={glob}>
              {glob}
            </span>
          ))}
        </div>
      </div>
    );
  }
  // No globs — always in context. Cursor uses `alwaysApply`; a plain
  // `.claude/rules/*.md` has no frontmatter and is likewise unscoped.
  return (
    <div className="rules__filters">
      <span className="micro-label rules__filters-label">PATH FILTERS</span>
      <span className="rules__badge rules__badge--always mono-data">
        {alwaysApply || !hasFrontmatter ? 'always · no path filter' : 'no path filter'}
      </span>
    </div>
  );
}

/** One safe preview block → a text-node element. */
function renderBlock(block: MarkdownBlock, key: number): ReactNode {
  switch (block.kind) {
    case 'heading':
      return (
        <p key={key} className="rules__md-h" style={{ fontSize: `${1.4 - block.level * 0.1}em` }}>
          {block.text}
        </p>
      );
    case 'code':
      return (
        <pre key={key} className="rules__md-code mono-data">
          {block.text}
        </pre>
      );
    case 'quote':
      return (
        <p key={key} className="rules__md-quote">
          {block.text}
        </p>
      );
    case 'list':
      return block.ordered ? (
        <ol key={key} className="rules__md-list">
          {block.items.map((item, i) => (
            <li key={i}>{item}</li>
          ))}
        </ol>
      ) : (
        <ul key={key} className="rules__md-list">
          {block.items.map((item, i) => (
            <li key={i}>{item}</li>
          ))}
        </ul>
      );
    case 'para':
      return (
        <p key={key} className="rules__md-para">
          {block.text}
        </p>
      );
  }
}

/** Full rule preview: path-filter badges, description, and safe markdown body. */
export function RulePreview({ content }: { content: string }) {
  const parsed = useMemo(() => parseRule(content), [content]);
  const blocks = useMemo(() => tokenizeMarkdown(parsed.body), [parsed.body]);
  return (
    <div className="rules__preview">
      <PathFilters
        globs={parsed.pathFilters}
        alwaysApply={parsed.alwaysApply}
        hasFrontmatter={parsed.hasFrontmatter}
      />
      {parsed.description !== '' && <p className="rules__desc">{parsed.description}</p>}
      <div className="rules__md">{blocks.map((b, i) => renderBlock(b, i))}</div>
    </div>
  );
}
