import { createAccrualTaxonomyFixture } from "../helpers/accrual-taxonomy-fixture";
import { BudgetsModule } from "@/budgets/budgets.module";
import { Budget } from "@/budgets/entities/budget.entity";
import {
  BudgetCategory,
  CategoryGroup,
} from "@/budgets/entities/budget-category.entity";
import {
  BudgetPeriod,
  PeriodStatus,
} from "@/budgets/entities/budget-period.entity";
import { BudgetPeriodCategory } from "@/budgets/entities/budget-period-category.entity";
import { BudgetTrendReportsService } from "@/budgets/budget-trend-reports.service";
import { BudgetHealthReportsService } from "@/budgets/budget-health-reports.service";
import { withReportingRead } from "@/accruals/reporting-basis";

describe("Accrual budget reporting through real services and enforced RLS", () => {
  jest.setTimeout(180000);
  let f: Awaited<ReturnType<typeof createAccrualTaxonomyFixture>>;
  beforeAll(async () => {
    f = await createAccrualTaxonomyFixture([BudgetsModule]);
  });
  beforeEach(async () => f.reset());
  afterAll(async () => f?.close());

  async function closedBudget() {
    const budget = await f.h.owner.getRepository(Budget).save({
      userId: f.user,
      name: "Recognition",
      periodStart: "2026-06-01",
      currencyCode: "USD",
    });
    const category = await f.h.owner.getRepository(BudgetCategory).save({
      budgetId: budget.id,
      categoryId: f.root,
      amount: 150,
      categoryGroup: CategoryGroup.NEED,
    });
    const period = await f.h.owner.getRepository(BudgetPeriod).save({
      budgetId: budget.id,
      periodStart: "2026-06-01",
      periodEnd: "2026-06-30",
      status: PeriodStatus.CLOSED,
      totalBudgeted: 150,
      actualExpenses: 999,
    });
    await f.h.owner.getRepository(BudgetPeriodCategory).save({
      budgetPeriodId: period.id,
      budgetCategoryId: category.id,
      categoryId: f.root,
      budgetedAmount: 150,
      effectiveBudget: 150,
      actualAmount: 999,
    });
    return budget;
  }

  it("uses stored Cash snapshots when Accrual is selected but no schedule exists", async () => {
    await f.source();
    const budget = await closedBudget();
    const trends = f.h.module.get(BudgetTrendReportsService);
    const result = await f.as(() =>
      withReportingRead(
        f.h.app,
        f.user,
        async () => ({
          overall: await trends.getTrend(f.user, budget.id, 12),
          categories: await trends.getCategoryTrend(f.user, budget.id, 12),
        }),
        "accrual",
      ),
    );
    expect(result.overall[0].actual).toBe(999);
    expect(result.categories[0].data[0].actual).toBe(999);
  });

  it("keeps a closed period's category membership when the current budget changes", async () => {
    const { tx } = await f.source();
    await f.accrue(tx.id);
    const budget = await closedBudget();
    await f.h.owner
      .getRepository(BudgetCategory)
      .update({ budgetId: budget.id }, { categoryId: f.other });
    await f.source({ categoryId: f.other });
    const trends = f.h.module.get(BudgetTrendReportsService);
    const result = await f.as(async () => ({
      overall: await trends.getTrend(f.user, budget.id, 12),
      categories: await trends.getCategoryTrend(f.user, budget.id, 12),
    }));
    expect(result.overall[0].actual).toBe(100);
    expect(result.categories).toHaveLength(1);
    expect(result.categories[0].categoryId).toBe(f.root);
    expect(result.categories[0].data[0].actual).toBe(100);
  });

  it("loads multiple category actuals in a fixed pair of grouped reads", async () => {
    const { tx } = await f.source();
    await f.accrue(tx.id);
    await f.source({ categoryId: f.other });
    const budget = await closedBudget();
    const period = await f.h.owner
      .getRepository(BudgetPeriod)
      .findOneByOrFail({ budgetId: budget.id });
    const category = await f.h.owner.getRepository(BudgetCategory).save({
      budgetId: budget.id,
      categoryId: f.other,
      amount: 150,
      categoryGroup: CategoryGroup.NEED,
    });
    await f.h.owner.getRepository(BudgetPeriodCategory).save({
      budgetPeriodId: period.id,
      budgetCategoryId: category.id,
      categoryId: f.other,
      budgetedAmount: 150,
      effectiveBudget: 150,
      actualAmount: 999,
    });
    const queries = jest.spyOn(f.h.app.logger, "logQuery");
    try {
      const result = await f.as(() =>
        f.h.module
          .get(BudgetTrendReportsService)
          .getCategoryTrend(f.user, budget.id, 12),
      );
      expect(result).toHaveLength(2);
      expect(
        result.find((row) => row.categoryId === f.root)?.data[0].actual,
      ).toBe(100);
      expect(
        result.find((row) => row.categoryId === f.other)?.data[0].actual,
      ).toBe(1200.0001);
      const sums = queries.mock.calls.filter(
        ([sql]) => sql.includes("accrual_reporting_") && sql.includes("SUM("),
      );
      expect(sums).toHaveLength(2);
    } finally {
      queries.mockRestore();
    }
  });

  it("keeps health trend membership from the closed periods after the current category changes", async () => {
    const { tx } = await f.source();
    await f.accrue(tx.id);
    const budget = await closedBudget();
    const category = await f.h.owner
      .getRepository(BudgetCategory)
      .findOneByOrFail({ budgetId: budget.id });
    const july = await f.h.owner.getRepository(BudgetPeriod).save({
      budgetId: budget.id,
      periodStart: "2026-07-01",
      periodEnd: "2026-07-31",
      status: PeriodStatus.CLOSED,
      totalBudgeted: 300,
      actualExpenses: 999,
    });
    await f.h.owner.getRepository(BudgetPeriodCategory).save({
      budgetPeriodId: july.id,
      budgetCategoryId: category.id,
      categoryId: f.root,
      budgetedAmount: 300,
      effectiveBudget: 300,
      actualAmount: 999,
    });
    await f.h.owner
      .getRepository(BudgetCategory)
      .update(category.id, { categoryId: f.other });
    const result = await f.as(() =>
      f.h.module
        .get(BudgetHealthReportsService)
        .getHealthScore(f.user, budget.id),
    );
    // USD100 against150 in June improves to USD100 against300 in July.
    expect(result.breakdown.trendBonus).toBe(5);
  });

  it("closed category/overall trends and health follow fresh recognition while cash retains its closed-period snapshot", async () => {
    const { tx } = await f.source();
    await f.accrue(tx.id);
    const budget = await closedBudget();
    const trends = f.h.module.get(BudgetTrendReportsService),
      health = f.h.module.get(BudgetHealthReportsService);
    const read = () =>
      f.as(async () => ({
        overall: await trends.getTrend(f.user, budget.id, 12),
        categories: await trends.getCategoryTrend(f.user, budget.id, 12),
        health: await health.getHealthScoreHistory(f.user, budget.id, 12),
      }));
    const initial = await read();
    expect(initial.overall[0].actual).toBe(100);
    expect(initial.categories[0].data[0].actual).toBe(100);
    expect(initial.health[0].score).toBe(100);
    const cash = await f.as(() =>
      withReportingRead(
        f.h.app,
        f.user,
        () => trends.getCategoryTrend(f.user, budget.id, 12),
        "cash",
      ),
    );
    expect(cash[0].data[0].actual).toBe(999);
    const patch = { amount: -2400.0001 };
    const preview = await f.as(() =>
      f.accruals.previewSourceEdit(f.user, tx.id, patch),
    );
    await f.as(() =>
      f.transactions.update(f.user, tx.id, {
        ...patch,
        accrualImpactFingerprint: preview.fingerprint!,
      }),
    );
    const edited = await read();
    expect(edited.overall[0].actual).toBe(200);
    expect(edited.categories[0].data[0].actual).toBe(200);
    expect(edited.health[0].score).toBeLessThan(initial.health[0].score);
    const stored = await f.h.owner
      .getRepository(BudgetPeriod)
      .findOneByOrFail({ budgetId: budget.id });
    expect(Number(stored.actualExpenses)).toBe(999);
  });
});
