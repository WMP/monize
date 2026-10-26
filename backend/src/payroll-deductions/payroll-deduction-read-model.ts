import { EntityManager } from "typeorm";
import { roundMoney } from "../common/round.util";
import { PayrollDeductionRule } from "./entities/payroll-deduction-rule.entity";
import {
  PayrollDeductionFigures,
  resolvePayrollDeductionFigures,
} from "./payroll-deduction-cap";

/** The field every scheduled bill carries (docs/specs/payroll-deductions.md section 5.3). */
export type ScheduledPayrollDeduction = PayrollDeductionFigures & {
  ruleId: string;
  categoryId: string;
  categoryName: string;
  yearlyMaximum: number;
};

/** The slice of a schedule the figures need. */
export interface ScheduleForDeductions {
  id: string;
  currencyCode: string;
  splits?: { categoryId?: string | null; amount: number }[] | null;
}

/**
 * The rules on each of the owner's bills with their figures as of `asOf`,
 * keyed by bill id; a bill without a rule is absent. A plain function over
 * the caller's manager so the scheduled-transactions read joins its own
 * transaction without a module edge (INV-PAYROLL-003: the forecast reads
 * these figures and never re-derives them).
 */
export async function loadScheduledPayrollDeductions(
  m: EntityManager,
  userId: string,
  schedules: readonly ScheduleForDeductions[],
  asOf: string,
): Promise<Map<string, ScheduledPayrollDeduction[]>> {
  const result = new Map<string, ScheduledPayrollDeduction[]>();
  if (schedules.length === 0) return result;
  const rules = await m.getRepository(PayrollDeductionRule).find({
    where: { userId },
    relations: ["category"],
    order: { createdAt: "ASC" },
  });
  if (rules.length === 0) return result;
  const byId = new Map(schedules.map((s) => [s.id, s]));
  for (const rule of rules) {
    const schedule = byId.get(rule.scheduledTransactionId);
    if (!schedule) continue;
    const figures = await resolvePayrollDeductionFigures(
      m,
      userId,
      rule,
      schedule.splits ?? [],
      schedule.currencyCode,
      asOf,
    );
    result.set(schedule.id, [
      ...(result.get(schedule.id) ?? []),
      {
        ...figures,
        ruleId: rule.id,
        categoryId: rule.categoryId,
        categoryName: rule.category?.name ?? "",
        yearlyMaximum: roundMoney(Number(rule.yearlyMaximum)),
      },
    ]);
  }
  return result;
}
