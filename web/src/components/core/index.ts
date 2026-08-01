/** Core components — Console §5 contract (opendesign/DESIGN.md). Pure
 *  presentational chassis over the token layer; class names are the contract. */
export { AlsoAgents, type AlsoAgentsProps } from './AlsoAgents.js';
export { Button, type ButtonProps, type ButtonVariant } from './Button.js';
export { Card, type CardProps } from './Card.js';
export { ChipRow, type ChipOption, type ChipRowProps } from './ChipRow.js';
export { Dialog, type DialogProps } from './Dialog.js';
export { DiffPanel, type DiffPanelProps } from './DiffPanel.js';
export { EmptyState, type EmptyStateProps } from './EmptyState.js';
export { Field, Input, Select, type FieldProps } from './Field.js';
export { FileChip, type FileChipProps } from './FileChip.js';
export { Frame, type FrameProps } from './Frame.js';
export {
  ListCard,
  ListRow,
  EmptyRow,
  type ListCardProps,
  type ListRowProps,
  type EmptyRowProps,
} from './ListCard.js';
export { Notice, type NoticeProps } from './Notice.js';
export { Pager, type PagerProps } from './Pager.js';
export { Pill, type PillProps, type PillTone } from './Pill.js';
export { SearchInput, type SearchInputProps } from './SearchInput.js';
export { SegmentedControl, type SegmentedControlProps } from './SegmentedControl.js';
export { SourceBadge, type SourceBadgeProps } from './SourceBadge.js';
export { StatBlock, type StatBlockProps } from './StatBlock.js';
export { Switch, type SwitchProps } from './Switch.js';
export { Table, type TableProps, type TableHeader } from './Table.js';
export { ToastProvider, useToast, TOAST_DURATION_MS } from './Toast.js';
export { scopeClass, sourceBadgeText, type SourceScope } from './badge.js';
export { pageCount, pagerSummary } from './paging.js';
export {
  Heatmap,
  heatmapLevel,
  leadingBlankCount,
  type HeatmapProps,
  type HeatmapDatum,
} from './Heatmap.js';
export { formatIndex } from './finding.js';
export { formatDelta, deltaTone, type DeltaTone } from './stat.js';
export {
  diffLineClass,
  diffLinePrefix,
  type DiffHunk,
  type DiffLine,
  type DiffLineKind,
} from './diff.js';
export { formatBytes, fileChipTitle } from './file.js';
