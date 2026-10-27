import type { EntityManager, ObjectLiteral, SelectQueryBuilder } from "typeorm";
import {
  reportingQuery,
  applyReportingBasis,
  reportingRawMany,
  reportingRawOne,
  reportingEntities,
} from "./reporting-query";

function setup() {
  const query = jest.fn().mockResolvedValue([{ value: 1 }]);
  const manager = {
    query,
    getRepository: () => ({
      findOne: async () => ({ reportingBasis: "accrual" }),
    }),
  } as unknown as EntityManager;
  const builder = {
    alias: "t",
    expressionMap: {
      mainAlias: {
        name: "t",
        hasMetadata: true,
        metadata: { tableName: "transactions" },
      },
      joinAttributes: [
        {
          alias: {
            hasMetadata: true,
            metadata: { tableName: "transactions" },
            name: "linked",
          },
        },
        {
          alias: {
            hasMetadata: true,
            metadata: { tableName: "transaction_splits" },
            name: "s",
          },
        },
        {
          alias: {
            hasMetadata: true,
            metadata: { tableName: "investment_transactions" },
            name: "i",
          },
        },
        { alias: { hasMetadata: false, name: "unmapped" } },
      ],
    },
    getParameters: jest
      .fn()
      .mockReturnValue({ analyticsScopeJointIds: ["joint"] }),
    setParameter: jest.fn().mockReturnThis(),
    addCommonTableExpression: jest.fn().mockReturnThis(),
    addSelect: jest.fn().mockReturnThis(),
    escape: (name: string) => `"${name}"`,
    getMany: jest.fn().mockResolvedValue([{ id: "cash" }]),
    getRawMany: jest.fn().mockResolvedValue([{ id: "raw" }]),
    getRawOne: jest.fn().mockResolvedValue({ id: "one" }),
    getRawAndEntities: jest.fn(),
  };
  return {
    manager,
    query,
    builder,
    qb: builder as unknown as SelectQueryBuilder<ObjectLiteral>,
  };
}

describe("reporting query projection boundaries", () => {
  it.each(["notifications", "accounts"])(
    "does not project transaction columns onto a %s root",
    async (tableName) => {
      const { manager, builder, qb } = setup();
      builder.expressionMap.mainAlias.metadata.tableName = tableName;
      builder.getMany.mockResolvedValue([{ id: "ordinary-entity" }]);
      expect(
        await reportingEntities(manager, "owner", qb, { basis: "accrual" }),
      ).toEqual([{ id: "ordinary-entity" }]);
      expect(builder.addCommonTableExpression).not.toHaveBeenCalled();
      expect(builder.addSelect).not.toHaveBeenCalled();
      expect(builder.getRawAndEntities).not.toHaveBeenCalled();
    },
  );

  it("passes cash SQL and entities through without recognition projections", async () => {
    const { manager, query, builder, qb } = setup();
    await reportingQuery(manager, "owner", "SELECT $1", [7], "cash");
    expect(query).toHaveBeenCalledWith("SELECT $1", [7]);
    expect(
      await reportingEntities(manager, "owner", qb, { basis: "cash" }),
    ).toEqual([{ id: "cash" }]);
    expect(builder.addCommonTableExpression).not.toHaveBeenCalled();
    expect(await applyReportingBasis(manager, "owner", qb, "cash")).toBe(qb);
  });

  it.each([
    "SELECT $1",
    "WITH existing AS (SELECT $1) SELECT * FROM existing",
    "WITH RECURSIVE existing AS (SELECT $1) SELECT * FROM existing",
  ])("appends owner binding while preserving existing SQL: %s", async (sql) => {
    const { manager, query } = setup();
    await reportingQuery(manager, "owner", sql, [7], "accrual");
    const [statement, params] = query.mock.calls[0];
    expect(params).toEqual([7, "owner"]);
    expect(statement).toContain("$2");
    expect(statement.match(/WITH RECURSIVE/g)?.length ?? 0).toBe(
      sql.startsWith("WITH") ? 1 : 0,
    );
    expect(statement).toContain("SELECT $1");
  });

  it("keeps joint account scope and supports raw reads under the selected basis", async () => {
    const { manager, builder, qb } = setup();
    expect(await reportingRawMany(manager, "owner", qb, "accrual")).toEqual([
      { id: "raw" },
    ]);
    expect(await reportingRawOne(manager, "owner", qb)).toEqual({ id: "one" });
    expect(builder.setParameter).toHaveBeenCalledWith("__recognitionJointIds", [
      "joint",
    ]);
    expect(builder.setParameter).toHaveBeenCalledWith(
      "__recognitionOwner",
      "owner",
    );
    builder.getParameters.mockReturnValue({ analyticsScopeJointIds: [] });
    await applyReportingBasis(manager, "owner", qb, "accrual");
  });

  it.each([false, true])(
    "maps recognition rows back to source entries, preserving report IDs only when requested (%s)",
    async (preserveReportIds) => {
      const { manager, builder, qb } = setup();
      const source = {
        id: "report",
        transactionDate: new Date("2026-11-30T00:00:00Z"),
        amount: "100",
        splits: [{ id: "split-report", amount: "100" }],
        investmentTransaction: { id: "investment" },
        linkedTransaction: {
          id: "linked-report",
          amount: "-100",
          transactionDate: "2026-11-30",
        },
        parentTransaction: null,
      };
      builder.getRawAndEntities.mockResolvedValue({
        entities: [source],
        raw: [
          {
            t_id: "report",
            linked_id: "linked-report",
            s_id: "split-report",
            i_id: "investment",
            __reportTx0_sourceId: "payment",
            __reportTx0_isRecognition: true,
            __reportTx0_cashDate: "2026-10-15",
            __reportTx0_sourceAmount: "1200",
            __reportTx0_linkedId: "linked-payment",
            __reportTx0_parentId: null,
            __reportTx1_sourceId: "linked-payment",
            __reportTx1_cashDate: "2026-10-15",
            __reportTx1_sourceAmount: "-1200",
            __reportTx1_linkedId: "payment",
            __reportTx1_parentId: null,
            __reportSplit0_sourceId: "split-payment",
            __reportSplit0_cashDate: "2026-10-15",
            __reportSplit0_sourceAmount: "1200",
            __reportSplit0_linkedId: null,
            __reportSplit0_scheduleId: "schedule",
            __reportInvestment0_transaction: "payment",
            __reportInvestment0_split: "split-payment",
          },
          {},
        ],
      });
      const [result] = await reportingEntities(manager, "owner", qb, {
        basis: "accrual",
        preserveReportIds,
      });
      expect(result.id).toBe(preserveReportIds ? "report" : "payment");
      expect(result.reportingProvenance).toMatchObject({
        reportId: "report",
        sourceTransactionId: "payment",
        cashDate: "2026-10-15",
        effectiveDate: "2026-11-30",
        sourceAmount: "1200",
        nativeAmount: "100",
        readOnly: true,
      });
      expect(result.splits[0].reportingProvenance).toMatchObject({
        sourceSplitId: "split-payment",
        sourceTransactionId: "payment",
        scheduleId: "schedule",
        effectiveDate: "2026-11-30",
      });
      expect(result.linkedTransaction.id).toBe(
        preserveReportIds ? "linked-report" : "linked-payment",
      );
      expect(result.investmentTransaction).toMatchObject({
        transactionId: "payment",
        transactionSplitId: "split-payment",
      });
      expect(result.parentTransaction).toBeNull();
      expect(source.id).toBe("report");
      expect(source.splits[0].id).toBe("split-report");
    },
  );
});
