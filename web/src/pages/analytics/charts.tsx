/**
 * Hand-rolled SVG charts for the Analytics page (bead 7yb.5) — NO chart-library
 * dependency. They follow the dataviz conventions mapped onto Signal Grid tokens
 * (DESIGN §6): a single `--signal` series (so no legend — the heading names it),
 * hairline baseline/gridlines that stay 1px at any width (`non-scaling-stroke`),
 * mono axis labels rendered as HTML around the SVG (kept at the micro-label size,
 * never distorted by the stretch), and a directly-labelled peak instead of a
 * value on every bar. Each bar carries a `<title>` for the per-mark hover.
 *
 * The SVG draws marks only; all text is HTML, so the chart stretches to its
 * container (`preserveAspectRatio="none"`) without warping labels. Inputs are
 * numbers only — nothing here renders untrusted text.
 */

import { barFraction, chartMax } from './logic.js';

/** Logical SVG coordinate space (stretched to the container by CSS). */
const VB_W = 640;
const VB_H = 180;
/** Fraction of a slot the bar fills (leaves the 2px-equivalent gap). */
const BAR_FILL = 0.68;

export interface BarChartProps {
  /** One bar per datum, left→right. */
  bars: readonly { key: string; value: number; title: string }[];
  /** Accessible name for the whole chart. */
  ariaLabel: string;
  /** Mono axis captions under the plot, evenly distributed. */
  axisLabels: readonly string[];
  /** Caption for the tallest bar (direct labelling), e.g. "peak $4.20". */
  peakLabel: string;
}

/**
 * A single-series bar chart. Bar heights are a fraction of the series max; the
 * baseline is a hairline. Empty series render an honest flat baseline.
 */
export function BarChart({ bars, ariaLabel, axisLabels, peakLabel }: BarChartProps) {
  const max = chartMax(bars.map((b) => b.value));
  const slot = VB_W / Math.max(1, bars.length);
  const barW = slot * BAR_FILL;

  return (
    <figure className="an-chart">
      <div className="an-chart__peak micro-label">{peakLabel}</div>
      <svg
        className="an-chart__svg"
        viewBox={`0 0 ${VB_W} ${VB_H}`}
        preserveAspectRatio="none"
        role="img"
        aria-label={ariaLabel}
      >
        {/* Recessive mid gridline + baseline (1px at any width). */}
        <line
          className="an-chart__grid"
          x1={0}
          y1={VB_H / 2}
          x2={VB_W}
          y2={VB_H / 2}
          vectorEffect="non-scaling-stroke"
        />
        <line
          className="an-chart__axis"
          x1={0}
          y1={VB_H}
          x2={VB_W}
          y2={VB_H}
          vectorEffect="non-scaling-stroke"
        />
        {bars.map((bar, i) => {
          const h = barFraction(bar.value, max) * VB_H;
          const x = i * slot + (slot - barW) / 2;
          return (
            <rect
              key={bar.key}
              className="an-chart__bar"
              x={x}
              y={VB_H - h}
              width={barW}
              height={h}
            >
              <title>{bar.title}</title>
            </rect>
          );
        })}
      </svg>
      <div className="an-chart__axis-labels micro-label">
        {axisLabels.map((label, i) => (
          <span key={`${i}-${label}`}>{label}</span>
        ))}
      </div>
    </figure>
  );
}
