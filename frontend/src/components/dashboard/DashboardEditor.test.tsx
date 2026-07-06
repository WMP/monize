import { describe, it, expect, vi, beforeEach } from 'vitest';
import { fireEvent, screen } from '@testing-library/react';
import { render } from '@/test/render';
import { DashboardEditor } from './DashboardEditor';
import { DASHBOARD_WIDGETS, type ResolvedDashboardWidget } from './widget-registry';

// Two real registry entries: first shown, second hidden.
function buildItems(): ResolvedDashboardWidget[] {
  const chosen = DASHBOARD_WIDGETS.filter((e) =>
    ['favourite-accounts', 'upcoming-bills'].includes(e.id),
  );
  return chosen.map((entry, index) => ({ entry, visible: index === 0 }));
}

describe('DashboardEditor', () => {
  const onToggle = vi.fn();
  const onMove = vi.fn();
  const onReorder = vi.fn();

  beforeEach(() => {
    onToggle.mockReset();
    onMove.mockReset();
    onReorder.mockReset();
  });

  function renderEditor() {
    return render(
      <DashboardEditor
        items={buildItems()}
        onToggle={onToggle}
        onMove={onMove}
        onReorder={onReorder}
      />,
    );
  }

  it('lists each widget by its display name', () => {
    renderEditor();
    expect(screen.getByText('Favourite Accounts')).toBeInTheDocument();
    expect(screen.getByText('Upcoming Bills & Deposits')).toBeInTheDocument();
  });

  it('toggles visibility via the show/hide button', () => {
    renderEditor();
    // First widget is visible -> its toggle offers to hide it.
    fireEvent.click(screen.getByLabelText('Hide Favourite Accounts'));
    expect(onToggle).toHaveBeenCalledWith('favourite-accounts');
    // Second widget is hidden -> its toggle offers to show it.
    fireEvent.click(screen.getByLabelText('Show Upcoming Bills & Deposits'));
    expect(onToggle).toHaveBeenCalledWith('upcoming-bills');
  });

  it('moves widgets with the keyboard-accessible up/down buttons', () => {
    renderEditor();
    // Move up is disabled for the first row.
    expect(screen.getByLabelText('Move Favourite Accounts up')).toBeDisabled();
    // Move down is disabled for the last row.
    expect(
      screen.getByLabelText('Move Upcoming Bills & Deposits down'),
    ).toBeDisabled();

    fireEvent.click(screen.getByLabelText('Move Favourite Accounts down'));
    expect(onMove).toHaveBeenCalledWith('favourite-accounts', 'down');

    fireEvent.click(screen.getByLabelText('Move Upcoming Bills & Deposits up'));
    expect(onMove).toHaveBeenCalledWith('upcoming-bills', 'up');
  });

  it('reorders via native drag-and-drop', () => {
    const { container } = renderEditor();
    const rows = container.querySelectorAll('li');
    expect(rows).toHaveLength(2);

    // jsdom does not implement DataTransfer, so supply a stub. The handler
    // relies on setData/effectAllowed/dropEffect being callable/assignable.
    const dataTransfer = { setData: vi.fn(), getData: vi.fn(), effectAllowed: '', dropEffect: '' };

    fireEvent.dragStart(rows[0], { dataTransfer });
    expect(dataTransfer.setData).toHaveBeenCalledWith('text/plain', 'favourite-accounts');
    expect(dataTransfer.effectAllowed).toBe('move');

    fireEvent.dragOver(rows[1], { dataTransfer });
    expect(dataTransfer.dropEffect).toBe('move');

    fireEvent.drop(rows[1], { dataTransfer });

    expect(onReorder).toHaveBeenCalledWith('favourite-accounts', 'upcoming-bills');
  });

  it('does not reorder when dropped on the dragged item itself', () => {
    const { container } = renderEditor();
    const rows = container.querySelectorAll('li');
    const dataTransfer = { setData: vi.fn(), getData: vi.fn(), effectAllowed: '', dropEffect: '' };
    fireEvent.dragStart(rows[0], { dataTransfer });
    fireEvent.drop(rows[0], { dataTransfer });
    expect(onReorder).not.toHaveBeenCalled();
  });
});
