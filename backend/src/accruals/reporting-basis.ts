import { BadRequestException } from "@nestjs/common";
import { preferredCurrency } from "../common/default-currency.util";
import { AsyncLocalStorage } from "node:async_hooks";
import { type DataSource, type EntityManager } from "typeorm";
import { UserPreference } from "../users/entities/user-preference.entity";
import { withScopedDb } from "../common/db/scoped-db";
export type ReportingBasis = "cash" | "accrual";
export interface ReportingReadContext {
  userId: string;
  basis: ReportingBasis;
  convert: boolean;
  currency: string;
  resultCurrency?: string;
}
const reads = new AsyncLocalStorage<ReportingReadContext>();
export function currentReportingRead(userId: string) {
  const value = reads.getStore();
  return value?.userId === userId ? value : undefined;
}
export function reportingResultCurrency(userId: string, currency: string) {
  const context = currentReportingRead(userId);
  if (context) context.resultCurrency = currency;
}
export async function resolveReportingBasis(
  m: EntityManager,
  userId: string,
  requested?: ReportingBasis,
): Promise<ReportingBasis> {
  return (
    requested ??
    currentReportingRead(userId)?.basis ??
    (await m.getRepository(UserPreference).findOne({ where: { userId } }))
      ?.reportingBasis ??
    "accrual"
  );
}
export async function withReportingRead<T>(
  dataSource: DataSource,
  userId: string,
  fn: () => Promise<T>,
  requested?: ReportingBasis,
  convert = false,
): Promise<T> {
  if (
    requested !== undefined &&
    requested !== "cash" &&
    requested !== "accrual"
  )
    throw new BadRequestException({
      code: "REPORTING_BASIS_INVALID",
      allowed: ["cash", "accrual"],
    });
  const existing = currentReportingRead(userId);
  if (existing && (requested === undefined || requested === existing.basis))
    return fn();
  const pref = await withScopedDb(dataSource, (m) =>
    m.getRepository(UserPreference).findOne({ where: { userId } }),
  );
  return reads.run(
    {
      userId,
      basis: requested ?? pref?.reportingBasis ?? "accrual",
      convert,
      currency: preferredCurrency(pref),
    },
    async () => {
      const result = await fn();
      if (result && typeof result === "object" && !Array.isArray(result))
        return {
          ...result,
          basis:
            (result as Record<string, unknown>).basis === "cash" ||
            (result as Record<string, unknown>).basis === "accrual"
              ? (result as Record<string, unknown>).basis
              : reads.getStore()!.basis,
        };
      return result;
    },
  );
}
/** Domain readers share defaults across REST, assistant/MCP and internal calls. Cash-only operations opt out explicitly. */
export function ReportingRead(
  basis?: ReportingBasis,
  convert = false,
  requestedArgument?: number,
): MethodDecorator {
  return (_target, _name, descriptor: PropertyDescriptor) => {
    const original = descriptor.value as (
      userId: string,
      ...args: unknown[]
    ) => Promise<unknown>;
    descriptor.value = function (
      this: { dataSource: DataSource },
      userId: string,
      ...args: unknown[]
    ) {
      return withReportingRead(
        this.dataSource,
        userId,
        () => original.apply(this, [userId, ...args]),
        basis ??
          (requestedArgument === undefined
            ? undefined
            : typeof args[requestedArgument] === "object" &&
                args[requestedArgument] !== null
              ? (args[requestedArgument] as { basis?: ReportingBasis }).basis
              : (args[requestedArgument] as ReportingBasis | undefined)),
        convert,
      );
    };
  };
}
