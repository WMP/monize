import {
  type EntityManager,
  type ObjectLiteral,
  type SelectQueryBuilder,
} from "typeorm";
import { resolveReportingBasis, type ReportingBasis } from "./reporting-basis";
import { reportingFactCtes } from "./reporting-facts-sql";

/** Native-currency recognition facts. This helper never touches ledger writers or their managers. */
export async function reportingQuery<T = any>(
  m: EntityManager,
  userId: string,
  sql: string,
  params: any[] = [],
  basis?: ReportingBasis,
): Promise<T[]> {
  const resolved = await resolveReportingBasis(m, userId, basis);
  if (resolved === "cash") return m.query(sql, params);
  const ctes = reportingFactCtes(`$${params.length + 1}`, resolved)
    .map((c) => `${c.name} AS (${c.query})`)
    .join(",\n");
  const body = sql.trim();
  const statement = /^WITH\s/i.test(body)
    ? `WITH RECURSIVE ${ctes}, ${body.replace(/^WITH\s+(RECURSIVE\s+)?/i, "")}`
    : `WITH ${ctes} ${body}`;
  return m.query(statement, [...params, userId]);
}
export async function applyReportingBasis<T extends ObjectLiteral>(
  m: EntityManager,
  userId: string,
  qb: SelectQueryBuilder<T>,
  basis?: ReportingBasis,
): Promise<SelectQueryBuilder<T>> {
  const resolved = await resolveReportingBasis(m, userId, basis);
  if (resolved === "cash") return qb;
  const jointIds = qb.getParameters().analyticsScopeJointIds;
  const jointAccounts =
    Array.isArray(jointIds) && jointIds.length > 0
      ? ":...__recognitionJointIds"
      : undefined;
  if (jointAccounts) qb.setParameter("__recognitionJointIds", jointIds);
  for (const cte of reportingFactCtes(
    ":__recognitionOwner",
    resolved,
    jointAccounts,
  ))
    qb.addCommonTableExpression(cte.query, cte.name);
  return qb.setParameter("__recognitionOwner", userId);
}
export async function reportingRawMany<T = any>(
  m: EntityManager,
  userId: string,
  qb: SelectQueryBuilder<any>,
  basis?: ReportingBasis,
): Promise<T[]> {
  return (await applyReportingBasis(m, userId, qb, basis)).getRawMany<T>();
}
export async function reportingRawOne<T = any>(
  m: EntityManager,
  userId: string,
  qb: SelectQueryBuilder<any>,
): Promise<T | undefined> {
  return (await applyReportingBasis(m, userId, qb)).getRawOne<T>();
}
export async function reportingEntities<T extends ObjectLiteral>(
  m: EntityManager,
  userId: string,
  qb: SelectQueryBuilder<T>,
  options?: { basis?: ReportingBasis; preserveReportIds?: boolean },
): Promise<T[]> {
  // Only transaction roots carry recognition provenance. Other entities retain
  // their normal scoped read, even when the user's default is accrual.
  const root = qb.expressionMap.mainAlias;
  if (!root?.hasMetadata || root.metadata.tableName !== "transactions")
    return qb.getMany();
  if ((await resolveReportingBasis(m, userId, options?.basis)) === "cash")
    return qb.getMany();
  await applyReportingBasis(m, userId, qb, "accrual");
  const alias = qb.alias;
  const transactionAliases = [
    alias,
    ...qb.expressionMap.joinAttributes
      .filter(
        (join) =>
          join.alias.hasMetadata &&
          join.alias.metadata.tableName === "transactions",
      )
      .map((join) => join.alias.name),
  ];
  const splitAliases = qb.expressionMap.joinAttributes
    .filter(
      (join) =>
        join.alias.hasMetadata &&
        join.alias.metadata.tableName === "transaction_splits",
    )
    .map((join) => join.alias.name);
  const investmentAliases = qb.expressionMap.joinAttributes
    .filter(
      (join) =>
        join.alias.hasMetadata &&
        join.alias.metadata.tableName === "investment_transactions",
    )
    .map((join) => join.alias.name);
  for (const [index, name] of investmentAliases.entries()) {
    qb.addSelect(
      `${qb.escape(name)}.source_transaction_id`,
      `__reportInvestment${index}_transaction`,
    );
    qb.addSelect(
      `${qb.escape(name)}.source_transaction_split_id`,
      `__reportInvestment${index}_split`,
    );
  }
  for (const [index, name] of transactionAliases.entries()) {
    for (const [column, key] of [
      ["source_transaction_id", "sourceId"],
      ["is_recognition", "isRecognition"],
      ["source_cash_date", "cashDate"],
      ["source_amount", "sourceAmount"],
      ["source_linked_id", "linkedId"],
      ["source_parent_id", "parentId"],
    ])
      qb.addSelect(
        key === "cashDate"
          ? `TO_CHAR(${qb.escape(name)}.${qb.escape(column)},'YYYY-MM-DD')`
          : `${qb.escape(name)}.${qb.escape(column)}`,
        `__reportTx${index}_${key}`,
      );
  }
  for (const [index, name] of splitAliases.entries()) {
    for (const [column, key] of [
      ["source_split_id", "sourceId"],
      ["source_cash_date", "cashDate"],
      ["source_amount", "sourceAmount"],
      ["source_linked_id", "linkedId"],
      ["schedule_id", "scheduleId"],
    ])
      qb.addSelect(
        key === "cashDate"
          ? `TO_CHAR(${qb.escape(name)}.${qb.escape(column)},'YYYY-MM-DD')`
          : `${qb.escape(name)}.${qb.escape(column)}`,
        `__reportSplit${index}_${key}`,
      );
  }
  const { raw, entities } = await qb.getRawAndEntities();
  const investments = new Map<
    string,
    { transactionId: string | null; transactionSplitId: string | null }
  >();
  const transactions = new Map<string, Record<string, any>>(),
    splits = new Map<string, Record<string, any>>();
  for (const row of raw) {
    for (const [index, name] of investmentAliases.entries())
      if (row[`${name}_id`])
        investments.set(row[`${name}_id`], {
          transactionId: row[`__reportInvestment${index}_transaction`],
          transactionSplitId: row[`__reportInvestment${index}_split`],
        });
    for (const [index, name] of transactionAliases.entries())
      if (row[`${name}_id`])
        transactions.set(
          row[`${name}_id`],
          Object.fromEntries(
            [
              "sourceId",
              "isRecognition",
              "cashDate",
              "sourceAmount",
              "linkedId",
              "parentId",
            ].map((key) => [key, row[`__reportTx${index}_${key}`]]),
          ),
        );
    for (const [index, name] of splitAliases.entries())
      if (row[`${name}_id`])
        splits.set(
          row[`${name}_id`],
          Object.fromEntries(
            [
              "sourceId",
              "cashDate",
              "sourceAmount",
              "linkedId",
              "scheduleId",
            ].map((key) => [key, row[`__reportSplit${index}_${key}`]]),
          ),
        );
  }
  const day = (value: unknown) =>
    value instanceof Date
      ? value.toISOString().slice(0, 10)
      : String(value).slice(0, 10);
  const copy = (entity: any, parentSourceId?: string): any => {
    if (!entity || typeof entity !== "object") return entity;
    const tx = transactions.get(entity.id),
      split = splits.get(entity.id),
      metadata = tx ?? split;
    const value = Object.assign(
      Object.create(Object.getPrototypeOf(entity)),
      entity,
    );
    if (metadata) {
      value.reportingProvenance = {
        readOnly: true,
        ...(tx && options?.preserveReportIds
          ? { isRecognition: metadata.isRecognition === true }
          : {}),
        reportId: entity.id,
        sourceTransactionId: tx ? metadata.sourceId : parentSourceId,
        ...(split
          ? {
              sourceSplitId: metadata.sourceId,
              scheduleId: metadata.scheduleId ?? null,
            }
          : {}),
        cashDate: day(metadata.cashDate),
        effectiveDate: day(
          entity.transactionDate ?? entity.transaction?.transactionDate,
        ),
        sourceAmount: String(metadata.sourceAmount),
        nativeAmount: String(entity.amount),
      };
      if (!options?.preserveReportIds) value.id = metadata.sourceId;
      value.linkedTransactionId = metadata.linkedId;
      if (tx) value.parentTransactionId = metadata.parentId;
      if (split && !options?.preserveReportIds)
        value.transactionId = parentSourceId;
    }
    if (entity.splits)
      value.splits = entity.splits.map((line: any) => {
        const lineCopy = copy(line, tx?.sourceId ?? value.id);
        if (lineCopy.reportingProvenance)
          lineCopy.reportingProvenance = {
            ...lineCopy.reportingProvenance,
            effectiveDate: day(entity.transactionDate),
          };
        return lineCopy;
      });
    if (investments.has(entity.id))
      Object.assign(value, investments.get(entity.id));
    if (entity.investmentTransaction)
      value.investmentTransaction = copy(entity.investmentTransaction);
    if (entity.linkedTransaction)
      value.linkedTransaction = copy(entity.linkedTransaction);
    if (entity.parentTransaction)
      value.parentTransaction = copy(entity.parentTransaction);
    return value;
  };
  return entities.map((entity) => copy(entity));
}
