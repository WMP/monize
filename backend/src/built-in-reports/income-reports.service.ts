import { Injectable } from "@nestjs/common";
import { DataSource } from "typeorm";
import { withScopedDb } from "../common/db/scoped-db";
import { Category } from "../categories/entities/category.entity";
import {
  ReportCurrencyService,
  RawCategoryAggregate,
  RawPeriodAggregate,
  RateMap,
} from "./report-currency.service";
import { roundMoney, sumMoney, toMoneyNumber } from "../common/round.util";
import {
  IncomeBySourceResponse,
  IncomeSourceItem,
  IncomeExpensePeriodItem,
  IncomeExpenseTagBucket,
  IncomeExpenseTagPeriodItem,
  IncomeVsExpensesResponse,
  UNTAGGED_TAG_BUCKET_ID,
} from "./dto";
import {
  bucketStartSql,
  enumerateIncomeExpensePeriods,
  periodKeyForStart,
  weekTruncOffsetDays,
  type IncomeExpenseBucket,
  type WeekStartsOn,
} from "./income-expense-buckets";
import { investmentExclusionSql } from "../common/investment-filter.util";

/**
 * Investment scope is LINKAGE, never account type (INV-REPORT-001, issue #1257):
 * the cash sleeve of an INVESTMENT account holds ordinary money, while the cash
 * leg a trade generated is not spending or income. Both halves of the predicate,
 * and why the account type cannot express either, live in
 * `common/investment-filter.util.ts`.
 */
const INVESTMENT_EXCLUSION = investmentExclusionSql({
  accountAlias: "a",
  transactionAlias: "t",
  splitAlias: "ts",
});

/** The no-splits variant, for a query that never joins `transaction_splits`. */
const INVESTMENT_EXCLUSION_NO_SPLITS = investmentExclusionSql({
  accountAlias: "a",
  transactionAlias: "t",
});

/**
 * The transaction-level half of {@link tagValuesArrayExpr}, for a query that
 * never joins `transaction_splits` -- a whole (non-split) transfer has no
 * split-level tags to union in, and `t.is_transfer = true` rows are never
 * split parents (`transactions/transaction-analytics.service.ts`'s
 * `getTransfersByAccount` reads the same population the same way).
 */
function transactionTagValuesArrayExpr(
  transactionAlias: string,
  keyParam: string,
): string {
  const t = transactionAlias;
  return `(
          SELECT ARRAY_AGG(DISTINCT tv_match.val) FROM (
            SELECT TRIM(SUBSTRING(tv_tg.name FROM POSITION(':' IN tv_tg.name) + 1)) AS val
              FROM transaction_tags tv_tt
              JOIN tags tv_tg ON tv_tg.id = tv_tt.tag_id
             WHERE tv_tt.transaction_id = ${t}.id
               AND POSITION(':' IN tv_tg.name) > 1
               AND LOWER(TRIM(SPLIT_PART(tv_tg.name, ':', 1))) = LOWER(${keyParam})
               AND TRIM(SUBSTRING(tv_tg.name FROM POSITION(':' IN tv_tg.name) + 1)) <> ''
          ) tv_match
        )`;
}

/**
 * The values of a row's own `K:*` tags, for the tag-key breakdown
 * (`docs/specs/report-tag-key-breakdown.md` section 1.1, rule B4).
 *
 * Mirrors the key/value parsing `buildTagKeyFilterClause`
 * (`transactions/tag-key-filter.util.ts`) and `getTransactionBreakdownByTagKey`
 * (`transactions/transaction-analytics.service.ts`) already use -- same
 * `POSITION(':' ...) > 1`, `SPLIT_PART(...,':',1)` key and trimmed-after-colon
 * value -- rewritten for a raw, positionally-parameterized query rather than a
 * TypeORM QueryBuilder's named parameters, which this report already uses and
 * `buildTagKeyFilterClause`'s `:param` binding cannot feed. Reads BOTH
 * `transaction_tags` (the whole transaction's own tags) and
 * `transaction_split_tags` (this split's own tags, when `splitAlias` names a
 * joined split); `UNION` (not `UNION ALL`) de-dupes a value present at both
 * levels so it attributes once (B4, I7). Returns SQL `NULL` when the row
 * carries no `K:*` tag for this key -- the caller decides what NULL means
 * (the reserved untagged bucket for a categorized row, "attributes to
 * nothing" for a transfer leg) rather than this expression choosing for both.
 */
function tagValuesArrayExpr(
  transactionAlias: string,
  splitAlias: string,
  keyParam: string,
): string {
  const t = transactionAlias;
  const s = splitAlias;
  return `(
          SELECT ARRAY_AGG(DISTINCT tv_match.val) FROM (
            SELECT TRIM(SUBSTRING(tv_tg.name FROM POSITION(':' IN tv_tg.name) + 1)) AS val
              FROM transaction_tags tv_tt
              JOIN tags tv_tg ON tv_tg.id = tv_tt.tag_id
             WHERE tv_tt.transaction_id = ${t}.id
               AND POSITION(':' IN tv_tg.name) > 1
               AND LOWER(TRIM(SPLIT_PART(tv_tg.name, ':', 1))) = LOWER(${keyParam})
               AND TRIM(SUBSTRING(tv_tg.name FROM POSITION(':' IN tv_tg.name) + 1)) <> ''
            UNION
            SELECT TRIM(SUBSTRING(tv_stg.name FROM POSITION(':' IN tv_stg.name) + 1)) AS val
              FROM transaction_split_tags tv_tst
              JOIN tags tv_stg ON tv_stg.id = tv_tst.tag_id
             WHERE ${s}.id IS NOT NULL
               AND tv_tst.transaction_split_id = ${s}.id
               AND POSITION(':' IN tv_stg.name) > 1
               AND LOWER(TRIM(SPLIT_PART(tv_stg.name, ':', 1))) = LOWER(${keyParam})
               AND TRIM(SUBSTRING(tv_stg.name FROM POSITION(':' IN tv_stg.name) + 1)) <> ''
          ) tv_match
        )`;
}

interface RawTagValuePeriodAggregate {
  period_start: string;
  currency_code: string;
  value: string | null;
  income: string;
  expenses: string;
}

interface RawTagFlowAggregate {
  period_start: string;
  value: string;
  currency_code: string;
  inflow: string;
  outflow: string;
}

@Injectable()
export class IncomeReportsService {
  constructor(
    private dataSource: DataSource,
    private currencyService: ReportCurrencyService,
  ) {}

  /**
   * `options.accountIds` restricts the window to those accounts, the way every
   * other income query does; absent or empty means all accounts.
   */
  async getIncomeBySource(
    userId: string,
    startDate: string | undefined,
    endDate: string,
    options: { accountIds?: string[] } = {},
  ): Promise<IncomeBySourceResponse> {
    const { accountIds } = options;
    const defaultCurrency =
      await this.currencyService.getDefaultCurrency(userId);
    const rateMap = await this.currencyService.buildRateMap(defaultCurrency);

    let query = `
      SELECT
        COALESCE(ts.category_id, t.category_id) as category_id,
        t.currency_code,
        SUM(COALESCE(ts.amount, t.amount)) as total
      FROM transactions t
      LEFT JOIN transaction_splits ts ON ts.transaction_id = t.id
      LEFT JOIN accounts a ON a.id = t.account_id
      INNER JOIN categories c ON c.id = COALESCE(ts.category_id, t.category_id)
      WHERE t.user_id = $1
        AND t.transaction_date <= $2
        AND c.is_income = true
        AND COALESCE(ts.amount, t.amount) > 0
        AND t.is_transfer = false
        AND (t.status IS NULL OR t.status != 'VOID')
        AND t.parent_transaction_id IS NULL
        AND ${INVESTMENT_EXCLUSION}
        AND (ts.transfer_account_id IS NULL OR ts.id IS NULL)
        AND NOT EXISTS (
          SELECT 1 FROM accounts ax
          WHERE ax.user_id = t.user_id
            AND ax.asset_category_id IS NOT NULL
            AND ax.asset_category_id = COALESCE(ts.category_id, t.category_id)
        )
    `;

    const params: (string | string[] | undefined)[] = [userId, endDate];

    if (startDate) {
      query += ` AND t.transaction_date >= $3`;
      params.push(startDate);
    }

    // An empty array would match nothing, which is not what "no filter" means.
    if (accountIds && accountIds.length > 0) {
      query += ` AND t.account_id = ANY($${params.length + 1}::uuid[])`;
      params.push(accountIds);
    }

    query += ` GROUP BY COALESCE(ts.category_id, t.category_id), t.currency_code`;

    const rawResults: RawCategoryAggregate[] = await withScopedDb(
      this.dataSource,
      (m) => m.query(query, params),
    );

    const categories = await withScopedDb(this.dataSource, (m) =>
      m.getRepository(Category).find({
        where: { userId },
      }),
    );
    const categoryMap = new Map(categories.map((c) => [c.id, c]));

    const categoryTotals = new Map<
      string,
      { total: number; category: Category }
    >();

    for (const row of rawResults) {
      const total = this.currencyService.convertAmount(
        toMoneyNumber(row.total),
        row.currency_code,
        defaultCurrency,
        rateMap,
      );
      const categoryId = row.category_id;
      if (!categoryId) continue;

      const category = categoryMap.get(categoryId);
      if (!category) continue;

      const parentCategory = category.parentId
        ? categoryMap.get(category.parentId)
        : null;
      const displayName = parentCategory
        ? `${parentCategory.name}: ${category.name}`
        : category.name;

      const existing = categoryTotals.get(category.id);
      if (existing) {
        existing.total += total;
      } else {
        categoryTotals.set(category.id, {
          total,
          category: { ...category, name: displayName } as Category,
        });
      }
    }

    const data: IncomeSourceItem[] = Array.from(categoryTotals.entries())
      .map(([id, { total, category }]) => ({
        categoryId: id,
        categoryName: category.name,
        color: category.color || null,
        total: roundMoney(total),
      }))
      .sort((a, b) => b.total - a.total)
      .slice(0, 15);

    const totalIncome = sumMoney(data.map((item) => item.total));

    return {
      data,
      totalIncome: roundMoney(totalIncome),
    };
  }

  /**
   * Income against expenses over a window, bucketed by month or by week.
   *
   * The one answer the Income vs Expenses report and the dashboard widget both
   * draw. The widget used to bucket and classify paged transactions in the
   * browser, and disagreed with this report about the same period: it read no
   * VOID status, applied no asset-category exclusion, kept a split's transfer
   * line, and decided what was an investment from the account TYPE rather than
   * from the row (INV-REPORT-001). Every rule that decides which rows count and
   * which side they fall on therefore lives here, in the query.
   *
   * `options.accountIds` restricts the window; `options.bucket` and
   * `options.weekStartsOn` set how wide a bar is. Both exist because the widget
   * offers them -- a caller that re-buckets the answer is deciding which
   * transaction belongs to which bar, which is half of deciding what the bar
   * says.
   *
   * `options.tagKey` is the opt-in tag-key breakdown
   * (`docs/specs/report-tag-key-breakdown.md`). Absent, this method returns
   * exactly what it always has (I1) -- the code path below never runs and the
   * response carries no `tagKey`/`buckets` fields. Present, the response
   * additionally carries `tagKey` and `buckets`, computed by
   * {@link getTagKeyBuckets} through the very same query, so the top-level
   * fields keep meaning the All bucket regardless.
   */
  async getIncomeVsExpenses(
    userId: string,
    startDate: string | undefined,
    endDate: string,
    options: {
      accountIds?: string[];
      bucket?: IncomeExpenseBucket;
      weekStartsOn?: WeekStartsOn;
      tagKey?: string;
    } = {},
  ): Promise<IncomeVsExpensesResponse> {
    const { accountIds, bucket = "month", weekStartsOn = 1, tagKey } = options;
    const defaultCurrency =
      await this.currencyService.getDefaultCurrency(userId);
    const rateMap = await this.currencyService.buildRateMap(defaultCurrency);

    // The week-start offset is a parameter so the grouping expression stays a
    // constant string: see `weekTruncOffsetDays` for what it shifts. It is bound
    // only when a week bucket actually references it -- PostgreSQL infers a
    // parameter's type from where it appears, so an unused $3 is
    // "could not determine data type of parameter $3" rather than a harmless
    // extra.
    const params: (string | string[] | number | undefined)[] = [
      userId,
      endDate,
    ];
    if (bucket === "week") params.push(weekTruncOffsetDays(weekStartsOn));
    const bucketStart = bucketStartSql(
      bucket,
      "t.transaction_date",
      `$${params.length}`,
    );

    let query = `
      SELECT
        ${bucketStart} as period_start,
        t.currency_code,
        SUM(CASE
          WHEN c.is_income = true THEN COALESCE(ts.amount, t.amount)
          WHEN c.is_income = false THEN 0
          WHEN COALESCE(ts.amount, t.amount) > 0 THEN COALESCE(ts.amount, t.amount)
          ELSE 0
        END) as income,
        SUM(CASE
          WHEN c.is_income = false THEN -1 * COALESCE(ts.amount, t.amount)
          WHEN c.is_income = true THEN 0
          WHEN COALESCE(ts.amount, t.amount) < 0 THEN ABS(COALESCE(ts.amount, t.amount))
          ELSE 0
        END) as expenses
      FROM transactions t
      LEFT JOIN transaction_splits ts ON ts.transaction_id = t.id
      LEFT JOIN categories c ON c.id = COALESCE(ts.category_id, t.category_id)
      LEFT JOIN accounts a ON a.id = t.account_id
      WHERE t.user_id = $1
        AND t.transaction_date <= $2
        AND t.is_transfer = false
        AND (t.status IS NULL OR t.status != 'VOID')
        AND t.parent_transaction_id IS NULL
        AND ${INVESTMENT_EXCLUSION}
        AND (ts.transfer_account_id IS NULL OR ts.id IS NULL)
        AND NOT EXISTS (
          SELECT 1 FROM accounts ax
          WHERE ax.user_id = t.user_id
            AND ax.asset_category_id IS NOT NULL
            AND ax.asset_category_id = COALESCE(ts.category_id, t.category_id)
        )
    `;

    if (startDate) {
      query += ` AND t.transaction_date >= $${params.length + 1}`;
      params.push(startDate);
    }

    // An empty array would match nothing, which is not what "no filter" means.
    if (accountIds && accountIds.length > 0) {
      query += ` AND t.account_id = ANY($${params.length + 1}::uuid[])`;
      params.push(accountIds);
    }

    query += `
      GROUP BY ${bucketStart}, t.currency_code
      ORDER BY period_start
    `;

    const rawResults: RawPeriodAggregate[] = await withScopedDb(
      this.dataSource,
      (m) => m.query(query, params),
    );

    const { data, totals, missingCurrencies, excludedCount } =
      this.summarizePeriodRows(
        rawResults,
        bucket,
        startDate,
        endDate,
        weekStartsOn,
        defaultCurrency,
        rateMap,
      );

    const response: IncomeVsExpensesResponse = {
      data,
      totals,
      currency: defaultCurrency,
      missingCurrencies,
      excludedCount,
    };

    const trimmedTagKey = tagKey?.trim();
    if (!trimmedTagKey) {
      // I1: no tagKey -> exactly today's response, nothing added.
      return response;
    }

    const buckets = await this.getTagKeyBuckets(
      userId,
      startDate,
      endDate,
      { accountIds, bucket, weekStartsOn },
      trimmedTagKey,
      defaultCurrency,
      rateMap,
    );

    return { ...response, tagKey: trimmedTagKey, buckets };
  }

  /**
   * Converts + buckets + reports completeness for a set of
   * (period, currency) income/expense aggregate rows -- the one algorithm
   * `getIncomeVsExpenses` runs for the All figure and, unchanged, for every
   * value bucket of a tag-key breakdown (I4: the same per-currency
   * conversion and completeness path, so one bucket's missing rate never
   * blanks another's).
   */
  private summarizePeriodRows(
    rows: {
      period_start: string;
      currency_code: string;
      income: string;
      expenses: string;
    }[],
    bucket: IncomeExpenseBucket,
    startDate: string | undefined,
    endDate: string,
    weekStartsOn: WeekStartsOn,
    defaultCurrency: string,
    rateMap: RateMap,
    extraPeriodStarts: string[] = [],
  ): {
    data: IncomeExpensePeriodItem[];
    totals: {
      income: number | null;
      expenses: number | null;
      net: number | null;
      knownIncome: number;
      knownExpenses: number;
      knownNet: number;
    };
    missingCurrencies: string[];
    excludedCount: number;
  } {
    const byPeriod = new Map<string, { income: number; expenses: number }>();
    /**
     * Currencies with no rate into the reporting currency, and how many
     * aggregate rows that cost.
     *
     * An excluded row is not a smaller number: the bar it belonged to is
     * missing part of its height and the window's totals are unknowable, so the
     * gap is reported rather than absorbed. `convertAmount` returned the amount
     * UNCONVERTED here, adding foreign units straight into a home-currency bar.
     */
    const missingCurrencies = new Set<string>();
    let excludedCount = 0;

    for (const row of rows) {
      const income = this.currencyService.tryConvertAmount(
        toMoneyNumber(row.income),
        row.currency_code,
        defaultCurrency,
        rateMap,
      );
      const expenses = this.currencyService.tryConvertAmount(
        toMoneyNumber(row.expenses),
        row.currency_code,
        defaultCurrency,
        rateMap,
      );
      // One rate serves both halves of the row, so they fail together.
      if (income === null || expenses === null) {
        missingCurrencies.add(row.currency_code);
        excludedCount += 1;
        continue;
      }
      const key = periodKeyForStart(row.period_start, bucket);
      const existing = byPeriod.get(key);
      if (existing) {
        existing.income += income;
        existing.expenses += expenses;
      } else {
        byPeriod.set(key, { income, expenses });
      }
    }

    // Every bucket in the window, including the empty ones: a week nothing
    // happened in earned and spent zero, which is a bar of height zero rather
    // than a gap the chart closes up. Without a start date there is no window to
    // enumerate, so the answer is the buckets that had rows.
    // `extraPeriodStarts` lets a tag bucket keep a period that only its tagged
    // transfer flows touched, so the per-period flows still sum to the window
    // total when there is no start date to enumerate.
    const extraKeys = extraPeriodStarts.map((start) =>
      periodKeyForStart(start, bucket),
    );
    const periods = startDate
      ? enumerateIncomeExpensePeriods(startDate, endDate, bucket, weekStartsOn)
      : [...new Set([...byPeriod.keys(), ...extraKeys])]
          .sort()
          .map((period) => ({
            period,
            periodStart: bucket === "month" ? `${period}-01` : period,
            periodEnd: bucket === "month" ? `${period}-01` : period,
          }));

    const data: IncomeExpensePeriodItem[] = periods.map((period) => {
      const found = byPeriod.get(period.period) ?? { income: 0, expenses: 0 };
      return {
        ...period,
        income: roundMoney(found.income),
        expenses: roundMoney(found.expenses),
        net: roundMoney(found.income - found.expenses),
      };
    });

    const knownIncome = roundMoney(sumMoney(data.map((item) => item.income)));
    const knownExpenses = roundMoney(
      sumMoney(data.map((item) => item.expenses)),
    );
    const knownNet = roundMoney(sumMoney(data.map((item) => item.net)));
    const complete = excludedCount === 0;

    return {
      data,
      totals: {
        income: complete ? knownIncome : null,
        expenses: complete ? knownExpenses : null,
        net: complete ? knownNet : null,
        knownIncome,
        knownExpenses,
        knownNet,
      },
      missingCurrencies: [...missingCurrencies].sort(),
      excludedCount,
    };
  }

  /**
   * The value buckets of a tag-key breakdown (section 1.1 of the spec): one
   * per discovered value of `tagKey`, plus the reserved untagged bucket
   * ({@link UNTAGGED_TAG_BUCKET_ID}, rule B2). Two extra queries, over the
   * exact same window/account filters as the base query:
   *
   * - The categorized (income/expense) population, additionally joined to the
   *   values of each row's own `K:*` tags ({@link tagValuesArrayExpr}, rule
   *   B4) and fanned out one row per matching value (rule B1) -- a row with no
   *   match falls into the untagged bucket instead of being dropped.
   * - Tagged transfer legs (section 3, INV-REPORT-003): a parent row with
   *   `is_transfer = true` or a split with `transfer_account_id IS NOT NULL`,
   *   fanned out the same way, but an untagged leg matches no value and so is
   *   dropped -- section 3.2's "an untagged transfer appears nowhere".
   *
   * Both keep `investmentExclusionSql` and the VOID exclusion on every branch
   * (I5, I6), and neither ever contributes to `income`/`expenses`/`net` (I2) --
   * transfer legs land only in `taggedInflows`/`taggedOutflows`.
   */
  private async getTagKeyBuckets(
    userId: string,
    startDate: string | undefined,
    endDate: string,
    windowOptions: {
      accountIds?: string[];
      bucket: IncomeExpenseBucket;
      weekStartsOn: WeekStartsOn;
    },
    tagKey: string,
    defaultCurrency: string,
    rateMap: RateMap,
  ): Promise<IncomeExpenseTagBucket[]> {
    const { accountIds, bucket, weekStartsOn } = windowOptions;

    // ---- The categorized population, value-partitioned (B1-B4) ----
    const valueParams: (string | string[] | number)[] = [userId, endDate];
    if (bucket === "week") valueParams.push(weekTruncOffsetDays(weekStartsOn));
    const valueBucketStart = bucketStartSql(
      bucket,
      "t.transaction_date",
      `$${valueParams.length}`,
    );
    valueParams.push(tagKey);
    const valueKeyParam = `$${valueParams.length}`;

    let valueQuery = `
      WITH tagged_base AS (
        SELECT
          ${valueBucketStart} as period_start,
          t.currency_code,
          CASE
            WHEN c.is_income = true THEN COALESCE(ts.amount, t.amount)
            WHEN c.is_income = false THEN 0
            WHEN COALESCE(ts.amount, t.amount) > 0 THEN COALESCE(ts.amount, t.amount)
            ELSE 0
          END as income,
          CASE
            WHEN c.is_income = false THEN -1 * COALESCE(ts.amount, t.amount)
            WHEN c.is_income = true THEN 0
            WHEN COALESCE(ts.amount, t.amount) < 0 THEN ABS(COALESCE(ts.amount, t.amount))
            ELSE 0
          END as expenses,
          ${tagValuesArrayExpr("t", "ts", valueKeyParam)} as tag_values
        FROM transactions t
        LEFT JOIN transaction_splits ts ON ts.transaction_id = t.id
        LEFT JOIN categories c ON c.id = COALESCE(ts.category_id, t.category_id)
        LEFT JOIN accounts a ON a.id = t.account_id
        WHERE t.user_id = $1
          AND t.transaction_date <= $2
          AND t.is_transfer = false
          AND (t.status IS NULL OR t.status != 'VOID')
          AND t.parent_transaction_id IS NULL
          AND ${INVESTMENT_EXCLUSION}
          AND (ts.transfer_account_id IS NULL OR ts.id IS NULL)
          AND NOT EXISTS (
            SELECT 1 FROM accounts ax
            WHERE ax.user_id = t.user_id
              AND ax.asset_category_id IS NOT NULL
              AND ax.asset_category_id = COALESCE(ts.category_id, t.category_id)
          )
    `;

    if (startDate) {
      valueQuery += ` AND t.transaction_date >= $${valueParams.length + 1}`;
      valueParams.push(startDate);
    }
    if (accountIds && accountIds.length > 0) {
      valueQuery += ` AND t.account_id = ANY($${valueParams.length + 1}::uuid[])`;
      valueParams.push(accountIds);
    }

    valueQuery += `
      )
      SELECT
        tb.period_start,
        tb.currency_code,
        tv.value,
        SUM(tb.income) as income,
        SUM(tb.expenses) as expenses
      FROM tagged_base tb
      CROSS JOIN UNNEST(COALESCE(tb.tag_values, ARRAY[NULL]::text[])) AS tv(value)
      GROUP BY tb.period_start, tb.currency_code, tv.value
    `;

    const valueRows: RawTagValuePeriodAggregate[] = await withScopedDb(
      this.dataSource,
      (m) => m.query(valueQuery, valueParams),
    );

    // ---- Tagged transfer flows (section 3, INV-REPORT-003) ----
    //
    // Two separate queries, not one `is_transfer = true OR transfer_account_id
    // IS NOT NULL` predicate over a single splits-joined query: a whole
    // (non-split) transfer and a split transfer leg are never the same row
    // (`transaction-analytics.service.ts`'s `getTransfersByAccount` reads only
    // the first population; splits carry their own transfer flag instead of
    // the parent's), and a query that joins `transaction_splits` is never
    // exempt from the split-aware investment exclusion by merely mentioning
    // `is_transfer = true` (`investment-filter.guard.spec.ts`'s "never exempts
    // a query that joins split rows" -- the regression that slipped through
    // once at `monthly-category-breakdown.service.ts`, re-audit F-GUARD-001).
    // The flows are grouped by the same period start as the value query so a
    // bar can carry its own tagged flows; the week offset is bound only when
    // a week bucket references it (see the base query).
    const wholeFlowParams: (string | string[] | number)[] = [
      userId,
      endDate,
      tagKey,
    ];
    const wholeFlowKeyParam = `$${wholeFlowParams.length}`;
    if (bucket === "week") {
      wholeFlowParams.push(weekTruncOffsetDays(weekStartsOn));
    }
    const wholeFlowBucketStart = bucketStartSql(
      bucket,
      "t.transaction_date",
      `$${wholeFlowParams.length}`,
    );

    let wholeFlowQuery = `
      WITH transfer_rows AS (
        SELECT
          ${wholeFlowBucketStart} as period_start,
          t.currency_code,
          t.amount as leg_amount,
          ${transactionTagValuesArrayExpr("t", wholeFlowKeyParam)} as tag_values
        FROM transactions t
        LEFT JOIN accounts a ON a.id = t.account_id
        WHERE t.user_id = $1
          AND t.transaction_date <= $2
          AND (t.status IS NULL OR t.status != 'VOID')
          AND t.parent_transaction_id IS NULL
          AND ${INVESTMENT_EXCLUSION_NO_SPLITS}
          AND t.is_transfer = true
    `;

    if (startDate) {
      wholeFlowQuery += ` AND t.transaction_date >= $${wholeFlowParams.length + 1}`;
      wholeFlowParams.push(startDate);
    }
    if (accountIds && accountIds.length > 0) {
      wholeFlowQuery += ` AND t.account_id = ANY($${wholeFlowParams.length + 1}::uuid[])`;
      wholeFlowParams.push(accountIds);
    }

    wholeFlowQuery += `
      )
      SELECT
        tr.period_start,
        tv.value,
        tr.currency_code,
        SUM(CASE WHEN tr.leg_amount > 0 THEN tr.leg_amount ELSE 0 END) as inflow,
        SUM(CASE WHEN tr.leg_amount < 0 THEN ABS(tr.leg_amount) ELSE 0 END) as outflow
      FROM transfer_rows tr
      CROSS JOIN UNNEST(tr.tag_values) AS tv(value)
      GROUP BY tr.period_start, tv.value, tr.currency_code
    `;

    const splitFlowParams: (string | string[] | number)[] = [
      userId,
      endDate,
      tagKey,
    ];
    const splitFlowKeyParam = `$${splitFlowParams.length}`;
    if (bucket === "week") {
      splitFlowParams.push(weekTruncOffsetDays(weekStartsOn));
    }
    const splitFlowBucketStart = bucketStartSql(
      bucket,
      "t.transaction_date",
      `$${splitFlowParams.length}`,
    );

    let splitFlowQuery = `
      WITH transfer_rows AS (
        SELECT
          ${splitFlowBucketStart} as period_start,
          t.currency_code,
          ts.amount as leg_amount,
          ${tagValuesArrayExpr("t", "ts", splitFlowKeyParam)} as tag_values
        FROM transactions t
        JOIN transaction_splits ts ON ts.transaction_id = t.id
        LEFT JOIN accounts a ON a.id = t.account_id
        WHERE t.user_id = $1
          AND t.transaction_date <= $2
          AND (t.status IS NULL OR t.status != 'VOID')
          AND t.parent_transaction_id IS NULL
          AND ${INVESTMENT_EXCLUSION}
          AND ts.transfer_account_id IS NOT NULL
    `;

    if (startDate) {
      splitFlowQuery += ` AND t.transaction_date >= $${splitFlowParams.length + 1}`;
      splitFlowParams.push(startDate);
    }
    if (accountIds && accountIds.length > 0) {
      splitFlowQuery += ` AND t.account_id = ANY($${splitFlowParams.length + 1}::uuid[])`;
      splitFlowParams.push(accountIds);
    }

    splitFlowQuery += `
      )
      SELECT
        tr.period_start,
        tv.value,
        tr.currency_code,
        SUM(CASE WHEN tr.leg_amount > 0 THEN tr.leg_amount ELSE 0 END) as inflow,
        SUM(CASE WHEN tr.leg_amount < 0 THEN ABS(tr.leg_amount) ELSE 0 END) as outflow
      FROM transfer_rows tr
      CROSS JOIN UNNEST(tr.tag_values) AS tv(value)
      GROUP BY tr.period_start, tv.value, tr.currency_code
    `;

    const [wholeFlowRows, splitFlowRows]: RawTagFlowAggregate[][] =
      await withScopedDb(this.dataSource, async (m) => [
        await m.query(wholeFlowQuery, wholeFlowParams),
        await m.query(splitFlowQuery, splitFlowParams),
      ]);
    const flowRows = [...wholeFlowRows, ...splitFlowRows];

    // ---- Assemble one bucket per discovered value, plus the untagged bucket ----
    const rowsByValue = new Map<string, RawTagValuePeriodAggregate[]>();
    for (const row of valueRows) {
      const key = row.value ?? UNTAGGED_TAG_BUCKET_ID;
      const list = rowsByValue.get(key);
      if (list) list.push(row);
      else rowsByValue.set(key, [row]);
    }

    const flowsByValue = new Map<string, RawTagFlowAggregate[]>();
    for (const row of flowRows) {
      const list = flowsByValue.get(row.value);
      if (list) list.push(row);
      else flowsByValue.set(row.value, [row]);
    }

    const discoveredValues = new Set<string>();
    for (const key of rowsByValue.keys()) {
      if (key !== UNTAGGED_TAG_BUCKET_ID) discoveredValues.add(key);
    }
    for (const key of flowsByValue.keys()) discoveredValues.add(key);

    const orderedValues = [...discoveredValues].sort((a, b) =>
      a.localeCompare(b),
    );
    orderedValues.push(UNTAGGED_TAG_BUCKET_ID);

    return orderedValues.map((value) =>
      this.buildTagBucket(
        value,
        rowsByValue.get(value) ?? [],
        flowsByValue.get(value) ?? [],
        bucket,
        startDate,
        endDate,
        weekStartsOn,
        defaultCurrency,
        rateMap,
      ),
    );
  }

  /** One value (or the untagged) bucket, assembled from its own rows. */
  private buildTagBucket(
    value: string,
    rows: RawTagValuePeriodAggregate[],
    flowRows: RawTagFlowAggregate[],
    bucket: IncomeExpenseBucket,
    startDate: string | undefined,
    endDate: string,
    weekStartsOn: WeekStartsOn,
    defaultCurrency: string,
    rateMap: RateMap,
  ): IncomeExpenseTagBucket {
    const { data, totals, missingCurrencies, excludedCount } =
      this.summarizePeriodRows(
        rows,
        bucket,
        startDate,
        endDate,
        weekStartsOn,
        defaultCurrency,
        rateMap,
        flowRows.map((row) => row.period_start),
      );

    const missing = new Set(missingCurrencies);
    let flowExcludedCount = 0;
    const flowsByPeriod = new Map<
      string,
      { inflows: number[]; outflows: number[] }
    >();

    for (const row of flowRows) {
      const inflow = this.currencyService.tryConvertAmount(
        toMoneyNumber(row.inflow),
        row.currency_code,
        defaultCurrency,
        rateMap,
      );
      const outflow = this.currencyService.tryConvertAmount(
        toMoneyNumber(row.outflow),
        row.currency_code,
        defaultCurrency,
        rateMap,
      );
      if (inflow === null || outflow === null) {
        missing.add(row.currency_code);
        flowExcludedCount += 1;
        continue;
      }
      const key = periodKeyForStart(row.period_start, bucket);
      const entry = flowsByPeriod.get(key);
      if (entry) {
        entry.inflows.push(inflow);
        entry.outflows.push(outflow);
      } else {
        flowsByPeriod.set(key, { inflows: [inflow], outflows: [outflow] });
      }
    }

    // Every period carries its own flows (zero when nothing happened), and the
    // window figures below are the sum of exactly these, so a bar can never
    // disagree with the total.
    const periodData: IncomeExpenseTagPeriodItem[] = data.map((item) => {
      const flows = flowsByPeriod.get(item.period);
      return {
        ...item,
        taggedInflows: roundMoney(sumMoney(flows?.inflows ?? [])),
        taggedOutflows: roundMoney(sumMoney(flows?.outflows ?? [])),
      };
    });

    const excludedCountTotal = excludedCount + flowExcludedCount;
    // A currency missing only from the tagged-flow figures still leaves this
    // bucket's totals unknowable (I4): the reader learns it at the bucket
    // level, not only on the one figure that happened to hit the gap.
    const totalsComplete = excludedCountTotal === 0;
    const bucketTotals = totalsComplete
      ? totals
      : { ...totals, income: null, expenses: null, net: null };

    return {
      value,
      isUntagged: value === UNTAGGED_TAG_BUCKET_ID,
      data: periodData,
      totals: bucketTotals,
      taggedInflows: roundMoney(
        sumMoney(periodData.map((item) => item.taggedInflows)),
      ),
      taggedOutflows: roundMoney(
        sumMoney(periodData.map((item) => item.taggedOutflows)),
      ),
      missingCurrencies: [...missing].sort(),
      excludedCount: excludedCountTotal,
    };
  }
}
