import { getRequestContext } from "../common/request-context";
import { ForbiddenException } from "@nestjs/common";
import { tr } from "../i18n/translate";
import { executeReportingRead } from "./reporting-execution";
import { readReportingEntities } from "./reporting-entity-reader";
import {
  type EntityManager,
  type ObjectLiteral,
  type SelectQueryBuilder,
} from "typeorm";
import {
  resolveReportingExecution,
  resolveReportingBasis,
  type ReportingBasis,
} from "./reporting-basis";
import { prepareReportingRelations, reportingSql } from "./reporting-relations";

/** The effective owner includes delegation; system jobs may explicitly choose an owner. */
function assertReportingOwner(userId: string): void {
  const context = getRequestContext();
  if (context?.userId && context.userId !== userId && !context.system)
    throw new ForbiddenException({
      code: "REPORTING_OWNER_MISMATCH",
      message: tr("errors.http.forbidden", "Access denied"),
    });
}

/** Native-currency recognition facts. This helper never touches ledger writers or their managers. */
export async function reportingQuery<T = any>(
  m: EntityManager,
  userId: string,
  sql: string,
  params: any[] = [],
  basis?: ReportingBasis,
): Promise<T[]> {
  assertReportingOwner(userId);
  const resolved = await resolveReportingExecution(m, userId, basis);
  if (resolved === "cash") return m.query(sql, params);
  const statement = reportingSql(sql, resolved, `$${params.length + 1}`);
  return executeReportingRead(m, statement === sql ? "cash" : resolved, () =>
    m.query(statement, statement === sql ? params : [...params, userId]),
  );
}
export async function applyReportingBasis<T extends ObjectLiteral>(
  m: EntityManager,
  userId: string,
  qb: SelectQueryBuilder<T>,
  basis?: ReportingBasis,
): Promise<SelectQueryBuilder<T>> {
  const selected = await resolveReportingBasis(m, userId, basis);
  if (selected === "cash") return prepareReportingRelations(qb, "cash");
  const jointIds = qb.getParameters().analyticsScopeJointIds;
  const resolved = await resolveReportingExecution(
    m,
    userId,
    selected,
    Array.isArray(jointIds) ? jointIds : [],
  );
  return prepareReportingRelations(qb, resolved);
}
export async function reportingRawMany<T = any>(
  m: EntityManager,
  userId: string,
  qb: SelectQueryBuilder<any>,
  basis?: ReportingBasis,
): Promise<T[]> {
  const query = await applyReportingBasis(m, userId, qb, basis);
  const selected =
    query.expressionMap?.mainAlias?.hasMetadata &&
    query.expressionMap.mainAlias.metadata.tableName.startsWith(
      "accrual_reporting_",
    )
      ? "accrual"
      : "cash";
  return executeReportingRead(m, selected, () => query.getRawMany<T>());
}
export async function reportingRawOne<T = any>(
  m: EntityManager,
  userId: string,
  qb: SelectQueryBuilder<any>,
): Promise<T | undefined> {
  const query = await applyReportingBasis(m, userId, qb);
  const selected =
    query.expressionMap?.mainAlias?.hasMetadata &&
    query.expressionMap.mainAlias.metadata.tableName.startsWith(
      "accrual_reporting_",
    )
      ? "accrual"
      : "cash";
  return executeReportingRead(m, selected, () => query.getRawOne<T>());
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
  if (
    !root?.hasMetadata ||
    !["transactions", "accrual_reporting_transactions"].includes(
      root.metadata.tableName,
    )
  )
    return qb.getMany();
  await applyReportingBasis(m, userId, qb, options?.basis);
  if (
    qb.expressionMap.mainAlias!.metadata.tableName !==
    "accrual_reporting_transactions"
  )
    return qb.getMany();
  return executeReportingRead(m, "accrual", () =>
    readReportingEntities(m, qb, options?.preserveReportIds),
  );
}
