/**
 * FrontmatterCards — the visual card view of a parsed SKILL.md / agent .md
 * frontmatter (bead agentconfig-wmc.4). Presentational only: it takes an
 * already-parsed {@link SkillCard} and renders the model / tools / permissions
 * / hooks / inline-MCP groups as hairline cards. Every value is frontmatter-
 * derived text rendered as a text node — never markup.
 */

import type { SkillCard } from './logic.js';

function ChipRow({ label, items }: { label: string; items: readonly string[] }) {
  if (items.length === 0) return null;
  return (
    <div className="fmcard">
      <div className="micro-label fmcard__label">{label}</div>
      <div className="fmcard__chips">
        {items.map((item, i) => (
          <span key={`${item}:${i}`} className="mono-data fmcard__chip">
            {item}
          </span>
        ))}
      </div>
    </div>
  );
}

export function FrontmatterCards({ card }: { card: SkillCard }) {
  const empty =
    card.model === '' &&
    card.tools.length === 0 &&
    card.permissions.length === 0 &&
    card.hooks.length === 0 &&
    card.mcp.length === 0 &&
    card.other.length === 0 &&
    card.description === '';

  return (
    <div className="fmcards">
      <div className="fmcards__head">
        <span className="fmcards__name">{card.name}</span>
        {card.model !== '' && (
          <span className="mono-data fmcards__model">model · {card.model}</span>
        )}
      </div>

      {card.description !== '' && <p className="fmcards__desc">{card.description}</p>}

      {empty && <p className="micro-label fmcards__none">no frontmatter fields</p>}

      <ChipRow label="TOOLS" items={card.tools} />
      <ChipRow label="MCP" items={card.mcp} />
      <ChipRow label="PERMISSIONS" items={card.permissions} />
      <ChipRow label="HOOKS" items={card.hooks} />

      {card.other.length > 0 && (
        <div className="fmcard">
          <div className="micro-label fmcard__label">OTHER</div>
          <div className="fmcard__rows">
            {card.other.map((entry) => (
              <div key={entry.key} className="fmcard__row">
                <span className="mono-data fmcard__key">{entry.key}</span>
                <span className="mono-data fmcard__val">
                  {Array.isArray(entry.value) ? entry.value.join(', ') : entry.value}
                </span>
              </div>
            ))}
          </div>
        </div>
      )}
    </div>
  );
}
