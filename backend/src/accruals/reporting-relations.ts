import { cteScopes } from "./reporting-cte-scope";
import type { ObjectLiteral, SelectQueryBuilder } from "typeorm";
import { Transaction } from "../transactions/entities/transaction.entity";
import { TransactionSplit } from "../transactions/entities/transaction-split.entity";
import { InvestmentTransaction } from "../securities/entities/investment-transaction.entity";
import { ReportingTransaction } from "./entities/reporting-transaction.entity";
import { ReportingSplit } from "./entities/reporting-split.entity";
import { ReportingInvestment } from "./entities/reporting-investment.entity";
import type { ReportingBasis } from "./reporting-basis";

const entities = {
  transactions: [Transaction, ReportingTransaction],
  transaction_splits: [TransactionSplit, ReportingSplit],
  investment_transactions: [InvestmentTransaction, ReportingInvestment],
} as const;
const tables = new Set<string>([
  ...Object.keys(entities),
  "transaction_tags",
  "transaction_split_tags",
]);

/** Render only relation tokens in SQL owned by a report builder. Literals,
 * comments, bound parameters and aliases are preserved byte for byte. */
export function reportingSql(
  sql: string,
  basis: ReportingBasis,
  ownerParameter?: string,
  pageRelations?: Readonly<Record<string, string>>,
): string {
  const tokens =
    sql.match(
      /--[^\n]*(?:\n|$)|\/\*[\s\S]*?\*\/|'(?:''|[^'])*'|"(?:""|[^"])*"|[A-Za-z_][A-Za-z_0-9]*|\s+|./g,
    ) ?? [];
  const name = (token: string) =>
    token.startsWith('"')
      ? token.slice(1, -1).replace(/""/g, '"')
      : token.toLowerCase();
  const next = (index: number) => {
    while (
      index < tokens.length &&
      (/^\s+$/.test(tokens[index]) ||
        tokens[index].startsWith("--") ||
        tokens[index].startsWith("/*"))
    )
      index++;
    return index;
  };
  const ctes = cteScopes(tokens, next, name);
  const unaliased = new Set<string>();
  const previous = (index: number) => {
    while (
      index >= 0 &&
      (/^\s+$/.test(tokens[index]) ||
        tokens[index].startsWith("--") ||
        tokens[index].startsWith("/*"))
    )
      index--;
    return tokens[index];
  };
  for (let index = 0; index < tokens.length; index++) {
    if (!/^(FROM|JOIN)$/i.test(tokens[index])) continue;
    if (
      /^FROM$/i.test(tokens[index]) &&
      /^DISTINCT$/i.test(previous(index - 1) ?? "")
    )
      continue;
    const first = next(index + 1);
    let table = first;
    if (
      name(tokens[first] ?? "") === "public" &&
      tokens[next(first + 1)] === "."
    )
      table = next(next(first + 1) + 1);
    const originalTableName = name(tokens[table] ?? "");
    if (
      table === first &&
      ctes.some(
        (cte) =>
          cte.name === originalTableName &&
          cte.start <= index &&
          index < cte.end,
      )
    )
      continue;
    let tableName = originalTableName;
    const recognized = tableName.startsWith("accrual_reporting_");
    if (recognized) tableName = tableName.slice("accrual_reporting_".length);
    if (!tables.has(tableName)) continue;
    const relation =
      basis === "accrual" ? `accrual_reporting_${tableName}` : tableName;
    const qualified = pageRelations?.[tableName] ?? `public.${relation}`;
    const after = next(table + 1);
    const hasAlias =
      /^AS$/i.test(tokens[after] ?? "") ||
      (/^(?:"[^"].*"|[A-Za-z_][A-Za-z_0-9]*)$/.test(tokens[after] ?? "") &&
        !/^(WHERE|JOIN|LEFT|RIGHT|INNER|FULL|CROSS|NATURAL|ON|USING|GROUP|ORDER|LIMIT|OFFSET|UNION|EXCEPT|INTERSECT|HAVING|FETCH|FOR|WINDOW|TABLESAMPLE)$/i.test(
          tokens[after],
        ));
    if (!hasAlias) unaliased.add(originalTableName);
    const alias = hasAlias ? "" : ` "${originalTableName.replace(/"/g, '""')}"`;
    if (ownerParameter) {
      const root =
        basis === "accrual"
          ? "public.accrual_reporting_transactions"
          : "public.transactions";
      const split =
        basis === "accrual"
          ? "public.accrual_reporting_transaction_splits"
          : "public.transaction_splits";
      const predicate =
        tableName === "transactions" || tableName === "investment_transactions"
          ? `__owned.user_id=${ownerParameter}`
          : basis === "accrual"
            ? `__owned.reporting_user_id=${ownerParameter}`
            : tableName === "transaction_splits" ||
                tableName === "transaction_tags"
              ? `EXISTS(SELECT 1 FROM ${root} __owner WHERE __owner.id=__owned.transaction_id AND __owner.user_id=${ownerParameter})`
              : `EXISTS(SELECT 1 FROM ${split} __split JOIN ${root} __owner ON __owner.id=__split.transaction_id WHERE __split.id=__owned.transaction_split_id AND __owner.user_id=${ownerParameter})`;
      tokens[first] =
        `(SELECT __owned.* FROM ${qualified} __owned WHERE ${predicate})${alias}`;
    } else tokens[first] = qualified + alias;
    for (let part = first + 1; part <= table; part++) tokens[part] = "";
    index = table;
  }
  // A derived or renamed relation cannot retain public.table.column syntax.
  for (let index = 0; index < tokens.length; index++) {
    if (name(tokens[index]) !== "public") continue;
    const dot = next(index + 1),
      table = next(dot + 1),
      columnDot = next(table + 1);
    if (
      tokens[dot] !== "." ||
      tokens[columnDot] !== "." ||
      !unaliased.has(name(tokens[table] ?? ""))
    )
      continue;
    tokens[index] = `"${name(tokens[table]).replace(/"/g, '""')}"`;
    for (let part = index + 1; part <= table; part++) tokens[part] = "";
  }
  return tokens.join("");
}

function mappedTarget(target: unknown, basis: ReportingBasis): unknown {
  if (typeof target === "string") {
    const table = target
      .replace(/^public\./, "")
      .replace(/^accrual_reporting_/, "");
    if (Object.prototype.hasOwnProperty.call(entities, table))
      return entities[table as keyof typeof entities][
        basis === "accrual" ? 1 : 0
      ];
  } else {
    for (const pair of Object.values(entities))
      if (pair.includes(target as never))
        return pair[basis === "accrual" ? 1 : 0];
  }
  return target;
}
function condition(value: any, basis: ReportingBasis): any {
  if (typeof value === "string") return reportingSql(value, basis);
  if (Array.isArray(value)) return value.map((item) => condition(item, basis));
  if (value && typeof value === "object")
    return Object.fromEntries(
      Object.entries(value).map(([key, item]) => [key, condition(item, basis)]),
    );
  return value;
}

/** Build an explicit read-model query with normal TypeORM relations. Only the
 * builder's own root/joins are rebuilt; shared entity metadata is never changed.
 * No same-name CTEs, query-runner interception or ledger writes are involved. */
export function prepareReportingRelations<T extends ObjectLiteral>(
  qb: SelectQueryBuilder<T>,
  basis: ReportingBasis,
): SelectQueryBuilder<T> {
  const root = qb.expressionMap?.mainAlias;
  if (!root?.hasMetadata) return qb;
  const target = mappedTarget(root.metadata.target, basis);
  if (target === root.metadata.target) return qb;
  const rootName = root.name;
  const joins = qb.expressionMap.joinAttributes.map((join) => ({
    direction: join.direction,
    entity: join.alias.subQuery ?? join.entityOrProperty,
    alias: join.alias.name,
    condition: join.condition,
    mapToProperty: join.mapToProperty,
    isMappingMany: join.isMappingMany,
    mapAsEntity: join.mapAsEntity,
  }));
  const selections = qb.expressionMap.selects;
  qb.expressionMap.joinAttributes = [];
  qb.expressionMap.aliases = [];
  qb.from(target as typeof Transaction, rootName);
  for (const join of joins) {
    const entity = mappedTarget(join.entity, basis) as typeof Transaction;
    const on = join.condition ? reportingSql(join.condition, basis) : undefined;
    if (join.mapToProperty) {
      if (join.direction === "LEFT") {
        if (join.isMappingMany)
          qb.leftJoinAndMapMany(join.mapToProperty, entity, join.alias, on);
        else
          qb.leftJoinAndMapOne(
            join.mapToProperty,
            entity,
            join.alias,
            on,
            undefined,
          );
      } else {
        if (join.isMappingMany)
          qb.innerJoinAndMapMany(join.mapToProperty, entity, join.alias, on);
        else
          qb.innerJoinAndMapOne(
            join.mapToProperty,
            entity,
            join.alias,
            on,
            undefined,
          );
      }
    } else if (join.direction === "LEFT") qb.leftJoin(entity, join.alias, on);
    else qb.innerJoin(entity, join.alias, on);
  }
  qb.expressionMap.selects = selections.map((select) => ({
    ...select,
    selection: reportingSql(select.selection, basis),
  }));
  qb.expressionMap.wheres = condition(qb.expressionMap.wheres, basis);
  qb.expressionMap.havings = condition(qb.expressionMap.havings, basis);
  return qb;
}
