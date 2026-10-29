import { TransactionsController } from "@/transactions/transactions.controller";
import { BudgetsModule } from "@/budgets/budgets.module";
import { from, lastValueFrom } from "rxjs";
import type { ExecutionContext } from "@nestjs/common";
import { ReportingBasisInterceptor } from "@/accruals/reporting-basis.interceptor";
import { BudgetsController } from "@/budgets/budgets.controller";
import { BudgetsService } from "@/budgets/budgets.service";
import { BudgetReportsService } from "@/budgets/budget-reports.service";
import { Budget } from "@/budgets/entities/budget.entity";
import { BudgetCategory } from "@/budgets/entities/budget-category.entity";
import { createTestAccount } from "../helpers/test-factories";
import { createAccrualTaxonomyFixture } from "../helpers/accrual-taxonomy-fixture";

describe("partial accrual budget boundary (enforced PostgreSQL)", () => {
  jest.setTimeout(180000);
  let f: Awaited<ReturnType<typeof createAccrualTaxonomyFixture>>;
  beforeAll(async () => {
    f = await createAccrualTaxonomyFixture([BudgetsModule]);
  });
  beforeEach(async () => f.reset());
  afterAll(async () => f?.close());
  it("withholds derived controller/LLM results, preserves known components and recovers after a dated rate is repaired", async () => {
    const [clock] = await f.h.owner.query(
      "SELECT to_char(date_trunc('month',CURRENT_DATE),'YYYY-MM-DD') AS first,to_char((date_trunc('month',CURRENT_DATE)+interval '1 month - 1 day')::date,'YYYY-MM-DD') AS last",
    );
    await f.h.owner.query(
      "INSERT INTO currencies(code,name,symbol,decimal_places) VALUES('EUR','Euro','E',2) ON CONFLICT DO NOTHING",
    );
    await f.h.owner.query(
      "UPDATE user_preferences SET reporting_basis='accrual',default_currency='EUR' WHERE user_id=$1",
      [f.user],
    );
    await f.h.owner.query(
      "DELETE FROM exchange_rates WHERE from_currency IN ('USD','EUR') AND to_currency IN ('USD','EUR')",
    );
    const tx = await f.as(() =>
      f.transactions.create(f.user, {
        accountId: f.account,
        currencyCode: "USD",
        transactionDate: clock.first,
        amount: -1200,
        categoryId: f.root,
      }),
    );
    await f.accrue(tx.id);
    const euro = await createTestAccount(f.h.owner, f.user, {
      name: "Known budget EUR",
      currencyCode: "EUR",
    });
    await f.as(() =>
      f.transactions.create(f.user, {
        accountId: euro.id,
        currencyCode: "EUR",
        transactionDate: clock.first,
        amount: -80,
        categoryId: f.root,
      }),
    );
    const budget = await f.h.owner.getRepository(Budget).save({
      userId: f.user,
      name: "Partial budget",
      currencyCode: "EUR",
      periodStart: clock.first,
    });
    await f.h.owner
      .getRepository(BudgetCategory)
      .save({ budgetId: budget.id, categoryId: f.root, amount: 500 });
    const bank = await f.bank();
    const controller = f.h.module.get(BudgetsController);
    const interceptor = new ReportingBasisInterceptor(f.h.app);
    const read = () =>
      f.as(() => {
        const headers = jest.fn();
        const request = { user: { id: f.user }, query: { basis: "accrual" } };
        const context = {
          getHandler: () => BudgetsController.prototype.getSummary,
          switchToHttp: () => ({
            getRequest: () => request,
            getResponse: () => ({ setHeader: headers }),
          }),
        } as unknown as ExecutionContext;
        return lastValueFrom(
          interceptor.intercept(context, {
            handle: () => from(controller.getSummary(request, budget.id)),
          }),
        );
      });
    const monthlyController = f.h.module.get(TransactionsController);
    const readMonthly = () =>
      f.as(() => {
        const request = { user: { id: f.user }, query: { basis: "accrual" } };
        const context = {
          getHandler: () => TransactionsController.prototype.getMonthlyTotals,
          switchToHttp: () => ({
            getRequest: () => request,
            getResponse: () => ({ setHeader: jest.fn() }),
          }),
        } as unknown as ExecutionContext;
        return lastValueFrom(
          interceptor.intercept(context, {
            handle: () =>
              from(
                monthlyController.getMonthlyTotals(
                  request,
                  undefined,
                  clock.first,
                  clock.last,
                ),
              ),
          }),
        );
      });
    const monthly = await readMonthly();
    expect(monthly).toMatchObject({
      fxComplete: false,
      result: null,
      total: null,
      currency: "EUR",
    });
    expect(monthly.knownComponents).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ knownSubtotal: -80, currency: "EUR" }),
      ]),
    );
    expect(monthly.missingRatePairs).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ from: "USD", to: "EUR", date: clock.last }),
      ]),
    );
    const result = await read();
    expect(result).toMatchObject({
      basis: "accrual",
      fxComplete: false,
      total: null,
      result: null,
      currency: "EUR",
      repair: "currency_rate_history",
      fetchAttempted: false,
    });
    expect(result.knownComponents).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          knownSubtotal: -80,
          currency: "EUR",
          date: clock.first,
        }),
      ]),
    );
    expect(result.missingRatePairs).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ from: "USD", to: "EUR", date: clock.last }),
      ]),
    );
    expect(result).not.toHaveProperty("totalSpent");
    expect(result).not.toHaveProperty("healthScore");
    const llm = await f.as(() =>
      f.h.module
        .get(BudgetReportsService)
        .getLlmBudgetStatus(f.user, "CURRENT", undefined, "accrual"),
    );
    expect(llm).toMatchObject({ result: null, fxComplete: false });
    await expect(
      f.as(() => f.h.module.get(BudgetsService).getSummary(f.user, budget.id)),
    ).rejects.toMatchObject({ response: { code: "REPORTING_FX_INCOMPLETE" } });
    // The accrued component's recognition date (clock.last, the month end) is
    // still in the future relative to today while the period is open: the
    // resolver clamps a future "as of" date down to today before it looks for
    // a rate (never one struck after the date it prices, INV-FX-002), so the
    // repair observation has to land on or before today, not on the future
    // bucket date itself -- a rate dated `clock.last` would remain unusable
    // until that calendar day actually arrives.
    await f.h.owner.query(
      "INSERT INTO exchange_rates(from_currency,to_currency,rate,rate_date) VALUES('USD','EUR',0.8,CURRENT_DATE)",
    );
    expect(await read()).toMatchObject({ totalSpent: 160 });
    expect(await readMonthly()).toEqual([
      { month: clock.first.slice(0, 7), total: -160, count: 2 },
    ]);
    expect(await f.bank()).toBe(bank);
  });
});
