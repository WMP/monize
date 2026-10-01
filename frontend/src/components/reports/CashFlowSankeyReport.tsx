'use client';

import { useMemo, useRef, useState } from 'react';
import { useTranslations } from 'next-intl';
import { useRouter } from 'next/navigation';
import { ResponsiveContainer, Sankey, Tooltip } from 'recharts';
import { builtInReportsApi } from '@/lib/built-in-reports';
import { accountsApi } from '@/lib/accounts';
import { categoriesApi } from '@/lib/categories';
import { buildCategoryColorMap, type SpecialCategoryFilterId } from '@/lib/categoryUtils';
import { buildTransactionsHref } from '@/lib/transactions-href';
import { chartColors } from '@/lib/chart-colors';
import { exportCsvSections } from '@/lib/csv-export';
import type { ConvertedTotal } from '@/lib/currency-total';
import { useNumberFormat } from '@/hooks/useNumberFormat';
import { useDateFormat } from '@/hooks/useDateFormat';
import { useDateRange } from '@/hooks/useDateRange';
import { useReportData } from '@/hooks/useReportData';
import { useExchangeRates } from '@/hooks/useExchangeRates';
import { useIsMobile } from '@/hooks/useIsMobile';
import { Skeleton } from '@/components/ui/LoadingSkeleton';
import { DateRangeSelector } from '@/components/ui/DateRangeSelector';
import { ChartViewToggle } from '@/components/ui/ChartViewToggle';
import { ChartLegend } from '@/components/ui/ChartLegend';
import { PartialTotal } from '@/components/ui/PartialTotal';
import { EmptyState } from '@/components/ui/EmptyState';
import { SEGMENTED_GROUP_CLASS, segmentClass } from '@/components/ui/segmented-control';
import { CAPTION_CLASS, CellLabel, TABLE_BODY_CLASS, TABLE_CLASS } from '@/components/ui/Table';
import { Card, CARD_CLASS, HOVER_ROW_ON_CARD } from '@/components/ui/Card';
import { INTERACTIVE_ROW_FOCUS_CLASS, activateOnKey } from '@/components/ui/interactive-row';
import { ReportToolbarActions } from '@/components/reports/ReportToolbarActions';
import { ReportAccountMultiSelect } from '@/components/reports/ReportAccountMultiSelect';
import { ReportError } from '@/components/reports/ReportError';
import { ChartTooltip } from '@/components/reports/ChartTooltip';
import { IncompleteDataDetails } from '@/components/reports/IncompleteDataDetails';
import { toRechartsSankey, type SankeyDrawLink, type SankeyDrawNode } from '@/components/reports/sankey-layout';
import type {
  CashFlowSankeyDepth,
  CashFlowSankeyNode,
  CashFlowSankeyResponse,
} from '@/types/built-in-reports';

type SankeyView = 'sankey' | 'table';

const NO_IDS: string[] = [];
const UNCATEGORIZED: SpecialCategoryFilterId = 'uncategorized';
const TRANSFER: SpecialCategoryFilterId = 'transfer';

/** The catalog key of each node that is neither a category nor an account. */
const FIXED_NODE_KEYS: Record<string, string> = {
  hub: 'hub',
  'class:savings': 'classSavings',
  'class:debt': 'classDebt',
  'class:other_accounts': 'classOtherAccounts',
  'inflow:savings': 'inflowSavings',
  'inflow:borrowed': 'inflowBorrowed',
  'inflow:other_accounts': 'inflowOtherAccounts',
  'uncategorized:income': 'uncategorizedIncome',
  'uncategorized:expense': 'uncategorizedExpense',
  'residual:unspent': 'residualUnspent',
  'residual:deficit': 'residualDeficit',
  'account:unlinked': 'unlinkedAccount',
};

/** Which side of the hub a node is on, for the table and the CSV. */
type FlowSide = 'in' | 'out' | 'detail';

function sideOf(node: CashFlowSankeyNode): FlowSide {
  if (node.kind === 'child' || node.kind === 'account') return 'detail';
  if (
    node.kind === 'income' ||
    node.kind === 'inflow' ||
    node.id === 'uncategorized:income' ||
    node.id === 'residual:deficit'
  ) {
    return 'in';
  }
  return 'out';
}

const SIDE_ORDER: Record<FlowSide, number> = { in: 0, out: 1, detail: 2 };

/**
 * Where a node drills down to, or `null` for the hub, the residual and a
 * merged "Other", which are arithmetic rather than rows anyone can list.
 */
export function sankeyNodeHref(
  node: CashFlowSankeyNode,
  response: CashFlowSankeyResponse,
): string | null {
  const range = { startDate: response.startDate, endDate: response.endDate };
  const scope = { ...range, accountIds: response.scopeAccountIds };
  switch (node.kind) {
    case 'income':
    case 'expense':
      return node.categoryId ? buildTransactionsHref({ ...scope, categoryId: node.categoryId }) : null;
    case 'child':
      // "(no subcategory)" is the parent's own rows, and the Transactions
      // filter cannot ask for a category without its descendants, so it
      // would list the whole parent under a node that is only part of it.
      if (!node.categoryId || node.categoryId === node.parentCategoryId) return null;
      return buildTransactionsHref({ ...scope, categoryId: node.categoryId });
    case 'uncategorized':
      return buildTransactionsHref({ ...scope, categoryId: UNCATEGORIZED });
    case 'class':
    case 'inflow':
      return buildTransactionsHref({ ...scope, categoryId: TRANSFER });
    case 'account':
      return node.accountId
        ? buildTransactionsHref({ ...range, accountIds: [node.accountId], categoryId: TRANSFER })
        : null;
    default:
      return null;
  }
}

// The table's phone layout, as the sibling reports write it: the flow's name
// takes line 1, its side and its amount split line 2. From `sm` up each row is
// a table row again.
const ROW_GRID =
  'grid grid-cols-[minmax(0,1fr)_minmax(0,1fr)] items-start gap-x-3 gap-y-1.5 px-4 py-3';
const IDENTITY_CELL =
  'col-start-1 col-span-2 row-start-1 min-w-0 p-0 text-sm sm:table-cell sm:px-4 sm:py-3';
const SIDE_CELL =
  'col-start-1 row-start-2 p-0 text-xs text-gray-600 dark:text-gray-400 sm:table-cell sm:px-4 sm:py-3 sm:text-sm';
const FIGURE_CELL =
  'col-start-2 row-start-2 p-0 text-right text-xs whitespace-nowrap sm:table-cell sm:px-4 sm:py-3 sm:text-sm';
const HEADER_CLASS =
  'px-4 py-3 text-xs font-medium text-gray-500 dark:text-gray-400 uppercase';

interface NodeShapeProps {
  x?: number;
  y?: number;
  width?: number;
  height?: number;
  payload?: SankeyDrawNode;
  colorFor: (node: SankeyDrawNode) => string;
  onSelect: (node: SankeyDrawNode) => void;
  canSelect: (node: SankeyDrawNode) => boolean;
  unknownLabel: string;
}

/**
 * One node: a bar in its colour (hollow when its figure is unknown) and its
 * label beside it, on the side that faces away from the hub.
 */
export function SankeyNodeShape({
  x = 0,
  y = 0,
  width = 0,
  height = 0,
  payload,
  colorFor,
  onSelect,
  canSelect,
  unknownLabel,
}: NodeShapeProps) {
  if (!payload) return null;
  const color = colorFor(payload);
  const selectable = canSelect(payload);
  const labelLeft = payload.column === 'source';
  return (
    // A pointer target only. The diagram is one `role="img"` whose children
    // are presentational, so a focusable link here would be a tab stop no
    // screen reader can name; the legend's buttons and the table's rows are
    // the keyboard and assistive-technology routes to the same drill-down.
    <g
      data-testid={`sankey-node-${payload.id}`}
      data-drillable={selectable ? 'true' : undefined}
      onClick={selectable ? () => onSelect(payload) : undefined}
      className={selectable ? 'cursor-pointer' : undefined}
    >
      <rect
        x={x}
        y={y}
        width={width}
        height={Math.max(height, 1)}
        fill={payload.unknown ? chartColors.surface : color}
        stroke={color}
        strokeDasharray={payload.unknown ? '3 2' : undefined}
      />
      <text
        x={labelLeft ? x - 6 : x + width + 6}
        y={y + height / 2}
        textAnchor={labelLeft ? 'end' : 'start'}
        dominantBaseline="middle"
        fontSize={12}
        fill={chartColors.axis}
      >
        {payload.unknown && payload.node?.kind === 'residual' ? `${payload.name} (${unknownLabel})` : payload.name}
      </text>
    </g>
  );
}

interface LinkShapeProps {
  sourceX?: number;
  targetX?: number;
  sourceY?: number;
  targetY?: number;
  sourceControlX?: number;
  targetControlX?: number;
  linkWidth?: number;
  payload?: { source?: SankeyDrawNode; target?: SankeyDrawNode } & Partial<SankeyDrawLink>;
  colorFor: (node: SankeyDrawNode) => string;
}

/** One link: a band in its source's colour, dashed when only partly known. */
export function SankeyLinkShape({
  sourceX = 0,
  targetX = 0,
  sourceY = 0,
  targetY = 0,
  sourceControlX = 0,
  targetControlX = 0,
  linkWidth = 0,
  payload,
  colorFor,
}: LinkShapeProps) {
  const from = payload?.source?.kind === 'hub' ? payload?.target : payload?.source;
  const color = from ? colorFor(from) : chartColors.neutral;
  return (
    <path
      d={`M${sourceX},${sourceY} C${sourceControlX},${sourceY} ${targetControlX},${targetY} ${targetX},${targetY}`}
      fill="none"
      stroke={color}
      strokeOpacity={0.35}
      strokeWidth={Math.max(linkWidth, 1)}
      strokeDasharray={payload?.incomplete ? '6 4' : payload?.netRefund ? '2 3' : undefined}
    />
  );
}

export function CashFlowSankeyReport() {
  const t = useTranslations('reports');
  const router = useRouter();
  const chartRef = useRef<HTMLDivElement>(null);
  const isMobile = useIsMobile();
  const { formatCurrency, formatCurrencyCompact } = useNumberFormat();
  const { formatDate } = useDateFormat();
  const { defaultCurrency } = useExchangeRates();

  // A phone reads the table; the diagram's columns do not reflow (decision
  // 11). A choice the reader made wins over the default either way.
  const [chosenView, setChosenView] = useState<SankeyView | null>(null);
  const view: SankeyView = chosenView ?? (isMobile ? 'table' : 'sankey');
  const [depth, setDepth] = useState<CashFlowSankeyDepth>(1);
  // `null` until the reader picks: the server's default cash-flow scope, which
  // the picker then shows as the accounts the response says it used.
  const [accountIds, setAccountIds] = useState<string[] | null>(null);
  const { dateRange, setDateRange, startDate, setStartDate, endDate, setEndDate, resolvedRange, isValid } =
    useDateRange({ defaultRange: 'mtd' });
  const { start: rangeStart, end: rangeEnd } = resolvedRange;
  const requestedIds = accountIds ?? NO_IDS;
  const scopeKey = requestedIds.join(',');

  const { data: accounts } = useReportData(() => accountsApi.getAll(), []);
  const { data: categories } = useReportData(() => categoriesApi.getAll(), []);
  const { data: response, isLoading, error, reload } = useReportData(
    () =>
      isValid
        ? builtInReportsApi.getCashFlowSankey({
            startDate: rangeStart || undefined,
            endDate: rangeEnd,
            accountIds: requestedIds,
            depth,
          })
        : Promise.resolve(null),
    [isValid, rangeStart, rangeEnd, scopeKey, depth],
  );

  const categoryColors = useMemo(() => buildCategoryColorMap(categories ?? []), [categories]);

  const labelFor = (node: CashFlowSankeyNode): string => {
    if (node.kind === 'child' && node.categoryId === node.parentCategoryId) {
      return t('sankey.noSubcategory');
    }
    const key = FIXED_NODE_KEYS[node.id];
    return key ? t(`sankey.nodes.${key}`) : node.label;
  };

  const colorOfNode = (node: CashFlowSankeyNode): string => {
    const own = node.categoryId ? (categoryColors.get(node.categoryId) ?? node.color) : node.color;
    switch (node.kind) {
      case 'income':
      case 'expense':
      case 'child':
        return own ?? (sideOf(node) === 'in' ? chartColors.income : chartColors.expense);
      case 'inflow':
        return chartColors.income;
      case 'uncategorized':
        return node.id === 'uncategorized:income' ? chartColors.income : chartColors.expense;
      case 'class':
      case 'account':
      case 'hub':
        return chartColors.primary;
      default:
        return chartColors.neutral;
    }
  };
  const colorOfDrawn = (drawn: SankeyDrawNode): string =>
    drawn.node ? colorOfNode(drawn.node) : chartColors.neutral;

  // The answer, once there is one to draw: nothing in the window is an empty
  // state, not an empty diagram.
  const data = response && response.nodes.length > 0 ? response : null;

  // Drawing only: the merge works on a copy, and nothing below reads a figure
  // from it (SANKEY-005).
  const drawing = data
    ? toRechartsSankey(data, {
        labelFor,
        otherLabel: t('sankey.other'),
        otherColor: chartColors.neutral,
      })
    : null;

  const reportingCurrency = response?.currency ?? defaultCurrency;

  const partOf = (total: number | null, known: number): ConvertedTotal =>
    total !== null
      ? { value: total, missingCurrencies: [], excludedCount: 0 }
      : {
          value: known,
          missingCurrencies: response?.missingCurrencies ?? [],
          excludedCount: response?.excludedCount ?? 0,
        };

  /** A figure, its known part marked partial, or "unknown" when nothing is known. */
  // Full precision wherever a figure is read against another (cards, table,
  // PDF); only the legend, which sits beside the drawing, is compact.
  const figure = (total: number | null, known: number | null) => {
    if (total !== null) return formatCurrency(total);
    if (known === null) return t('sankey.unknown');
    return (
      <PartialTotal total={partOf(total, known)} displayCurrency={reportingCurrency}>
        {formatCurrency(known)}
      </PartialTotal>
    );
  };

  const plain = (total: number | null) =>
    total === null ? t('sankey.unknown') : formatCurrency(total);

  // The residual card names whichever side the window landed on; an unknown
  // residual is captioned as the unspent one, with no figure.
  const residual =
    data && data.totals.deficit !== null && data.totals.deficit > 0
      ? { label: t('sankey.nodes.residualDeficit'), total: data.totals.deficit }
      : { label: t('sankey.nodes.residualUnspent'), total: data?.totals.unspent ?? null };

  // Every card reads the server's totals, never the drawing (SANKEY-005).
  const cards = data
    ? [
        { key: 'income', label: t('sankey.cardIncome'), total: data.totals.income, known: data.knownTotals.income },
        { key: 'inflows', label: t('sankey.cardInflows'), total: data.totals.inflows, known: data.knownTotals.inflows },
        { key: 'expenses', label: t('sankey.cardExpenses'), total: data.totals.expenses, known: data.knownTotals.expenses },
        { key: 'outflows', label: t('sankey.cardOutflows'), total: data.totals.outflows, known: data.knownTotals.outflows },
        { key: 'residual', label: residual.label, total: residual.total, known: null },
      ]
    : [];

  const ariaLabel = data
    ? t('sankey.ariaLabel', {
        income: plain(data.totals.income),
        inflows: plain(data.totals.inflows),
        expenses: plain(data.totals.expenses),
        outflows: plain(data.totals.outflows),
        residualLabel: residual.label,
        residual: plain(residual.total),
      })
    : '';

  // Every node but the hub, unmerged, in the server's order within each side.
  const tableRows = useMemo(() => {
    if (!data) return [];
    const byId = new Map(data.nodes.map((n) => [n.id, n]));
    const parentOf = new Map<string, string>();
    for (const link of data.links) {
      const target = byId.get(link.target);
      const source = byId.get(link.source);
      if (target && (target.kind === 'child' || target.kind === 'account')) parentOf.set(target.id, link.source);
      if (source && source.kind === 'child') parentOf.set(source.id, link.target);
    }
    return data.nodes
      .filter((node) => node.kind !== 'hub')
      .map((node, order) => ({ node, order, side: sideOf(node), parent: byId.get(parentOf.get(node.id) ?? '') }))
      .sort((a, b) => SIDE_ORDER[a.side] - SIDE_ORDER[b.side] || a.order - b.order);
  }, [data]);

  const sideLabel = (side: FlowSide, parent?: CashFlowSankeyNode) =>
    side === 'in'
      ? t('sankey.sideIn')
      : side === 'out'
        ? t('sankey.sideOut')
        : t('sankey.sideDetail', { parent: parent ? labelFor(parent) : '' });

  const open = (node: CashFlowSankeyNode) => {
    if (!data) return;
    const href = sankeyNodeHref(node, data);
    if (href) router.push(href);
  };

  const rangeLabel = response
    ? t('sankey.range', { start: formatDate(response.startDate), end: formatDate(response.endDate) })
    : '';

  const handleExportPdf = async () => {
    if (!data) return;
    const { exportToPdf } = await import('@/lib/pdf-export');
    await exportToPdf({
      title: t('sankey.pdfTitle'),
      subtitle: rangeLabel,
      summaryCards: cards.map((card) => ({
        label: card.label,
        value: card.total !== null ? formatCurrency(card.total) : card.known !== null ? `${formatCurrency(card.known)}*` : t('sankey.unknown'),
      })),
      chartContainer: view === 'sankey' ? chartRef.current : null,
      tableData: {
        headers: [t('sankey.colFlow'), t('sankey.colSide'), t('sankey.colAmount')],
        rows: tableRows.map((row) => [labelFor(row.node), sideLabel(row.side, row.parent), plain(row.node.total)]),
      },
      filename: 'cash-flow-sankey',
    });
  };

  const handleExportCsv = () => {
    if (!data) return;
    const name = (id: string) => {
      const node = data.nodes.find((n) => n.id === id);
      return node ? labelFor(node) : id;
    };
    exportCsvSections('cash-flow-sankey', [
      {
        title: t('sankey.csvNodes'),
        headers: [
          t('sankey.colFlow'),
          t('sankey.colSide'),
          t('sankey.csvTotal'),
          t('sankey.csvKnownTotal'),
        ],
        rows: tableRows.map((row) => [labelFor(row.node), sideLabel(row.side, row.parent), row.node.total, row.node.knownTotal]),
      },
      {
        title: t('sankey.csvLinks'),
        headers: [
          t('sankey.csvSource'),
          t('sankey.csvTarget'),
          t('sankey.csvTotal'),
          t('sankey.csvKnownTotal'),
        ],
        rows: data.links.map((link) => [name(link.source), name(link.target), link.amount, link.knownAmount]),
      },
    ]);
  };

  const incomplete = data && (data.missingCurrencies.length > 0 || data.excludedCount > 0) ? data : null;

  const tooltip = ({ active, payload }: { active?: boolean; payload?: ReadonlyArray<{ payload?: unknown }> }) => {
    const item = payload?.[0]?.payload as
      | (SankeyDrawNode & { source?: undefined })
      | {
          source: SankeyDrawNode;
          target: SankeyDrawNode;
          value: number;
          incomplete: boolean;
          netRefund?: boolean;
          placeholder?: boolean;
        }
      | undefined;
    if (!active || !item) return null;
    if (item.source) {
      return (
        <ChartTooltip
          active
          label={t('sankey.linkLabel', { source: item.source.name, target: item.target.name })}
          payload={[{ name: t('sankey.colAmount'), value: item.value, color: colorOfDrawn(item.source.kind === 'hub' ? item.target : item.source) }]}
          // A sliver drawn for a link nothing of which converted is not a figure.
          formatValue={(value) => (item.placeholder ? t('sankey.unknown') : formatCurrency(value))}
        >
          {item.netRefund && <p className="text-xs text-gray-600 dark:text-gray-400">{t('sankey.netRefund')}</p>}
          {item.incomplete && <p className="text-xs text-amber-600 dark:text-amber-400">{t('sankey.knownPartOnly')}</p>}
        </ChartTooltip>
      );
    }
    const drawn = item as SankeyDrawNode;
    return (
      <ChartTooltip
        active
        label={drawn.name}
        payload={[{ name: t('sankey.colAmount'), value: drawn.value, color: colorOfDrawn(drawn) }]}
        formatValue={(value) => formatCurrency(value)}
      >
        {drawn.unknown && <p className="text-xs text-amber-600 dark:text-amber-400">{t('sankey.knownPartOnly')}</p>}
        {drawn.members.length > 0 && (
          <ul className="mt-1 text-xs text-gray-600 dark:text-gray-400">
            {drawn.members.map((member) => (
              <li key={member}>{member}</li>
            ))}
          </ul>
        )}
      </ChartTooltip>
    );
  };

  return (
    <div className="space-y-6">
      {/* Controls stay mounted across a reload so a date being typed keeps focus. */}
      <Card className="p-4">
        <div className="flex flex-wrap gap-4 items-stretch justify-between">
          <DateRangeSelector
            ranges={['mtd', '1m', '3m', '6m', 'ytd', '1y']}
            value={dateRange}
            onChange={setDateRange}
            showCustom
            customStartDate={startDate}
            onCustomStartDateChange={setStartDate}
            customEndDate={endDate}
            onCustomEndDateChange={setEndDate}
          />
          <ReportAccountMultiSelect
            accounts={accounts ?? []}
            value={accountIds ?? response?.scopeAccountIds ?? NO_IDS}
            // Clearing every account asks for the default scope again, which
            // the picker then shows rather than an empty "all accounts".
            onChange={(ids) => setAccountIds(ids.length > 0 ? ids : null)}
            className="w-full sm:w-56"
          />
          <div className={`${SEGMENTED_GROUP_CLASS} self-center`} role="group" aria-label={t('sankey.depthLabel')}>
            <button type="button" aria-pressed={depth === 1} className={segmentClass(depth === 1)} onClick={() => setDepth(1)}>
              {t('sankey.depthCategories')}
            </button>
            <button type="button" aria-pressed={depth === 2} className={segmentClass(depth === 2)} onClick={() => setDepth(2)}>
              {t('sankey.depthSubcategories')}
            </button>
          </div>
          <ChartViewToggle
            value={view}
            onChange={(v) => setChosenView(v as SankeyView)}
            options={['sankey', 'table']}
            className="self-center"
          />
          <ReportToolbarActions onExportPdf={handleExportPdf} onExportCsv={handleExportCsv} disabled={!data} />
        </div>
        <p className="mt-3 text-xs text-gray-500 dark:text-gray-400">{t('sankey.help')}</p>
      </Card>

      {data && (
        <div className="grid grid-cols-2 md:grid-cols-5 gap-2 sm:gap-4">
          {cards.map((card) => (
            <Card key={card.key} padding="sm" data-testid={`sankey-card-${card.key}`}>
              <div className="text-xs sm:text-sm text-gray-500 dark:text-gray-400">{card.label}</div>
              <div className="mt-1 text-lg sm:text-xl font-semibold text-gray-900 dark:text-gray-100">
                {figure(card.total, card.known)}
              </div>
            </Card>
          ))}
        </div>
      )}

      {incomplete && (
        <div className="space-y-2">
          {/* The banner names each pair and the window it was needed for; the
              count says how much of the ledger that cost. */}
          <IncompleteDataDetails
            causes={{
              prices: [],
              rates: incomplete.missingCurrencies.map((code) => ({
                key: `${code}->${incomplete.currency}`,
                start: incomplete.startDate,
                end: incomplete.endDate,
              })),
              cash: [],
            }}
            securityLabel={(id) => id}
            accountLabel={(id) => id}
          />
          <p className="text-sm text-amber-900 dark:text-amber-200" data-testid="sankey-excluded-count">
            {t('sankey.excludedCount', { count: incomplete.excludedCount })}
          </p>
        </div>
      )}

      <div ref={chartRef} className={`${CARD_CLASS} px-2 py-4 sm:p-6`}>
        {error ? (
          <ReportError onRetry={reload} />
        ) : isLoading ? (
          <div className="space-y-4">
            <Skeleton className="h-8 w-1/3" />
            <Skeleton className="h-64 w-full" />
          </div>
        ) : !data ? (
          <EmptyState
            title={t('sankey.noData')}
            description={rangeLabel || undefined}
          />
        ) : view === 'sankey' && drawing ? (
          <>
            <div role="img" aria-label={ariaLabel} className="h-[32rem]">
              <ResponsiveContainer width="100%" height="100%" minWidth={0}>
                <Sankey
                  data={drawing}
                  nodePadding={16}
                  nodeWidth={12}
                  margin={{ top: 10, right: 160, bottom: 10, left: 160 }}
                  node={(props: object) => (
                    <SankeyNodeShape
                      {...(props as Omit<NodeShapeProps, 'colorFor' | 'onSelect' | 'canSelect' | 'unknownLabel'>)}
                      colorFor={colorOfDrawn}
                      onSelect={(drawn) => drawn.node && open(drawn.node)}
                      canSelect={(drawn) => !!drawn.node && sankeyNodeHref(drawn.node, data) !== null}
                      unknownLabel={t('sankey.unknown')}
                    />
                  )}
                  link={(props: object) => (
                    <SankeyLinkShape
                      {...(props as Omit<LinkShapeProps, 'colorFor'>)}
                      colorFor={colorOfDrawn}
                    />
                  )}
                >
                  <Tooltip content={tooltip} />
                </Sankey>
              </ResponsiveContainer>
            </div>
            <ChartLegend
              className="mt-6"
              phoneColumns={2}
              columnsClassName="sm:grid-cols-2 md:grid-cols-3 lg:grid-cols-4"
              items={tableRows
                .filter((row) => row.side !== 'detail')
                .map((row) => ({
                  key: row.node.id,
                  name: labelFor(row.node),
                  color: colorOfNode(row.node),
                  detail: row.node.total === null ? t('sankey.unknown') : formatCurrencyCompact(row.node.total),
                  onClick: () => open(row.node),
                  disabled: sankeyNodeHref(row.node, data) === null,
                }))}
            />
          </>
        ) : (
          <div className="overflow-x-auto">
            {/* The table twin is the screen-reader rendering of the diagram,
                and the full answer: every node, unmerged. Explicit roles put
                back the semantics the phone layout's `display` strips. */}
            <table role="table" className={`${TABLE_CLASS} block sm:table`}>
              <thead role="rowgroup" className="hidden bg-gray-50 dark:bg-gray-900/50 sm:table-header-group">
                <tr role="row">
                  <th role="columnheader" className={`${HEADER_CLASS} text-left`}>{t('sankey.colFlow')}</th>
                  <th role="columnheader" className={`${HEADER_CLASS} text-left`}>{t('sankey.colSide')}</th>
                  <th role="columnheader" className={`${HEADER_CLASS} text-right`}>{t('sankey.colAmount')}</th>
                </tr>
              </thead>
              <tbody role="rowgroup" className={`${TABLE_BODY_CLASS} block sm:table-row-group`}>
                {tableRows.map(({ node, side, parent }) => {
                  const href = sankeyNodeHref(node, data);
                  return (
                    <tr
                      key={node.id}
                      role="row"
                      tabIndex={href ? 0 : undefined}
                      className={`${ROW_GRID} ${href ? `cursor-pointer ${INTERACTIVE_ROW_FOCUS_CLASS}` : ''} ${HOVER_ROW_ON_CARD} sm:table-row sm:p-0`}
                      onClick={href ? () => router.push(href) : undefined}
                      onKeyDown={href ? activateOnKey(() => router.push(href)) : undefined}
                      data-testid={`sankey-row-${node.id}`}
                    >
                      <td role="cell" className={`${IDENTITY_CELL} font-medium text-gray-900 dark:text-gray-100`}>
                        <div className={`flex items-center gap-2 ${side === 'detail' ? 'sm:pl-4' : ''}`}>
                          <div className="w-3 h-3 rounded-full flex-shrink-0" style={{ backgroundColor: colorOfNode(node) }} />
                          <span className="min-w-0 break-words sm:break-normal">{labelFor(node)}</span>
                        </div>
                      </td>
                      <td role="cell" className={SIDE_CELL}>
                        <CellLabel className={CAPTION_CLASS}>{t('sankey.colSide')}</CellLabel>
                        {sideLabel(side, parent)}
                      </td>
                      <td role="cell" className={`${FIGURE_CELL} text-gray-900 dark:text-gray-100`}>
                        <CellLabel className={CAPTION_CLASS}>{t('sankey.colAmount')}</CellLabel>
                        {figure(node.total, node.kind === 'residual' ? null : node.knownTotal)}
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        )}
      </div>
    </div>
  );
}
