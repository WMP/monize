import { requestContextStorage } from "../common/request-context";
import type { EntityManager, ObjectLiteral, SelectQueryBuilder } from "typeorm";
import { reportingQuery, reportingEntities } from "./reporting-query";
import { reportingSql } from "./reporting-relations";
import { projectRecognitionRow } from "./reporting-entity-reader";

function manager(enabled = true, scheduled = true) {
  return {
    getRepository: () => ({
      findOne: async () => ({
        accrualEnabled: enabled,
        reportingBasis: "accrual",
      }),
    }),
    query: jest.fn(async (sql: string) =>
      sql.startsWith("SELECT EXISTS")
        ? [{ present: scheduled }]
        : [{ value: 1 }],
    ),
  } as unknown as EntityManager;
}
describe("explicit recognition reader boundaries", () => {
  it.each(["notifications", "accounts"])(
    "leaves %s entities on their ordinary read path",
    async (tableName) => {
      const getMany = jest.fn().mockResolvedValue([{ id: "source" }]);
      const qb = {
        expressionMap: {
          mainAlias: { hasMetadata: true, metadata: { tableName } },
        },
        getMany,
      } as unknown as SelectQueryBuilder<ObjectLiteral>;
      const m = manager();
      expect(
        await reportingEntities(m, "owner", qb, { basis: "accrual" }),
      ).toEqual([{ id: "source" }]);
      expect(m.query).not.toHaveBeenCalled();
    },
  );
  it.each([false, true])(
    "uses native cash relations without schedules or when disabled (%s)",
    async (enabled) => {
      const m = manager(enabled, false);
      await reportingQuery(
        m,
        "owner",
        "SELECT t.id FROM transactions t WHERE t.amount=$1",
        [7],
        "accrual",
      );
      const [sql, params] = (m.query as jest.Mock).mock.calls.slice(-1)[0];
      expect(sql).toBe("SELECT t.id FROM transactions t WHERE t.amount=$1");
      expect(sql).not.toContain("accrual_reporting_transactions");
      expect(sql).not.toContain("__owned");
      expect(params).toEqual([7]);
    },
  );
  it("does not add an unused binding to unrelated SQL", async () => {
    const m = manager();
    await reportingQuery(m, "owner", "SELECT $1", [7], "cash");
    expect(m.query).toHaveBeenLastCalledWith("SELECT $1", [7]);
  });
  it("preserves SQL literals, comments, aliases and existing CTEs", () => {
    const sql =
      "WITH existing AS (SELECT 'FROM transactions' AS note) SELECT t.id FROM public.transactions AS t JOIN transaction_splits s ON s.transaction_id=t.id -- JOIN transactions\n WHERE t.amount=$1";
    const rendered = reportingSql(sql, "accrual", "$2");
    expect(rendered).toContain("'FROM transactions'");
    expect(rendered).toContain("-- JOIN transactions\n");
    expect(rendered).toContain("public.accrual_reporting_transactions __owned");
    expect(rendered).toContain(") AS t JOIN (SELECT");
    expect(rendered).toContain("WHERE t.amount=$1");
    expect(rendered).not.toContain("jsonb_populate_record");
    expect(rendered.match(/WITH/g)).toHaveLength(1);
  });
  it("keeps unaliased relation references valid", () => {
    expect(
      reportingSql(
        "SELECT transactions.id FROM transactions WHERE amount<0",
        "accrual",
        "$1",
      ),
    ).toContain(') "transactions" WHERE');
  });
  it("preserves an unaliased qualifier without an owner wrapper", () => {
    expect(
      reportingSql("SELECT transactions.amount FROM transactions", "accrual"),
    ).toBe(
      'SELECT transactions.amount FROM public.accrual_reporting_transactions "transactions"',
    );
  });
  it("does not redirect a CTE that shadows a ledger relation", () => {
    const sql =
      "WITH transactions AS (SELECT 1 AS amount) SELECT amount FROM transactions";
    expect(reportingSql(sql, "accrual", "$1")).toBe(sql);
  });
  it("maps a physical table inside a nonrecursive same-name CTE but preserves its consumers", () => {
    const sql = reportingSql(
      "WITH transactions AS (SELECT amount FROM public.transactions), totals AS (SELECT amount FROM transactions) SELECT * FROM transactions",
      "accrual",
      "$1",
    );
    expect(sql.match(/public.accrual_reporting_transactions/g)).toHaveLength(1);
    expect(sql).toContain("totals AS (SELECT amount FROM transactions)");
    expect(sql.endsWith("SELECT * FROM transactions")).toBe(true);
  });
  it("keeps USING as join syntax rather than an alias", () => {
    expect(
      reportingSql(
        "SELECT * FROM transactions JOIN transaction_splits USING (id)",
        "accrual",
        "$1",
      ),
    ).toContain(') "transaction_splits" USING (id)');
  });
  it("does not interpret DISTINCT FROM as a relation declaration", () => {
    const sql = reportingSql(
      "SELECT t.id FROM transactions t WHERE t.amount IS DISTINCT FROM transactions.amount",
      "accrual",
      "$1",
    );
    expect(sql).toContain("IS DISTINCT FROM transactions.amount");
    expect(sql.match(/__owned.user_id/g)).toHaveLength(1);
  });
  it("normalizes schema-qualified column references when a mapped relation needs an alias", () => {
    expect(
      reportingSql(
        "SELECT public.transactions.amount FROM public.transactions",
        "accrual",
        "$1",
      ),
    ).toMatch(/^SELECT "transactions".amount FROM/);
  });

  it.each([false, true])(
    "projects source-linked recognition copies without mutating cash entities (%s)",
    (preserve) => {
      const source = {
        id: "source",
        amount: "1200",
        transactionDate: "2026-10-15",
        splits: [{ id: "split", amount: "1200" }],
        linkedTransaction: { id: "cash-linked" },
        investmentTransaction: {
          transactionId: "source",
          transactionSplitId: "split",
        },
      };
      const fact = {
        id: "recognition",
        sourceId: "source",
        amount: "100",
        sourceAmount: "1200",
        cashDate: "2026-10-15",
        effectiveDate: "2026-11-30",
        isRecognition: true,
      };
      const split = {
        id: "recognition-split",
        sourceId: "split",
        amount: "100",
        sourceAmount: "1200",
        cashDate: "2026-10-15",
        scheduleId: "schedule",
      };
      const result = projectRecognitionRow(source, fact, [split], preserve);
      expect(result.id).toBe(preserve ? "recognition" : "source");
      expect(result.transactionDate).toBe("2026-11-30");
      expect(result.amount).toBe("100");
      expect(result.reportingProvenance).toMatchObject({
        sourceTransactionId: "source",
        readOnly: true,
        sourceAmount: "1200",
      });
      expect(result.splits[0].reportingProvenance).toMatchObject({
        sourceSplitId: "split",
        scheduleId: "schedule",
      });
      expect(result.linkedTransaction.id).toBe("cash-linked");
      expect(result.investmentTransaction).toEqual(
        source.investmentTransaction,
      );
      expect(source.amount).toBe("1200");
      expect(source.splits[0].amount).toBe("1200");
      expect(result).not.toBe(source);
      expect(result.splits[0]).not.toBe(source.splits[0]);
    },
  );
});

it("scopes indirect recognition relations by their owner without recursively joining the ledger", () => {
  const sql = reportingSql(
    "SELECT s.amount FROM transaction_splits s JOIN transaction_split_tags tags ON tags.transaction_split_id=s.id",
    "accrual",
    "$1",
  );
  expect(sql.match(/__owned.reporting_user_id=\$1/g)).toHaveLength(2);
  expect(sql).not.toContain("__owner");
});

it("retains original Cash SQL and params while refusing a conflicting effective owner", async () => {
  const m = manager(false, false);
  const sql =
    "WITH transactions AS (SELECT $1::text AS value) SELECT * FROM transactions";
  const params = ["native"];
  await requestContextStorage.run(
    { userId: "owner", realUserId: "delegate" },
    async () => {
      await reportingQuery(m, "owner", sql, params, "cash");
      expect(m.query).toHaveBeenCalledWith(sql, params);
      jest.mocked(m.query).mockClear();
      await expect(
        reportingQuery(m, "other", sql, params, "cash"),
      ).rejects.toMatchObject({ status: 403 });
      expect(m.query).not.toHaveBeenCalled();
    },
  );
});
