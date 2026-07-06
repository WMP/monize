import { useState, DragEvent } from 'react';

export type DropPosition = 'above' | 'below';

/**
 * Shared state for HTML5 drag-to-reorder lists (dashboard customize dialog,
 * Favourite Accounts widget, investment report column chooser).
 *
 * Rows spread `rowProps(index)`. While dragging, the hook tracks the
 * insertion gap under the pointer (gap g = "between row g-1 and row g",
 * derived from which half of the hovered row the pointer is in), so the
 * bottom half of one row and the top half of the next resolve to the SAME
 * gap and render one identical insertion line at that boundary. Gaps that
 * would not move the dragged item show no indicator. On drop,
 * `moveItem(from, to)` receives the source index and the insertion index
 * within the post-removal list.
 */
export function useDragReorder(moveItem: (from: number, to: number) => void) {
  const [dragIndex, setDragIndex] = useState<number | null>(null);
  const [gapIndex, setGapIndex] = useState<number | null>(null);

  const reset = () => {
    setDragIndex(null);
    setGapIndex(null);
  };

  const rowProps = (index: number) => ({
    draggable: true,
    onDragStart: () => setDragIndex(index),
    onDragOver: (e: DragEvent) => {
      e.preventDefault();
      const rect = e.currentTarget.getBoundingClientRect();
      const gap = e.clientY < rect.top + rect.height / 2 ? index : index + 1;
      if (gapIndex !== gap) setGapIndex(gap);
    },
    onDrop: (e: DragEvent) => {
      e.preventDefault();
      const from = dragIndex;
      const gap = gapIndex;
      reset();
      if (from === null || gap === null) return;
      const to = gap > from ? gap - 1 : gap; // account for the dragged item's removal
      if (to === from) return;
      moveItem(from, to);
    },
    onDragEnd: reset,
  });

  /**
   * The insertion line for the hovered gap, drawn once: on the top edge of
   * the row the gap precedes, or on the bottom edge of the last row for the
   * end-of-list gap. `itemCount` is the rendered list's length.
   */
  const dropIndicator = (index: number, itemCount: number): DropPosition | null => {
    if (dragIndex === null || gapIndex === null) return null;
    // Dropping into the gap on either side of the dragged row is a no-op.
    if (gapIndex === dragIndex || gapIndex === dragIndex + 1) return null;
    if (gapIndex === index) return 'above';
    if (index === itemCount - 1 && gapIndex === itemCount) return 'below';
    return null;
  };

  return { dragIndex, rowProps, dropIndicator };
}

/**
 * Insertion-line styling for the row `dropIndicator` points at: a 3px line
 * along the row's top or bottom edge (inset shadow, so no layout shift).
 */
export function dropIndicatorClass(indicator: DropPosition | null): string {
  if (indicator === 'above') {
    return 'shadow-[inset_0_3px_0_0_var(--color-blue-500)] dark:shadow-[inset_0_3px_0_0_var(--color-blue-400)]';
  }
  if (indicator === 'below') {
    return 'shadow-[inset_0_-3px_0_0_var(--color-blue-500)] dark:shadow-[inset_0_-3px_0_0_var(--color-blue-400)]';
  }
  return '';
}
