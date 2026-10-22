'use client';

import { ArrowDownIcon, ArrowUpIcon, TrashIcon } from '@heroicons/react/24/outline';
import { HOVER_ROW_ON_CARD } from '@/components/ui/Card';

/** The list with the entry at `index` moved one place (`by` -1 earlier, 1 later); the same list when it cannot move. */
export function moveRow<T>(rows: readonly T[], index: number, by: -1 | 1): T[] {
  const target = index + by;
  if (index < 0 || target < 0 || target >= rows.length) return [...rows];
  const next = [...rows];
  [next[index], next[target]] = [next[target], next[index]];
  return next;
}

const ICON_BUTTON_CLASS = `rounded p-1 text-gray-500 focus-visible:ring-2 focus-visible:ring-blue-500 disabled:cursor-not-allowed disabled:opacity-40 dark:text-gray-400 ${HOVER_ROW_ON_CARD}`;

interface TradeRowButtonsProps {
  index: number;
  count: number;
  labels: { up: string; down: string; remove: string };
  onMove: (by: -1 | 1) => void;
  onRemove: () => void;
}

/** Earlier, later and remove for one row of an ordered list (account rules, currency markers): the first that applies wins, so the order is the person's to set. */
export function TradeRowButtons({ index, count, labels, onMove, onRemove }: TradeRowButtonsProps) {
  return (
    <span className="flex items-center gap-1">
      <button type="button" onClick={() => onMove(-1)} disabled={index === 0} aria-label={labels.up} className={ICON_BUTTON_CLASS}>
        <ArrowUpIcon className="h-4 w-4" aria-hidden />
      </button>
      <button
        type="button"
        onClick={() => onMove(1)}
        disabled={index === count - 1}
        aria-label={labels.down}
        className={ICON_BUTTON_CLASS}
      >
        <ArrowDownIcon className="h-4 w-4" aria-hidden />
      </button>
      <button type="button" onClick={onRemove} aria-label={labels.remove} className={ICON_BUTTON_CLASS}>
        <TrashIcon className="h-4 w-4" aria-hidden />
      </button>
    </span>
  );
}
