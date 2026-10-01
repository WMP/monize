import type { BankSyncPreview, BankSyncPreviewOutcome, BankSyncPreviewRow } from '@/types/bank-sync';

/** The filter tabs of the preview: every row, or the rows of one outcome. */
export const PREVIEW_FILTERS = [
  'all',
  'new',
  'duplicate',
  'refused',
  'pending',
  'before_cutoff',
] as const;
export type PreviewFilter = (typeof PREVIEW_FILTERS)[number];

/** How many rows each tab holds, counted from the rows themselves. */
export function previewFilterCounts(rows: readonly BankSyncPreviewRow[]): Record<PreviewFilter, number> {
  const counts: Record<PreviewFilter, number> = {
    all: rows.length,
    new: 0,
    duplicate: 0,
    refused: 0,
    pending: 0,
    before_cutoff: 0,
  };
  for (const row of rows) counts[row.outcome] += 1;
  return counts;
}

/** The rows a tab shows, in the order the bank listed them. */
export function filterPreviewRows(
  rows: readonly BankSyncPreviewRow[],
  filter: PreviewFilter,
): BankSyncPreviewRow[] {
  return filter === 'all' ? [...rows] : rows.filter((row) => row.outcome === filter);
}

/** The pill colour of each outcome; the label is the catalog's. */
export const OUTCOME_VARIANTS: Record<
  BankSyncPreviewOutcome,
  'green' | 'gray' | 'red' | 'amber' | 'blue'
> = {
  new: 'green',
  duplicate: 'gray',
  refused: 'red',
  pending: 'amber',
  before_cutoff: 'blue',
};

/** A decimal string from the API as a number, or null when there is none or it is unreadable. */
export function previewAmount(value: string | null | undefined): number | null {
  if (value === null || value === undefined || value.trim() === '') return null;
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : null;
}

/**
 * The tab to show first: the rows the import would write, or every row when
 * there are none, so a preview of nothing new does not open on an empty tab.
 */
export function initialPreviewFilter(preview: Pick<BankSyncPreview, 'summary'>): PreviewFilter {
  return preview.summary.new > 0 ? 'new' : 'all';
}
