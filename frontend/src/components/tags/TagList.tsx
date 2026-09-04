'use client';

import { useState, useMemo, useCallback, memo } from 'react';
import { useTranslations } from 'next-intl';
import { Tag } from '@/types/tag';
import { getIconComponent } from '@/components/ui/IconPicker';
import { useTableDensity, type DensityLevel } from '@/hooks/useTableDensity';
import { useDensityPreference } from '@/store/densityStore';
import { SortIcon } from '@/components/ui/SortIcon';
import { useLongPress, type LongPressRowHandlers } from '@/hooks/useLongPress';
import { RowActions } from '@/components/ui/row-actions/RowActions';
import { RowActionSheet } from '@/components/ui/row-actions/RowActionSheet';
import type { RowAction } from '@/components/ui/row-actions/rowAction';
import { DensityToggleBar } from '@/components/ui/DensityToggle';
import { EmptyState } from '@/components/ui/EmptyState';
import { CellLabel } from '@/components/ui/Table';
import { useIsMobile } from '@/hooks/useIsMobile';

export type { DensityLevel } from '@/hooks/useTableDensity';

/**
 * Builds the standard row actions for a tag. Shared by the desktop `RowActions`
 * cell and the mobile `RowActionSheet`.
 */
function buildTagActions(
  tag: Tag,
  labels: { edit: string; delete: string },
  handlers: { onEdit: (tag: Tag) => void; onDeleteClick: (tag: Tag) => void },
): RowAction[] {
  return [
    { key: 'edit', label: labels.edit, icon: 'edit', tone: 'primary', onClick: () => handlers.onEdit(tag) },
    { key: 'delete', label: labels.delete, icon: 'delete', tone: 'delete', destructive: true, onClick: () => handlers.onDeleteClick(tag) },
  ];
}

export type SortField = 'name' | 'createdAt';
export type SortDirection = 'asc' | 'desc';

/**
 * Every field this header offers a sort control for, with the column label that
 * names it. The tier column header and the phone's slim control header both
 * render from this one list, so a control added to either cannot go missing
 * from the other.
 *
 * `createdAt` is a member of `SortField` and is NOT here, deliberately: this
 * table has no Created column, no header label key for one, and the tier header
 * offers no control for it either -- the tags page reaches it only through the
 * `sortField` prop it persists. A stored `createdAt` is therefore not a dead
 * end on a phone the way an invisible column would be: the Name button is the
 * way back on every width, exactly as it is on the desktop header. Giving the
 * phone a control the tier header lacks would also need a new translation key,
 * which this layout change does not add.
 */
const SORT_FIELD_LABEL_KEYS = [
  { field: 'name', labelKey: 'list.header.name' },
] as const satisfies ReadonlyArray<{ field: SortField; labelKey: string }>;

/**
 * What the Icon column holds: the tag's glyph, or the dash that says it has
 * none. The tier row's Icon cell and the phone card's first grid track both
 * render it from here, so an icon-less tag reads the same in both layouts.
 */
function TagIcon({ tag }: { tag: Tag }) {
  if (!tag.icon) {
    return <span className="text-sm text-gray-400 dark:text-gray-500">-</span>;
  }
  return (
    <span className="text-gray-600 dark:text-gray-400 [&>svg]:w-5 [&>svg]:h-5">
      {getIconComponent(tag.icon)}
    </span>
  );
}

/**
 * The tag's colour chip and its name. Two decisions live here rather than being
 * copied into the card: the name is a link when the list was given an
 * `onTagClick` and plain text otherwise, and the chip's size follows density.
 * The link stops the click from also reaching the row (which opens the edit
 * form), on both layouts.
 *
 * `truncate` is the only difference between the two call sites. In the card the
 * name sits in a `minmax(0,1fr)` grid track and has to be allowed to shrink to
 * nothing -- a 40-character tag name that cannot shrink sets the table's
 * minimum width, and on a phone that displaces every `position: fixed` panel on
 * the page. The tier cell is `whitespace-nowrap` and passes nothing, so its
 * markup is unchanged.
 */
function TagNameLabel({
  tag,
  density,
  onTagClick,
  truncate = false,
}: {
  tag: Tag;
  density: DensityLevel;
  onTagClick?: (tag: Tag) => void;
  truncate?: boolean;
}) {
  return (
    <div className={`flex items-center${truncate ? ' min-w-0' : ''}`}>
      {tag.color && (
        <span
          className={`rounded-full mr-2 flex-shrink-0 ${density === 'dense' ? 'w-2 h-2' : 'w-3 h-3'}`}
          style={{ backgroundColor: tag.color }}
        />
      )}
      {onTagClick ? (
        <button
          onClick={(e) => { e.stopPropagation(); onTagClick(tag); }}
          className={`text-sm font-medium text-blue-600 dark:text-blue-400 hover:text-blue-800 dark:hover:text-blue-300 hover:underline${truncate ? ' truncate' : ''}`}
        >
          {tag.name}
        </button>
      ) : (
        <span className={`text-sm font-medium text-gray-900 dark:text-gray-100${truncate ? ' truncate' : ''}`}>
          {tag.name}
        </span>
      )}
    </div>
  );
}

interface TagRowProps {
  tag: Tag;
  transactionCount: number;
  density: DensityLevel;
  cellPadding: string;
  onEdit: (tag: Tag) => void;
  onDeleteClick: (tag: Tag) => void;
  onTagClick?: (tag: Tag) => void;
  index: number;
  getRowHandlers: (tag: Tag) => LongPressRowHandlers;
  /**
   * Render the row as a wrapped card instead of the tier table's four cells.
   * The list sets it for phones at Normal density only (Model B: on a phone the
   * density toggle picks the layout); every other width and every other level
   * renders the tier row below, unchanged.
   *
   * Below `sm` the tier table shows the name and nothing else -- Icon and
   * Transactions are `hidden sm:table-cell` and Actions is
   * `hidden min-[480px]:table-cell` -- so the card carries all three of the
   * values back: the icon (or its dash), the colour chip and name, and the
   * transaction count under the Transactions column label. One line is the
   * whole row: this table has no description, date or secondary line to put on
   * a second one.
   *
   * Only the Actions column is left out, because the long-press (and
   * right-click) sheet these same row handlers open already carries Edit and
   * Delete. The two breakpoints are not the same one: the tier Actions cell
   * appears at `min-[480px]` and `wrapped` covers everything below 640px, so
   * between 480px and 639px at Normal density the actions move from inline
   * buttons to that sheet -- and stop being tab-reachable there, since the
   * sheet opens on long-press or right-click. The register and the accounts
   * list make the same trade at the same two widths, so every list behaves
   * alike; Compact density, one tap away, is the way back to inline actions.
   */
  wrapped?: boolean;
}

const TagRow = memo(function TagRow({
  tag,
  transactionCount,
  density,
  cellPadding,
  onEdit,
  onDeleteClick,
  onTagClick,
  index,
  getRowHandlers,
  wrapped = false,
}: TagRowProps) {
  const t = useTranslations('tags');
  const tc = useTranslations('common');

  const actions = useMemo(
    () => buildTagActions(tag, { edit: tc('actions.edit'), delete: tc('actions.delete') }, { onEdit, onDeleteClick }),
    [tag, tc, onEdit, onDeleteClick],
  );

  // Phone + Normal density: one wrapped card per row instead of the tier
  // table's four cells (see the `wrapped` prop). It is a LAYOUT mode, not a
  // different set of facts -- the icon, the chip, the name and the count are
  // the same renderings the tier branch below uses, from the same helpers.
  // Row striping is not one of them: `wrapped` implies Normal density, where
  // the tier row is unstriped too.
  if (wrapped) {
    return (
      <tr
        className="group hover:bg-gray-100 dark:hover:bg-gray-800 cursor-pointer select-none bg-white dark:bg-gray-900"
        {...getRowHandlers(tag)}
      >
        <td className="p-0">
          {/* The inset is the density table's, not a hand-picked one: two
              insets on one screen misalign. A grid rather than a flex row so
              the name track has an explicit zero minimum -- `min-w-0` on a
              flex item still contributes its nowrap text to the table's
              minimum width. */}
          <div className={`${cellPadding} grid grid-cols-[auto_minmax(0,1fr)_auto] gap-x-3 items-center`}>
            {/* The glyph slot is a fixed width because the dash is narrower
                than an icon: an `auto` track sized per row would step the name
                column left and right down the list. The tier table has fixed
                columns and never shows that. */}
            <span className="flex w-5 justify-center">
              <TagIcon tag={tag} />
            </span>
            <TagNameLabel tag={tag} density={density} onTagClick={onTagClick} truncate />
            {/* The header is gone on a phone, so the bare count names its own
                column -- through the shared caption, not a local copy. */}
            <div className="text-right">
              <CellLabel>{t('list.header.transactions')}</CellLabel>
              <span className="text-sm text-gray-500 dark:text-gray-400 whitespace-nowrap">
                {transactionCount}
              </span>
            </div>
          </div>
        </td>
      </tr>
    );
  }

  return (
    <tr
      className={`group hover:bg-gray-100 dark:hover:bg-gray-800 cursor-pointer select-none ${density !== 'normal' && index % 2 === 1 ? 'bg-gray-50 dark:bg-table-stripe-dark' : 'bg-white dark:bg-gray-900'}`}
      {...getRowHandlers(tag)}
    >
      <td className={`${cellPadding} whitespace-nowrap`}>
        <TagNameLabel tag={tag} density={density} onTagClick={onTagClick} />
      </td>
      <td className={`${cellPadding} whitespace-nowrap hidden sm:table-cell`}>
        <TagIcon tag={tag} />
      </td>
      <td className={`${cellPadding} whitespace-nowrap text-right text-sm text-gray-500 dark:text-gray-400 hidden sm:table-cell`}>
        {transactionCount}
      </td>
      <td className={`${cellPadding} whitespace-nowrap text-right text-sm font-medium hidden min-[480px]:table-cell sticky right-0 ${density !== 'normal' && index % 2 === 1 ? 'bg-gray-50 dark:bg-table-stripe-dark' : 'bg-white dark:bg-gray-900'} group-hover:bg-gray-100 dark:group-hover:bg-gray-800`}>
        <RowActions actions={actions} density={density} />
      </td>
    </tr>
  );
});

interface TagListProps {
  tags: Tag[];
  transactionCounts?: Record<string, number>;
  onEdit: (tag: Tag) => void;
  onDelete: (tag: Tag) => void;
  onTagClick?: (tag: Tag) => void;
  sortField?: SortField;
  sortDirection?: SortDirection;
  onSort?: (field: SortField) => void;
}

export function TagList({
  tags,
  transactionCounts,
  onEdit,
  onDelete,
  onTagClick,
  sortField: propSortField,
  sortDirection: propSortDirection,
  onSort,
}: TagListProps) {
  const t = useTranslations('tags');
  const tc = useTranslations('common');
  const [actionSheet, setActionSheet] = useState<{ open: boolean; tag: Tag | null }>({ open: false, tag: null });
  const { density } = useDensityPreference('tags');
  const [localSortField, setLocalSortField] = useState<SortField>('name');
  const [localSortDirection, setLocalSortDirection] = useState<SortDirection>('asc');

  const sortField = propSortField ?? localSortField;
  const sortDirection = propSortDirection ?? localSortDirection;

  const { cellPadding, headerPadding } = useTableDensity(density);
  // Model B: on a phone, density picks the LAYOUT rather than only the row
  // height. Below `sm` this table shows the name alone -- Icon, Transactions
  // and Actions all collapse -- so at Normal each tag becomes a wrapped card
  // carrying them back; Compact and Dense keep the tier table, unchanged, and
  // so does every non-phone width. Exactly one branch renders per row.
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
        setLocalSortDirection('asc');
      }
    }
  }, [onSort, localSortField]);

  const handleDeleteClick = useCallback((tag: Tag) => {
    onDelete(tag);
  }, [onDelete]);

  const { getRowHandlers } = useLongPress<Tag>({
    onLongPress: (tag) => setActionSheet({ open: true, tag }),
    onClick: onEdit,
  });

  const sortedTags = useMemo(() => {
    return [...tags].sort((a, b) => {
      let comparison = 0;
      if (sortField === 'name') {
        comparison = a.name.localeCompare(b.name);
      } else if (sortField === 'createdAt') {
        comparison = new Date(a.createdAt).getTime() - new Date(b.createdAt).getTime();
      }
      return sortDirection === 'asc' ? comparison : -comparison;
    });
  }, [tags, sortField, sortDirection]);

  if (tags.length === 0) {
    return (
      <EmptyState
        icon={
          <svg fill="none" viewBox="0 0 24 24" stroke="currentColor">
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M7 7h.01M7 3h5c.512 0 1.024.195 1.414.586l7 7a2 2 0 010 2.828l-7 7a2 2 0 01-2.828 0l-7-7A1.994 1.994 0 013 12V7a4 4 0 014-4z" />
          </svg>
        }
        title={t('list.empty.title')}
        description={t('list.empty.body')}
      />
    );
  }

  return (
    <div>
      {/* Density toggle */}
      <DensityToggleBar view="tags" />
      <div className="overflow-x-auto">
        <table className="min-w-full divide-y divide-gray-200 dark:divide-gray-700">
          {/* On a phone the wrapped card labels its own values, so the column
              header goes -- but the control in that header row must not go with
              it: this `<th>` is how the list is sorted, and the chosen field is
              persisted across sessions. A slim control header carries the same
              sort control as a button, built from the same field list, and no
              column label of its own: the single card cell below holds the
              icon, the name and the count at once, so naming this header after
              any one of them would misdescribe the column to a screen reader.
              The button's own accessible name is the column label, which is
              what a sort control is allowed to be called. */}
          <thead className="bg-gray-50 dark:bg-gray-800">
            {wrapped ? (
            <tr>
              {/* The one column is always sorted by something, and `aria-sort`
                  is the only place that direction is announced -- the arrow in
                  the button's label is a glyph, not a state. */}
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
                      className="text-xs font-medium text-gray-500 dark:text-gray-400 uppercase tracking-wider rounded focus-visible:outline-2 focus-visible:outline-blue-500"
                    >
                      {t(labelKey)}<SortIcon field={field} sortField={sortField} sortDirection={sortDirection} />
                    </button>
                  ))}
                </div>
              </th>
            </tr>
            ) : (
            <tr>
              {SORT_FIELD_LABEL_KEYS.map(({ field, labelKey }) => (
              <th
                key={field}
                className={`${headerPadding} text-left text-xs font-medium text-gray-500 dark:text-gray-400 uppercase tracking-wider cursor-pointer hover:text-gray-700 dark:hover:text-gray-200`}
                onClick={() => handleSort(field)}
              >
                {t(labelKey)}<SortIcon field={field} sortField={sortField} sortDirection={sortDirection} />
              </th>
              ))}
              <th
                className={`${headerPadding} text-left text-xs font-medium text-gray-500 dark:text-gray-400 uppercase tracking-wider hidden sm:table-cell`}
              >
                {t('list.header.icon')}
              </th>
              <th className={`${headerPadding} text-right text-xs font-medium text-gray-500 dark:text-gray-400 uppercase tracking-wider hidden sm:table-cell`}>
                {t('list.header.transactions')}
              </th>
              <th className={`${headerPadding} text-right text-xs font-medium text-gray-500 dark:text-gray-400 uppercase tracking-wider hidden min-[480px]:table-cell sticky right-0 bg-gray-50 dark:bg-gray-800`}>
                {t('list.header.actions')}
              </th>
            </tr>
            )}
          </thead>
          <tbody className="bg-white dark:bg-gray-900 divide-y divide-gray-200 dark:divide-gray-700">
            {sortedTags.map((tag, index) => (
              <TagRow
                key={tag.id}
                tag={tag}
                transactionCount={transactionCounts?.[tag.id] ?? 0}
                density={density}
                cellPadding={cellPadding}
                onEdit={onEdit}
                onDeleteClick={handleDeleteClick}
                onTagClick={onTagClick}
                index={index}
                getRowHandlers={getRowHandlers}
                wrapped={wrapped}
              />
            ))}
          </tbody>
        </table>
      </div>

      <RowActionSheet
        isOpen={actionSheet.open}
        title={actionSheet.tag?.name ?? ''}
        actions={actionSheet.tag
          ? buildTagActions(actionSheet.tag, { edit: tc('actions.edit'), delete: tc('actions.delete') }, { onEdit, onDeleteClick: handleDeleteClick })
          : []}
        onClose={() => setActionSheet({ open: false, tag: null })}
      />
    </div>
  );
}
