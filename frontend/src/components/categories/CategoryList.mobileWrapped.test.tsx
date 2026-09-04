import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { render, screen, fireEvent, within } from '@/test/render';
import { CategoryList } from './CategoryList';
import { Category } from '@/types/category';
import { useDensityStore } from '@/store/densityStore';

/**
 * Model B: on a phone the density toggle picks the LAYOUT, not only the row
 * height. At Normal density each category is a wrapped card in a single `<td>`
 * -- which is how the Type and Count this table hides below `sm`/`md` get back
 * on screen -- while Compact and Dense keep the tier table, and so does every
 * non-phone width.
 *
 * These are the combinations that decide it. The rest of the list's suite runs
 * under the harness's default `matchMedia` (`matches: false`), so it exercises
 * the tier table exactly as before -- which is the point of choosing the branch
 * in JS rather than with CSS variants.
 */

vi.mock('@/lib/categories', () => ({
  categoriesApi: {
    getTransactionCount: vi.fn().mockResolvedValue(0),
    reassignTransactions: vi.fn().mockResolvedValue(undefined),
    delete: vi.fn().mockResolvedValue(undefined),
  },
}));

vi.mock('@/lib/logger', () => ({
  createLogger: () => ({ error: vi.fn(), info: vi.fn(), warn: vi.fn(), debug: vi.fn() }),
}));

const PHONE_QUERY = '(max-width: 639px)';

const originalMatchMedia = window.matchMedia;

/** Answer `true` only for the phone query `useIsMobile` asks. */
function setPhoneViewport(isPhone: boolean) {
  window.matchMedia = vi.fn().mockImplementation((query: string) => ({
    matches: isPhone && query === PHONE_QUERY,
    media: query,
    onchange: null,
    addListener: vi.fn(),
    removeListener: vi.fn(),
    addEventListener: vi.fn(),
    removeEventListener: vi.fn(),
    dispatchEvent: vi.fn(),
  })) as unknown as typeof window.matchMedia;
}

function makeCategory(overrides: Partial<Category> & { id: string; name: string }): Category {
  return {
    userId: 'user-1',
    parentId: null,
    parent: null,
    children: [],
    description: null,
    icon: null,
    color: null,
    effectiveColor: null,
    effectiveIcon: null,
    isIncome: false,
    isSystem: false,
    createdAt: '2026-01-01T00:00:00Z',
    transactionCount: 0,
    ...overrides,
  };
}

function renderList(categories: Category[]) {
  return render(
    <CategoryList categories={categories} onEdit={vi.fn()} onRefresh={vi.fn()} />,
  );
}

function bodyRows(container: HTMLElement): HTMLTableRowElement[] {
  return Array.from(container.querySelectorAll<HTMLTableRowElement>('tbody tr'));
}

describe('the categories list on a phone', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    localStorage.clear();
    useDensityStore.setState({ densities: {} });
  });

  afterEach(() => {
    window.matchMedia = originalMatchMedia;
  });

  it('renders each category as a wrapped card at Normal density', () => {
    setPhoneViewport(true);
    useDensityStore.setState({ densities: { categories: 'normal' } });

    const { container } = renderList([
      makeCategory({
        id: 'c1',
        name: 'Groceries',
        description: 'Food and household',
        transactionCount: 42,
      }),
    ]);

    const rows = bodyRows(container);
    expect(rows).toHaveLength(1);
    // The whole card lives in one cell -- that is what makes it a card rather
    // than a table row with its columns squeezed.
    expect(rows[0].querySelectorAll('td')).toHaveLength(1);

    // More of the category than a phone-width tier table shows, all in the one
    // row: the name and description, plus the type and count this table hides
    // below `sm` and `md`.
    const text = rows[0].textContent ?? '';
    expect(text).toContain('Groceries');
    expect(text).toContain('Food and household');
    expect(text).toContain('Expense');
    expect(text).toContain('42');

    // The row actions stay in the long-press action sheet on phones.
    expect(text).not.toContain('Edit');
    expect(text).not.toContain('Delete');
  });

  it('captions the bare transaction count with the column label it lost', () => {
    setPhoneViewport(true);
    useDensityStore.setState({ densities: { categories: 'normal' } });

    const { container } = renderList([
      makeCategory({ id: 'c1', name: 'Groceries', transactionCount: 42 }),
    ]);

    const [row] = bodyRows(container);
    // The caption is its own node, so the value still matches on its own --
    // which is what keeps `getByText('42')` addressing the count.
    expect(within(row).getByText('Count')).toBeInTheDocument();
    expect(within(row).getByText('42')).toBeInTheDocument();
    expect(within(row).getByText('42').textContent).toBe('42');
  });

  it('replaces the column header with a slim sort header', () => {
    setPhoneViewport(true);
    useDensityStore.setState({ densities: { categories: 'normal' } });

    const { container } = renderList([makeCategory({ id: 'c1', name: 'Groceries' })]);

    const head = container.querySelector('thead')!;
    expect(head.querySelectorAll('th')).toHaveLength(1);
    // Every sortable field survives as a button. Fewer would leave a list
    // sorted by a persisted field the phone can neither see nor undo -- and
    // Type and Count are exactly the columns this table hides on a phone.
    const labels = Array.from(head.querySelectorAll('button')).map((button) =>
      button.textContent?.replace(/[^A-Za-z ]/g, '').trim(),
    );
    expect(labels).toEqual(['Name', 'Type', 'Count']);
    // No column label of its own: the one card cell below carries all of them.
    expect(head.textContent).not.toContain('Actions');
    expect(head.textContent).not.toContain('Description');
    // The arrow glyph in a button is not a state, so the direction is
    // announced on the `<th>`.
    expect(head.querySelector('th')!.getAttribute('aria-sort')).toBe('ascending');
  });

  it('offers a sort control for every column the tier header sorts by', () => {
    // The two headers are separate JSX, so this is what ties them together: a
    // fourth sortable column in the tier header fails here until the phone's
    // slim header carries it too.
    setPhoneViewport(false);
    useDensityStore.setState({ densities: { categories: 'normal' } });
    const { container: tier, unmount } = renderList([makeCategory({ id: 'c1', name: 'Groceries' })]);
    const tierLabels = Array.from(tier.querySelectorAll('thead th')).map((th) =>
      th.textContent?.replace(/[^A-Za-z ]/g, '').trim(),
    );
    unmount();

    setPhoneViewport(true);
    const { container: phone } = renderList([makeCategory({ id: 'c1', name: 'Groceries' })]);
    const phoneLabels = Array.from(phone.querySelectorAll('thead button')).map((button) =>
      button.textContent?.replace(/[^A-Za-z ]/g, '').trim(),
    );

    // The tier header is the sortable columns plus the two that are not.
    expect(tierLabels).toEqual([...phoneLabels, 'Description', 'Actions']);
  });

  it('still sorts from the slim header', () => {
    setPhoneViewport(true);
    useDensityStore.setState({ densities: { categories: 'normal' } });

    const { container } = renderList([
      makeCategory({ id: 'c1', name: 'Rarely used', transactionCount: 1 }),
      makeCategory({ id: 'c2', name: 'Often used', transactionCount: 99 }),
    ]);

    const countSort = Array.from(
      container.querySelectorAll<HTMLButtonElement>('thead button'),
    ).find((button) => button.textContent?.includes('Count'))!;
    expect(countSort).toBeTruthy();

    // Count sorts descending first, so the busiest category leads.
    fireEvent.click(countSort);
    let rows = bodyRows(container);
    expect(rows[0].textContent).toContain('Often used');
    expect(rows[1].textContent).toContain('Rarely used');

    fireEvent.click(countSort);
    rows = bodyRows(container);
    expect(rows[0].textContent).toContain('Rarely used');
    expect(rows[1].textContent).toContain('Often used');
  });

  it('keeps the tree indent, so a subcategory is still recognisable', () => {
    setPhoneViewport(true);
    useDensityStore.setState({ densities: { categories: 'normal' } });

    const { container } = renderList([
      makeCategory({ id: 'c1', name: 'Food', parentId: null }),
      makeCategory({ id: 'c2', name: 'Groceries', parentId: 'c1' }),
      makeCategory({ id: 'c3', name: 'Organic', parentId: 'c2' }),
    ]);

    const indents = bodyRows(container).map(
      (row) => (row.querySelector('td > div > div') as HTMLElement).style.paddingLeft,
    );
    // The same per-level step the tier row uses, from the same helper: depth is
    // the only thing that says a category is a subcategory.
    expect(indents).toEqual(['0rem', '1.5rem', '3rem']);
  });

  it('lets the name and the description truncate rather than widen the table', () => {
    setPhoneViewport(true);
    useDensityStore.setState({ densities: { categories: 'normal' } });

    const { container } = renderList([
      makeCategory({
        id: 'c1',
        name: 'Household supplies and cleaning products',
        description: 'Everything bought for the house that is not food or utilities',
      }),
    ]);

    const [row] = bodyRows(container);
    // jsdom does no layout, so this pins the mechanism, not the width: a
    // truncating region needs a grid track with an explicit zero minimum,
    // because a flex item's `min-w-0` still contributes the full width of its
    // nowrap text to the table's minimum. The width itself was measured in a
    // hand-CSS replica at 390px.
    const grids = Array.from(row.querySelectorAll<HTMLElement>('.grid'));
    expect(grids).toHaveLength(2);
    for (const grid of grids) {
      expect(grid.className).toContain('minmax(0,1fr)');
    }
    expect(row.querySelectorAll('.truncate').length).toBe(2);
  });

  it('keeps the system marker and still withholds Delete from the card', () => {
    setPhoneViewport(true);
    useDensityStore.setState({ densities: { categories: 'normal' } });

    const { container } = renderList([
      makeCategory({ id: 'c1', name: 'Transfer', isSystem: true }),
    ]);

    const [row] = bodyRows(container);
    expect(row.querySelectorAll('td')).toHaveLength(1);
    expect(row.textContent).toContain('(System)');
    expect(row.textContent).not.toContain('Delete');
  });

  it('still opens the category transactions from the name inside the card', () => {
    setPhoneViewport(true);
    useDensityStore.setState({ densities: { categories: 'normal' } });

    const { container } = renderList([makeCategory({ id: 'c1', name: 'Groceries' })]);

    const [row] = bodyRows(container);
    // The name is a control inside a clickable row, so it is a button here as
    // it is in the tier row.
    expect(within(row).getByRole('button', { name: 'Groceries' })).toBeInTheDocument();
    expect(container.querySelector('tbody tr')).toHaveClass('cursor-pointer');
  });

  it('keeps the tier table at Compact density', () => {
    setPhoneViewport(true);
    useDensityStore.setState({ densities: { categories: 'compact' } });

    const { container } = renderList([makeCategory({ id: 'c1', name: 'Groceries' })]);

    const rows = bodyRows(container);
    expect(rows).toHaveLength(1);
    expect(rows[0].querySelectorAll('td').length).toBeGreaterThan(1);
    expect(container.querySelector('thead')!.querySelectorAll('th').length).toBeGreaterThan(1);
  });

  it('keeps the tier table at Dense density', () => {
    setPhoneViewport(true);
    useDensityStore.setState({ densities: { categories: 'dense' } });

    const { container } = renderList([makeCategory({ id: 'c1', name: 'Groceries' })]);

    const rows = bodyRows(container);
    expect(rows[0].querySelectorAll('td').length).toBeGreaterThan(1);
  });

  it('keeps the tier table on a desktop width at Normal density', () => {
    setPhoneViewport(false);
    useDensityStore.setState({ densities: { categories: 'normal' } });

    const { container } = renderList([makeCategory({ id: 'c1', name: 'Groceries' })]);

    const rows = bodyRows(container);
    expect(rows).toHaveLength(1);
    expect(rows[0].querySelectorAll('td').length).toBeGreaterThan(1);
    expect(container.querySelector('thead')!.querySelectorAll('th').length).toBeGreaterThan(1);
  });

  it('renders the empty state without a table on a phone', () => {
    setPhoneViewport(true);
    useDensityStore.setState({ densities: { categories: 'normal' } });

    renderList([]);

    // There is no `colSpan` empty-state row to reconcile with the wrapped
    // column count: the empty state replaces the table outright.
    expect(screen.queryByRole('table')).not.toBeInTheDocument();
    expect(screen.getByText('No categories')).toBeInTheDocument();
  });
});
