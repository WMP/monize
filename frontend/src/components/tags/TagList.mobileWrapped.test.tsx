import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { render, screen, fireEvent } from '@/test/render';
import { TagList } from './TagList';
import { Tag } from '@/types/tag';
import { useDensityStore } from '@/store/densityStore';

/**
 * Model B: on a phone the density toggle picks the LAYOUT, not only the row
 * height. Below `sm` this table shows the name and nothing else -- Icon and
 * Transactions are `hidden sm:table-cell`, Actions is `hidden
 * min-[480px]:table-cell` -- so at Normal density each tag becomes a wrapped
 * card in a single `<td>` that carries them back, while Compact and Dense keep
 * the tier table, and so does every non-phone width.
 *
 * These are the combinations that decide it. The rest of the list's suite runs
 * under the harness's default `matchMedia` (`matches: false`) and so exercises
 * the tier table exactly as before -- which is the point of choosing the branch
 * in JS rather than with CSS variants.
 */

vi.mock('@/components/ui/IconPicker', () => ({
  getIconComponent: (name: string) => <span data-testid={`icon-${name}`}>{name}</span>,
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

function createTag(overrides: Partial<Tag> = {}): Tag {
  return {
    id: 'tag-1',
    userId: 'u1',
    name: 'Groceries',
    color: '#22c55e',
    icon: 'shopping-cart',
    createdAt: '2024-01-01T00:00:00Z',
    updatedAt: '2024-01-01T00:00:00Z',
    ...overrides,
  };
}

function renderList(tags: Tag[], props: Partial<Parameters<typeof TagList>[0]> = {}) {
  return render(
    <TagList
      tags={tags}
      transactionCounts={Object.fromEntries(tags.map((tag, i) => [tag.id, (i + 1) * 7]))}
      onEdit={vi.fn()}
      onDelete={vi.fn()}
      {...props}
    />,
  );
}

function bodyRows(container: HTMLElement): HTMLTableRowElement[] {
  return Array.from(container.querySelectorAll<HTMLTableRowElement>('tbody tr'));
}

describe('the tags list on a phone', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    localStorage.clear();
    useDensityStore.setState({ densities: {} });
  });

  afterEach(() => {
    window.matchMedia = originalMatchMedia;
  });

  it('renders each tag as a wrapped card at Normal density', () => {
    setPhoneViewport(true);
    useDensityStore.setState({ densities: { tags: 'normal' } });

    const { container } = renderList([createTag({ name: 'Groceries' })]);

    const rows = bodyRows(container);
    expect(rows).toHaveLength(1);
    // The whole card lives in one cell -- that is what makes it a card rather
    // than a table row with its columns squeezed.
    expect(rows[0].querySelectorAll('td')).toHaveLength(1);

    // More of the tag than a phone-width tier table shows, all in the one row:
    // the name, the icon this table hides below `sm`, and the transaction
    // count under the label that names it.
    const text = rows[0].textContent ?? '';
    expect(text).toContain('Groceries');
    expect(text).toContain('Transactions');
    expect(text).toContain('7');
    expect(rows[0].querySelector('[data-testid="icon-shopping-cart"]')).toBeTruthy();

    // The row actions stay in the long-press action sheet on phones.
    expect(text).not.toContain('Edit');
    expect(text).not.toContain('Delete');
  });

  it('keeps the colour chip and the count caption as separate nodes from the count', () => {
    setPhoneViewport(true);
    useDensityStore.setState({ densities: { tags: 'normal' } });

    const { container } = renderList([createTag({ color: '#22c55e' })]);

    const [row] = bodyRows(container);
    // The chip is the tier row's own inline-style swatch, not a new treatment.
    const chip = row.querySelector<HTMLElement>('span[style*="background-color"]');
    expect(chip).toBeTruthy();
    expect(chip!.className).toContain('rounded-full');

    // The caption is its own node, so an assertion on the value still matches
    // the value's node rather than "Transactions7".
    expect(screen.getByText('7').textContent).toBe('7');
    expect(screen.getByText('Transactions').textContent).toBe('Transactions');
  });

  it('shows the dash for an icon-less tag, exactly as the tier row does', () => {
    setPhoneViewport(true);
    useDensityStore.setState({ densities: { tags: 'normal' } });

    const { container } = renderList([createTag({ icon: null, color: null })]);

    const [row] = bodyRows(container);
    expect(row.querySelectorAll('td')).toHaveLength(1);
    expect(row.textContent).toContain('-');
    // The dash is narrower than an icon, so the glyph slot is a fixed width:
    // an `auto` track sized per row stepped the name column left and right
    // down the list (seen in the 390px replica, invisible to a class-string
    // assertion unless it names the slot).
    expect(row.querySelector('.w-5')).toBeTruthy();
  });

  it('lets a long name truncate in a grid track with a zero minimum', () => {
    setPhoneViewport(true);
    useDensityStore.setState({ densities: { tags: 'normal' } });

    const { container } = renderList([
      createTag({ name: 'Quarterly Household Maintenance Reserve' }),
    ]);

    const [row] = bodyRows(container);
    // jsdom does no layout, so this pins the mechanism, not the width: the
    // width itself was measured in a hand-CSS replica at 390px. `min-w-0` on a
    // flex item alone does not stop nowrap text setting the table's minimum
    // width -- the enclosing grid track has to have an explicit zero minimum.
    expect(row.querySelector('.grid')?.className).toContain('minmax(0,1fr)');
    expect(row.querySelector('.truncate')).toBeTruthy();
  });

  it('keeps the name a control that does not also open the row', () => {
    setPhoneViewport(true);
    useDensityStore.setState({ densities: { tags: 'normal' } });

    const onTagClick = vi.fn();
    const onEdit = vi.fn();
    const { container } = renderList([createTag()], { onTagClick, onEdit });

    const [row] = bodyRows(container);
    const nameButton = row.querySelector('button')!;
    expect(nameButton.textContent).toBe('Groceries');

    fireEvent.click(nameButton);
    expect(onTagClick).toHaveBeenCalledWith(expect.objectContaining({ id: 'tag-1' }));
    // The row's own click opens the edit form; the name must not fire it too.
    expect(onEdit).not.toHaveBeenCalled();
  });

  it('replaces the column header with a slim sort header', () => {
    setPhoneViewport(true);
    useDensityStore.setState({ densities: { tags: 'normal' } });

    const { container } = renderList([createTag()]);

    const head = container.querySelector('thead')!;
    expect(head.querySelectorAll('th')).toHaveLength(1);
    // The sort control survives as a button named by its column label.
    const labels = Array.from(head.querySelectorAll('button')).map(
      (button) => button.textContent?.replace(/[^A-Za-z ]/g, '').trim(),
    );
    expect(labels).toEqual(['Name']);
    // No column label of its own: the one card cell below carries all three
    // values, and Actions is not a column the phone has at all.
    expect(head.textContent).not.toContain('Icon');
    expect(head.textContent).not.toContain('Actions');
    // The arrow is a glyph, so the direction is announced here or nowhere.
    expect(head.querySelector('th')!.getAttribute('aria-sort')).toBe('ascending');
  });

  it('offers a sort control for every column the tier header sorts by', () => {
    // The two headers are separate JSX, so this is what ties them together: a
    // second sortable column in the tier header fails here until the phone's
    // slim header carries it too.
    setPhoneViewport(false);
    useDensityStore.setState({ densities: { tags: 'normal' } });
    const { container: tier, unmount } = renderList([createTag()]);
    const tierLabels = Array.from(tier.querySelectorAll('thead th')).map((th) =>
      th.textContent?.replace(/[^A-Za-z ]/g, '').trim(),
    );
    unmount();

    setPhoneViewport(true);
    const { container: phone } = renderList([createTag()]);
    const phoneLabels = Array.from(phone.querySelectorAll('thead button')).map(
      (button) => button.textContent?.replace(/[^A-Za-z ]/g, '').trim(),
    );

    // The tier header is the sortable columns plus the three un-sortable ones.
    expect(tierLabels).toEqual([...phoneLabels, 'Icon', 'Transactions', 'Actions']);
  });

  it('still sorts from the slim header, and says which way', () => {
    setPhoneViewport(true);
    useDensityStore.setState({ densities: { tags: 'normal' } });

    const { container } = renderList([
      createTag({ id: 'a', name: 'Alpha' }),
      createTag({ id: 'z', name: 'Zulu' }),
    ]);

    let rows = bodyRows(container);
    expect(rows[0].textContent).toContain('Alpha');

    const nameSort = container.querySelector<HTMLButtonElement>('thead button')!;
    fireEvent.click(nameSort);
    rows = bodyRows(container);
    expect(rows[0].textContent).toContain('Zulu');
    expect(container.querySelector('thead th')!.getAttribute('aria-sort')).toBe('descending');

    fireEvent.click(container.querySelector<HTMLButtonElement>('thead button')!);
    rows = bodyRows(container);
    expect(rows[0].textContent).toContain('Alpha');
    expect(container.querySelector('thead th')!.getAttribute('aria-sort')).toBe('ascending');
  });

  it('reports the slim header sort to a controlled parent', () => {
    setPhoneViewport(true);
    useDensityStore.setState({ densities: { tags: 'normal' } });

    const onSort = vi.fn();
    const { container } = renderList([createTag()], {
      sortField: 'name',
      sortDirection: 'asc',
      onSort,
    });

    fireEvent.click(container.querySelector<HTMLButtonElement>('thead button')!);
    expect(onSort).toHaveBeenCalledWith('name');
  });

  it('keeps the tier table at Compact density', () => {
    setPhoneViewport(true);
    useDensityStore.setState({ densities: { tags: 'compact' } });

    const { container } = renderList([createTag()]);

    const rows = bodyRows(container);
    expect(rows).toHaveLength(1);
    expect(rows[0].querySelectorAll('td').length).toBeGreaterThan(1);
    expect(container.querySelector('thead')!.querySelectorAll('th').length).toBeGreaterThan(1);
  });

  it('keeps the tier table at Dense density', () => {
    setPhoneViewport(true);
    useDensityStore.setState({ densities: { tags: 'dense' } });

    const { container } = renderList([createTag()]);

    expect(bodyRows(container)[0].querySelectorAll('td').length).toBeGreaterThan(1);
    expect(container.querySelector('thead')!.querySelectorAll('th').length).toBeGreaterThan(1);
  });

  it('keeps the tier table on a desktop width at Normal density', () => {
    setPhoneViewport(false);
    useDensityStore.setState({ densities: { tags: 'normal' } });

    const { container } = renderList([createTag()]);

    const rows = bodyRows(container);
    expect(rows).toHaveLength(1);
    expect(rows[0].querySelectorAll('td').length).toBeGreaterThan(1);
    expect(container.querySelector('thead')!.querySelectorAll('th').length).toBeGreaterThan(1);
  });

  it('still renders the empty state rather than a header with no rows', () => {
    setPhoneViewport(true);
    useDensityStore.setState({ densities: { tags: 'normal' } });

    const { container } = renderList([]);

    // This list has no `colSpan` empty-state row to keep in step with the
    // column count: it returns EmptyState instead of a table at all.
    expect(container.querySelector('table')).toBeNull();
    expect(screen.getByText('No tags found')).toBeInTheDocument();
  });
});
