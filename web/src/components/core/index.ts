/** Core components (docs/DESIGN.md §6). Pure presentational chassis —
 *  nothing here animates; motion belongs to the signal layer. */
export { Button, type ButtonProps, type ButtonVariant } from './Button.js';
export { StatBlock, type StatBlockProps } from './StatBlock.js';
export { SignalStrip, type SignalStripProps } from './SignalStrip.js';
export { FindingRow, type FindingRowProps } from './FindingRow.js';
export { FileChip, type FileChipProps } from './FileChip.js';
export { DiffPanel, type DiffPanelProps } from './DiffPanel.js';
export { Table, type TableProps } from './Table.js';
export { EmptyState, type EmptyStateProps } from './EmptyState.js';
export {
  Heatmap,
  heatmapLevel,
  leadingBlankCount,
  type HeatmapProps,
  type HeatmapDatum,
} from './Heatmap.js';
export { severityToken, severityClass, formatIndex, type Severity } from './finding.js';
export { formatDelta, deltaTone, type DeltaTone } from './stat.js';
export {
  diffLineClass,
  diffLinePrefix,
  type DiffHunk,
  type DiffLine,
  type DiffLineKind,
} from './diff.js';
export { formatBytes, fileChipTitle } from './file.js';
