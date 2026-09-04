'use client';

import { useState, useMemo, useCallback, memo } from 'react';
import { useTranslations } from 'next-intl';
import { useRouter } from 'next/navigation';
import { Category } from '@/types/category';
import { CategoryGlyph } from '@/components/categories/CategoryGlyph';
import { DeleteCategoryDialog } from './DeleteCategoryDialog';
import { categoriesApi } from '@/lib/categories';
import toast from 'react-hot-toast';
import { createLogger } from '@/lib/logger';
import { getErrorMessage } from '@/lib/errors';
import { useTableDensity, type DensityLevel } from '@/hooks/useTableDensity';
import { useDensityPreference } from '@/store/densityStore';
import { HIGHLIGHT_FLASH, HIGHLIGHT_FLASH_CELL, useScrollIntoViewWhen } from '@/hooks/useHighlightTarget';
import { SortIcon } from '@/components/ui/SortIcon';
import { useLongPress, type LongPressRowHandlers } from '@/hooks/useLongPress';
import { RowActions } from '@/components/ui/row-actions/RowActions';
import { RowActionSheet } from '@/components/ui/row-actions/RowActionSheet';
import type { RowAction } from '@/components/ui/row-actions/rowAction';
import { DensityToggleBar } from '@/components/ui/DensityToggle';
import { EmptyState } from '@/components/ui/EmptyState';
import { useIsMobile } from '@/hooks/useIsMobile';
import { CellLabel } from '@/components/ui/Table';

const logger = createLogger('CategoryList');

/**
 * Builds the standard row actions for a category. Shared by the desktop
 * `RowActions` cell and the mobile `RowActionSheet`.
 */
function buildCategoryActions(
  category: Category,
  labels: { edit: string; delete: string },
  handlers: { onEdit: (category: Category) => void; onDeleteClick: (category: Category) => void },
): RowAction[] {
  return [
    {
      key: 'edit',
      label: labels.edit,
      icon: 'edit',
      tone: 'primary',
      onClick: () => handlers.onEdit(category),
    },
    {
      key: 'delete',
      label: labels.delete,
      icon: 'delete',
      tone: 'delete',
      destructive: true,
      onClick: () => handlers.onDeleteClick(category),
      hidden: category.isSystem,
    },
  ];
}

export type { DensityLevel } from '@/hooks/useTableDensity';

export type SortField = 'name' | 'type' | 'count';
export type SortDirection = 'asc' | 'desc';

/**
 * Every field this list sorts by, with the header label that names it, in the
 * tier header's own order. The phone's slim control header renders all of
 * them: the chosen field is persisted (`monize-categories-sort-field`, set on
 * the Categories page) and Type and Count are the two columns the tier table
 * hides below `sm`/`md`, so a header offering fewer would strand a phone on a
 * sort order it can neither see nor undo. Description and Actions are absent
 * because neither is sortable.
 */
const SORT_FIELD_LABEL_KEYS = [
  { field: 'name', labelKey: 'list.colName' },
  { field: 'type', labelKey: 'list.colType' },
  { field: 'count', labelKey: 'list.colCount' },
] as const satisfies ReadonlyArray<{ field: SortField; labelKey: string }>;

/**
 * How far a row is inset for its depth in the category tree. The indent is the
 * only thing that says a category is a subcategory, so both layouts take it
 * from here rather than each spelling out the per-density step.
 */
function categoryIndentRem(level: number, density: DensityLevel): number {
  return level * (density === 'dense' ? 0.75 : 1.5);
}

/** What the Description column shows, including its empty placeholder. */
function categoryDescriptionText(category: Category): string {
  return category.description || '-';
}

/**
 * The category's icon-or-colour marker, in both layouts.
 *
 * Two decisions live here rather than at each call site: a dense row drops to
 * the bare colour dot (an icon at that row height is noise rather than a cue),
 * and the icon shown is the *effective* one -- the category's own, or the
 * nearest ancestor's -- drawn dimmed when it was inherited.
 */
function CategoryMark({
  category,
  density,
  className,
}: {
  category: Category;
  density: DensityLevel;
  className: string;
}) {
  const t = useTranslations('categories');
  const glyphIcon = density === 'dense' ? null : (category.effectiveIcon ?? category.icon);
  return (
    <CategoryGlyph
      icon={glyphIcon}
      color={category.effectiveColor}
      inherited={!category.color && !category.icon}
      size={glyphIcon ? 16 : density === 'dense' ? 8 : 12}
      title={
        !category.color && category.effectiveColor
          ? t('list.inheritedColorTitle')
          : undefined
      }
      className={className}
    />
  );
}

/**
 * The category name as a link to its transactions. A control inside a
 * clickable row, so its click must not also open the category's detail page --
 * which is why both layouts render it from here.
 */
function CategoryNameButton({
  category,
  onViewTransactions,
  className = '',
}: {
  category: Category;
  onViewTransactions: (category: Category) => void;
  className?: string;
}) {
  const t = useTranslations('categories');
  return (
    <button
      onClick={(e) => { e.stopPropagation(); onViewTransactions(category); }}
      className={`text-sm font-medium text-blue-600 dark:text-blue-400 hover:text-blue-800 dark:hover:text-blue-300 hover:underline text-left${className ? ` ${className}` : ''}`}
      title={t('list.viewTransactionsTitle')}
    >
      {category.name}
    </button>
  );
}

/** The "(System)" marker beside the name, in both layouts. */
function SystemBadge({ category, density }: { category: Category; density: DensityLevel }) {
  const t = useTranslations('categories');
  if (!category.isSystem || density === 'dense') return null;
  return (
    <span className="ml-2 text-xs text-gray-400 dark:text-gray-500">{t('list.systemBadge')}</span>
  );
}

/** The Income/Expense pill, in both layouts. */
function CategoryTypePill({ category, density }: { category: Category; density: DensityLevel }) {
  const t = useTranslations('categories');
  return (
    <span
      className={`inline-flex text-xs leading-5 font-semibold rounded-full ${
        category.isIncome
          ? 'bg-green-100 text-green-800 dark:bg-green-900 dark:text-green-200'
          : 'bg-red-100 text-red-800 dark:bg-red-900 dark:text-red-200'
      } ${density === 'dense' ? 'px-1.5 py-0.5' : 'px-2 py-1'}`}
    >
      {category.isIncome ? t('list.badgeIncome') : t('list.badgeExpense')}
    </span>
  );
}

interface CategoryRowProps {
  category: Category & { _level?: number };
  density: DensityLevel;
  cellPadding: string;
  onEdit: (category: Category) => void;
  onDeleteClick: (category: Category) => void;
  onViewTransactions: (category: Category) => void;
  index: number;
  getRowHandlers: (category: Category) => LongPressRowHandlers;
  isHighlighted?: boolean;
  /**
   * Render the row as a wrapped card instead of the tier table's cells. The
   * list sets it for phones at Normal density only (Model B: on a phone the
   * density toggle picks the layout); every other width and every other
   * density renders the tier row below, unchanged.
   *
   * The card carries every value the tier row shows at Normal density -- the
   * marker and the indent that say where the category sits in the tree, the
   * name, the "(System)" marker, the transaction Count (captioned, since a
   * bare number has no header to name it here), the Income/Expense pill and
   * the description. Only the Actions column is left out: those actions are
   * what the long-press (and right-click) sheet these same row handlers open
   * already carries. The description keeps its "-" placeholder rather than
   * disappearing, because that is what the column it comes from shows, and it
   * is uncaptioned: it sits beside the self-describing type pill and reads as
   * the category's own prose.
   *
   * The two breakpoints are not the same one. The tier row's Actions cell is
   * `min-[480px]`, and `wrapped` covers everything below 640px, so between
   * 480px and 639px at Normal density the actions move from inline buttons to
   * that sheet -- which also means they stop being tab-reachable there. It is
   * the price of the card, paid for the Type and Count this table hides below
   * `sm`/`md`, and the register and the accounts list make the same trade at
   * the same two widths, so all three behave alike. Compact density, one tap
   * away, is the way back to inline actions.
   */
  wrapped?: boolean;
}

const CategoryRow = memo(function CategoryRow({
  category,
  density,
  cellPadding,
  onEdit,
  onDeleteClick,
  onViewTransactions,
  index,
  getRowHandlers,
  isHighlighted,
  wrapped = false,
}: CategoryRowProps) {
  const t = useTranslations('categories');
  const tc = useTranslations('common');
  const rowRef = useScrollIntoViewWhen<HTMLTableRowElement>(!!isHighlighted);

  const actions = useMemo(
    () => buildCategoryActions(
      category,
      { edit: tc('actions.edit'), delete: tc('actions.delete') },
      { onEdit, onDeleteClick },
    ),
    [category, tc, onEdit, onDeleteClick],
  );

  const indentRem = categoryIndentRem(category._level || 0, density);

  // Phone + Normal density: one wrapped card per row instead of the tier
  // table's cells (see the `wrapped` prop). It is a LAYOUT mode, not a
  // different set of facts -- the marker, the name, the "(System)" marker, the
  // type pill and the description are the same components the tier branch
  // renders, and the indent is the same helper, so the two cannot disagree
  // about what a category is or where it sits in the tree.
  if (wrapped) {
    return (
      <tr
        ref={rowRef}
        className={`group hover:bg-gray-100 dark:hover:bg-gray-800 cursor-pointer select-none bg-white dark:bg-gray-900 ${isHighlighted ? HIGHLIGHT_FLASH : ''}`}
        {...getRowHandlers(category)}
      >
        <td className="p-0">
          {/* The inset is the density table's, not a hand-picked one: two
              insets on one screen misalign, and the header above these cards
              is padded from the same table. */}
          <div className={cellPadding}>
            {/* A grid, not a flex row, and `minmax(0,1fr)` rather than a plain
                `1fr`: a track that may be zero lets the name truncate, where a
                flex item's `min-w-0` still contributes the full width of its
                nowrap text to the table's minimum. On a phone that is not
                merely a scrollbar -- mobile Chrome sizes the viewport
                `position: fixed` attaches to from the widest content on the
                page. The tree indent rides on this inner div so the card's own
                inset stays the table's. */}
            <div
              className="grid grid-cols-[auto_minmax(0,1fr)_auto] gap-x-3 gap-y-1.5 items-start"
              style={{ paddingLeft: `${indentRem}rem` }}
            >
              <CategoryMark category={category} density={density} className="mt-0.5" />
              {/* `flex-wrap` is what keeps the NAME the identity of the card.
                  The name is the only shrinkable item here (`truncate` floors
                  its min-width at zero) while "(System)" cannot shrink below
                  its one word, so on a narrow phone the marker took its full
                  width out of the name's: measured in the replica, a deeply
                  indented system category's name rendered 4px wide at 320px
                  and 74px at 390px. Wrapping lets the marker drop to its own
                  line instead (91px and 161px), and a short system name -- the
                  common case -- still keeps it inline. */}
              <div className="min-w-0 flex flex-wrap items-center">
                <CategoryNameButton
                  category={category}
                  onViewTransactions={onViewTransactions}
                  className="truncate"
                />
                <SystemBadge category={category} density={density} />
              </div>
              {/* A bare number with no column header to name it, so it carries
                  the header's own label. The caption is its own node, above
                  the value's, so a test still matches the count on its own. */}
              <div className="text-right whitespace-nowrap">
                <CellLabel>{t('list.colCount')}</CellLabel>
                <div className="text-sm text-gray-600 dark:text-gray-400">
                  {category.transactionCount ?? 0}
                </div>
              </div>
              {/* Line 2 is its own grid for the same reason line 1 is: the
                  description truncates, so it needs a track with a zero
                  minimum rather than a flex slot. */}
              <div className="col-span-3 grid grid-cols-[auto_minmax(0,1fr)] items-center gap-2">
                <CategoryTypePill category={category} density={density} />
                <div className="text-sm text-gray-500 dark:text-gray-400 truncate">
                  {categoryDescriptionText(category)}
                </div>
              </div>
            </div>
          </div>
        </td>
      </tr>
    );
  }

  return (
    <tr
      ref={rowRef}
      className={`group hover:bg-gray-100 dark:hover:bg-gray-800 cursor-pointer select-none ${density !== 'normal' && index % 2 === 1 ? 'bg-gray-50 dark:bg-table-stripe-dark' : 'bg-white dark:bg-gray-900'} ${isHighlighted ? HIGHLIGHT_FLASH : ''}`}
      {...getRowHandlers(category)}
    >
      <td className={`${cellPadding} whitespace-nowrap`}>
        <div
          className="flex items-center"
          style={{ paddingLeft: `${indentRem}rem` }}
        >
          <CategoryMark category={category} density={density} className="mr-2" />
          <CategoryNameButton category={category} onViewTransactions={onViewTransactions} />
          <SystemBadge category={category} density={density} />
        </div>
      </td>
      <td className={`${cellPadding} whitespace-nowrap hidden sm:table-cell`}>
        <CategoryTypePill category={category} density={density} />
      </td>
      <td className={`${cellPadding} whitespace-nowrap text-right text-sm text-gray-600 dark:text-gray-400 hidden md:table-cell`}>
        {category.transactionCount ?? 0}
      </td>
      {density === 'normal' && (
        <td className={`${cellPadding}`}>
          <div className="text-sm text-gray-500 dark:text-gray-400 max-w-xs truncate">
            {categoryDescriptionText(category)}
          </div>
        </td>
      )}
      <td className={`${cellPadding} whitespace-nowrap text-right text-sm font-medium hidden min-[480px]:table-cell sticky right-0 ${density !== 'normal' && index % 2 === 1 ? 'bg-gray-50 dark:bg-table-stripe-dark' : 'bg-white dark:bg-gray-900'} group-hover:bg-gray-100 dark:group-hover:bg-gray-800 ${isHighlighted ? HIGHLIGHT_FLASH_CELL : ''}`}>
        <RowActions actions={actions} density={density} />
      </td>
    </tr>
  );
});

interface CategoryListProps {
  categories: Category[];
  onEdit: (category: Category) => void;
  onRefresh: () => void;
  onDelete?: (categoryId: string) => void;
  sortField?: SortField;
  sortDirection?: SortDirection;
  onSort?: (field: SortField) => void;
  /** Category id to flash/scroll to (e.g. arriving from a deep link). */
  highlightId?: string | null;
}

export function CategoryList({
  categories,
  onEdit,
  onRefresh,
  onDelete,
  sortField: propSortField,
  sortDirection: propSortDirection,
  onSort,
  highlightId,
}: CategoryListProps) {
  const t = useTranslations('categories');
  const tc = useTranslations('common');
  const router = useRouter();
  const [deleteCategory, setDeleteCategory] = useState<Category | null>(null);
  const [actionSheet, setActionSheet] = useState<{ open: boolean; category: Category | null }>({ open: false, category: null });
  const { density } = useDensityPreference('categories');
  const [localSortField, setLocalSortField] = useState<SortField>('name');
  const [localSortDirection, setLocalSortDirection] = useState<SortDirection>('asc');

  // Use prop sort state if provided (controlled), otherwise use local state
  const sortField = propSortField ?? localSortField;
  const sortDirection = propSortDirection ?? localSortDirection;


  const { cellPadding, headerPadding } = useTableDensity(density);
  // Model B: on a phone, density picks the LAYOUT rather than only the row
  // height. At Normal each category is a wrapped card carrying the Type and
  // Count this table hides below `sm`/`md`; Compact and Dense keep the tier
  // table, unchanged, and so does every non-phone width. Exactly one branch
  // renders per row, chosen here.
  const isMobile = useIsMobile();
  const wrapped = isMobile && density === 'normal';

  const handleSort = useCallback((field: SortField) => {
    if (onSort) {
      onSort(field);
    } else {
      if (localSortField === field) {
        setLocalSortDirection((prev) => (prev === 'asc' ? 'desc' : 'asc'));
      } else {
        setLocalSortField(field);
        setLocalSortDirection(field === 'count' ? 'desc' : 'asc');
      }
    }
  }, [onSort, localSortField]);

  const handleViewTransactions = useCallback((category: Category) => {
    router.push(`/transactions?categoryId=${category.id}`);
  }, [router]);

  const handleDeleteClick = useCallback((category: Category) => {
    if (category.isSystem) {
      toast.error(t('toasts.cannotDeleteSystem'));
      return;
    }
    setDeleteCategory(category);
  }, [t]);

  // A row click opens the category's detail page, matching the payees,
  // accounts and securities lists; Edit stays on the row actions and the
  // long-press sheet.
  const { getRowHandlers } = useLongPress<Category>({
    onLongPress: (category) => setActionSheet({ open: true, category }),
    onClick: (category) => router.push(`/categories/${category.id}`),
  });

  const handleConfirmDelete = async (reassignToCategoryId: string | null) => {
    if (!deleteCategory) return;

    try {
      // Check if there are transactions to reassign
      const count = await categoriesApi.getTransactionCount(deleteCategory.id);
      if (count > 0) {
        await categoriesApi.reassignTransactions(deleteCategory.id, reassignToCategoryId);
      }

      await categoriesApi.delete(deleteCategory.id);
      toast.success(t('toasts.deleted'));
      if (onDelete) {
        onDelete(deleteCategory.id);
      } else {
        onRefresh();
      }
    } catch (error) {
      toast.error(getErrorMessage(error, t('toasts.deleteFailed')));
      logger.error(error);
    } finally {
      setDeleteCategory(null);
    }
  };

  // Sorting function for categories
  const sortCategories = useCallback((cats: Category[]) => {
    return [...cats].sort((a, b) => {
      let comparison = 0;
      if (sortField === 'name') {
        comparison = a.name.localeCompare(b.name);
      } else if (sortField === 'type') {
        // Income comes before Expense when ascending
        comparison = (a.isIncome === b.isIncome) ? 0 : (a.isIncome ? -1 : 1);
      } else if (sortField === 'count') {
        comparison = (a.transactionCount ?? 0) - (b.transactionCount ?? 0);
      }
      return sortDirection === 'asc' ? comparison : -comparison;
    });
  }, [sortField, sortDirection]);

  // Build tree structure with sorting
  const treeCategories = useMemo(() => {
    const buildTree = (parentId: string | null = null, level: number = 0): (Category & { _level: number })[] => {
      const children = categories.filter((c) => c.parentId === parentId);
      const sorted = sortCategories(children);
      return sorted.flatMap((category) => [
        { ...category, _level: level },
        ...buildTree(category.id, level + 1),
      ]);
    };
    return buildTree();
  }, [categories, sortCategories]);

  if (categories.length === 0) {
    return (
      <EmptyState
        icon={
          <svg fill="none" viewBox="0 0 24 24" stroke="currentColor">
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M7 7h.01M7 3h5c.512 0 1.024.195 1.414.586l7 7a2 2 0 010 2.828l-7 7a2 2 0 01-2.828 0l-7-7A1.994 1.994 0 013 12V7a4 4 0 014-4z" />
          </svg>
        }
        title={t('list.emptyHeading')}
        description={t('list.emptyDescription')}
      />
    );
  }

  return (
    <div>
      {/* Density toggle */}
      <DensityToggleBar view="categories" />
      <div className="overflow-x-auto">
        <table className="min-w-full divide-y divide-gray-200 dark:divide-gray-700">
          {/* On a phone the wrapped card labels its own values, so the column
              header is dropped -- but the controls in that header row must not
              go with it: these `<th>`s are how the list is sorted, the chosen
              field is persisted by the Categories page, and two of the three
              sortable columns are hidden below `sm`/`md`, so a phone could be
              left sorted by a field it can neither see nor undo. A slim
              control header carries all three as buttons -- the card shows all
              three values -- and no column label of its own: the single card
              cell below holds name, count, type and description at once, so
              naming this header after any one of them would misdescribe the
              column to a screen reader. Each button names itself with the
              label of the field it sorts by. */}
          <thead className="bg-gray-50 dark:bg-gray-800">
            {wrapped ? (
            <tr>
              {/* The one column is always sorted by something, and `aria-sort`
                  is the only place that direction is announced -- the arrow in
                  each button's label is a glyph, not a state. */}
              <th
                className={`${headerPadding} text-left`}
                aria-sort={sortDirection === 'asc' ? 'ascending' : 'descending'}
              >
                <div className="flex flex-wrap items-center gap-x-4 gap-y-1">
                  {SORT_FIELD_LABEL_KEYS.map(({ field, labelKey }) => (
                    <button
                      key={field}
                      type="button"
                      onClick={() => handleSort(field)}
                      className="flex items-center text-xs font-medium text-gray-500 dark:text-gray-400 uppercase tracking-wider rounded focus-visible:outline-2 focus-visible:outline-blue-500"
                    >
                      {t(labelKey)}
                      <SortIcon field={field} sortField={sortField} sortDirection={sortDirection} />
                    </button>
                  ))}
                </div>
              </th>
            </tr>
            ) : (
            <tr>
              <th
                className={`${headerPadding} text-left text-xs font-medium text-gray-500 dark:text-gray-400 uppercase tracking-wider cursor-pointer hover:text-gray-700 dark:hover:text-gray-200`}
                onClick={() => handleSort('name')}
              >
                {t('list.colName')}<SortIcon field="name" sortField={sortField} sortDirection={sortDirection} />
              </th>
              <th
                className={`${headerPadding} text-left text-xs font-medium text-gray-500 dark:text-gray-400 uppercase tracking-wider cursor-pointer hover:text-gray-700 dark:hover:text-gray-200 hidden sm:table-cell`}
                onClick={() => handleSort('type')}
              >
                {t('list.colType')}<SortIcon field="type" sortField={sortField} sortDirection={sortDirection} />
              </th>
              <th
                className={`${headerPadding} text-right text-xs font-medium text-gray-500 dark:text-gray-400 uppercase tracking-wider cursor-pointer hover:text-gray-700 dark:hover:text-gray-200 hidden md:table-cell`}
                onClick={() => handleSort('count')}
              >
                {t('list.colCount')}<SortIcon field="count" sortField={sortField} sortDirection={sortDirection} />
              </th>
              {density === 'normal' && (
                <th className={`${headerPadding} text-left text-xs font-medium text-gray-500 dark:text-gray-400 uppercase tracking-wider`}>
                  {t('list.colDescription')}
                </th>
              )}
              <th className={`${headerPadding} text-right text-xs font-medium text-gray-500 dark:text-gray-400 uppercase tracking-wider hidden min-[480px]:table-cell sticky right-0 bg-gray-50 dark:bg-gray-800`}>
                {t('list.colActions')}
              </th>
            </tr>
            )}
          </thead>
          <tbody className="bg-white dark:bg-gray-900 divide-y divide-gray-200 dark:divide-gray-700">
            {treeCategories.map((category: Category & { _level?: number }, index) => (
              <CategoryRow
                key={category.id}
                category={category}
                density={density}
                cellPadding={cellPadding}
                onEdit={onEdit}
                onDeleteClick={handleDeleteClick}
                onViewTransactions={handleViewTransactions}
                index={index}
                getRowHandlers={getRowHandlers}
                isHighlighted={!!highlightId && category.id === highlightId}
                wrapped={wrapped}
              />
            ))}
          </tbody>
        </table>
      </div>

      <DeleteCategoryDialog
        isOpen={deleteCategory !== null}
        category={deleteCategory}
        categories={categories}
        onConfirm={handleConfirmDelete}
        onCancel={() => setDeleteCategory(null)}
      />

      <RowActionSheet
        isOpen={actionSheet.open}
        title={actionSheet.category?.name ?? ''}
        actions={actionSheet.category
          ? buildCategoryActions(
              actionSheet.category,
              { edit: tc('actions.edit'), delete: tc('actions.delete') },
              { onEdit, onDeleteClick: handleDeleteClick },
            )
          : []}
        onClose={() => setActionSheet({ open: false, category: null })}
      />
    </div>
  );
}
