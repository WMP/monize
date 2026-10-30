import { ReportsModule } from "@/reports/reports.module";
import { ReportsService } from "@/reports/reports.service";
import {
  CustomReport,
  TimeframeType,
  GroupByType,
  MetricType,
  DirectionFilter,
} from "@/reports/entities/custom-report.entity";
import { exportReport } from "@/accruals/reporting-export";
import { createAccrualTaxonomyFixture } from "../helpers/accrual-taxonomy-fixture";
import { createTestAccount } from "../helpers/test-factories";

describe("bounded custom accrual report (enforced PostgreSQL)", () => {
  jest.setTimeout(180000);
  let f: Awaited<ReturnType<typeof createAccrualTaxonomyFixture>>;
  beforeAll(async () => {
    f = await createAccrualTaxonomyFixture([ReportsModule]);
  });
  beforeEach(async () => f.reset());
  afterAll(async () => f?.close());
  it("withholds complete COUNT totals above the real selection bound and exports its partial status", async () => {
    const { tx } = await f.source();
    await f.accrue(tx.id);
    const account = await createTestAccount(f.h.owner, f.user, {
      name: "Generated bounded fixture",
      openingBalance: 0,
      currentBalance: 0,
    });
    await f.h.owner.query(
      `INSERT INTO transactions(id,user_id,account_id,category_id,transaction_date,amount,currency_code,status,is_transfer,is_split)
      SELECT gen_random_uuid(),$1,$2,$3,'2026-06-15',-1,'USD','UNRECONCILED',false,false FROM generate_series(1,50001)`,
      [f.user, account.id, f.root],
    );
    await f.h.owner.query(
      "UPDATE accounts SET current_balance=-50001 WHERE id=$1",
      [account.id],
    );
    const report = await f.h.owner.getRepository(CustomReport).save({
      userId: f.user,
      name: "Bounded count",
      timeframeType: TimeframeType.CUSTOM,
      groupBy: GroupByType.NONE,
      filters: { accountIds: [account.id] },
      config: {
        metric: MetricType.COUNT,
        direction: DirectionFilter.EXPENSES_ONLY,
        customStartDate: "2026-06-01",
        customEndDate: "2026-06-30",
      },
    });
    const result = await f.as(() =>
      f.h.module
        .get(ReportsService)
        .execute(f.user, report.id, { basis: "accrual" }),
    );
    expect(result).toMatchObject({
      basis: "accrual",
      fxComplete: true,
      dataComplete: false,
      truncated: true,
      rowLimit: 50000,
      summary: { total: null, knownTotal: 50000, count: 50000, average: null },
    });
    expect(result.data).toHaveLength(1);
    expect(exportReport(result)).toMatchObject({
      truncated: true,
      dataComplete: false,
      rowLimit: 50000,
    });
    expect(exportReport(result).csv).toContain("false,true,50000");
  });
});
