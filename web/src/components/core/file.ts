/** FileChip pure logic (docs/DESIGN.md §6). DOM-free. */

/** Human-readable byte count: 512 → "512 B", 3120 → "3.0 KB". */
export function formatBytes(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  if (bytes < 1024 * 1024 * 1024) return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
  return `${(bytes / (1024 * 1024 * 1024)).toFixed(1)} GB`;
}

/** Hover metadata for a FileChip: "3.0 KB · a1b2c3d4". Returns undefined when
 *  there is nothing to show, so no empty tooltip is rendered. */
export function fileChipTitle(size?: number, sha?: string): string | undefined {
  const parts: string[] = [];
  if (size !== undefined) parts.push(formatBytes(size));
  if (sha !== undefined && sha !== '') parts.push(sha);
  return parts.length > 0 ? parts.join(' · ') : undefined;
}
