import './components.css';

export interface HeatmapDatum {
  /** UTC `YYYY-MM-DD`. */
  date: string;
  count: number;
}

export interface HeatmapProps {
  /** Daily activity cells, oldest first (the server's windowed heatmap). */
  cells: readonly HeatmapDatum[];
  /** Accessible name for the whole calendar. */
  label?: string;
}

/**
 * Bucket a day's count into one of five intensity steps (0 = empty, 1..4 =
 * increasing `--signal` opacity), relative to the window's busiest day. Pure and
 * exported so the bucketing is unit-testable without the DOM.
 */
export function heatmapLevel(count: number, max: number): 0 | 1 | 2 | 3 | 4 {
  if (count <= 0 || max <= 0) return 0;
  const ratio = count / max;
  if (ratio <= 0.25) return 1;
  if (ratio <= 0.5) return 2;
  if (ratio <= 0.75) return 3;
  return 4;
}

/**
 * Leading blank cells so the first column starts on the correct UTC weekday
 * (Sun=0). Keeps the calendar's day-of-week rows aligned. Returns 0 for an
 * absent/invalid first date.
 */
export function leadingBlankCount(firstDate: string | undefined): number {
  if (firstDate === undefined) return 0;
  const ms = Date.parse(`${firstDate}T00:00:00Z`);
  return Number.isNaN(ms) ? 0 : new Date(ms).getUTCDay();
}

/**
 * Activity calendar (DESIGN.md §6): 7-row weekday grid, squares with a 2px gap,
 * filled in `--signal` opacity steps by count — a hairline square when empty, no
 * zebra. Each day carries a `title` + `aria-label` (date + count); the counts are
 * numbers, so nothing here renders untrusted text. Pure-ish: `cells` in → grid out.
 */
export function Heatmap({ cells, label = 'activity calendar' }: HeatmapProps) {
  const max = cells.reduce((m, c) => (c.count > m ? c.count : m), 0);
  const blanks = leadingBlankCount(cells[0]?.date);
  return (
    <div className="heatmap" role="img" aria-label={label}>
      {Array.from({ length: blanks }, (_, i) => (
        <span key={`blank-${i}`} className="heatmap__cell heatmap__blank" aria-hidden="true" />
      ))}
      {cells.map((cell) => {
        const level = heatmapLevel(cell.count, max);
        return (
          <span
            key={cell.date}
            className={`heatmap__cell heatmap__cell--l${level}`}
            role="img"
            aria-label={`${cell.count} on ${cell.date}`}
            title={`${cell.date}: ${cell.count}`}
          />
        );
      })}
    </div>
  );
}
