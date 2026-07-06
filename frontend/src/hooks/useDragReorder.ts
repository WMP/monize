import { useState, DragEvent } from 'react';

export type DropPosition = 'above' | 'below';

/**
 * Shared state for HTML5 drag-to-reorder lists (dashboard customize dialog,
 * Favourite Accounts widget, investment report column chooser).
 *
 * Rows spread `rowProps(index)`. While dragging, `dropIndicator(index)`
 * reports whether the dragged item would be inserted above or below the
 * hovered row (based on the pointer's vertical position within it) so the
 * list can draw an insertion line at the exact drop position instead of
 * highlighting the whole row. On drop, `moveItem(from, to)` receives the
 * source index and the insertion index within the post-removal list.
 */
export function useDragReorder(moveItem: (from: number, to: number) => void) {
  const [dragIndex, setDragIndex] = useState<number | null>(null);
  const [overIndex, setOverIndex] = useState<number | null>(null);
  const [overPosition, setOverPosition] = useState<DropPosition>('below');

  const reset = () => {
    setDragIndex(null);
    setOverIndex(null);
  };

  const rowProps = (index: number) => ({
    draggable: true,
    onDragStart: () => setDragIndex(index),
    onDragOver: (e: DragEvent) => {
      e.preventDefault();
      const rect = e.currentTarget.getBoundingClientRect();
      const position: DropPosition =
        e.clientY < rect.top + rect.height / 2 ? 'above' : 'below';
      if (overIndex !== index) setOverIndex(index);
      if (overPosition !== position) setOverPosition(position);
    },
    onDrop: (e: DragEvent) => {
      e.preventDefault();
      const from = dragIndex;
      // A drop is always preceded by a dragOver on the same row, so the
      // tracked position applies; fall back to 'below' just in case.
      const position = overIndex === index ? overPosition : 'below';
      reset();
      if (from === null) return;
      let to = position === 'above' ? index : index + 1;
      if (to > from) to -= 1; // account for the dragged item's removal
      if (to === from) return;
      moveItem(from, to);
    },
    onDragEnd: reset,
  });

  const dropIndicator = (index: number): DropPosition | null =>
    dragIndex !== null && overIndex === index && dragIndex !== index
      ? overPosition
      : null;

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
