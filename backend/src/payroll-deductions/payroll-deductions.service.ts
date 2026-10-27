import {
  BadRequestException,
  ConflictException,
  Injectable,
  NotFoundException,
} from "@nestjs/common";
import { DataSource, EntityManager } from "typeorm";
import { todayYMD } from "../common/date-utils";
import { returnedRows } from "../common/db/query-result";
import { withScopedDb } from "../common/db/scoped-db";
import { roundMoney } from "../common/round.util";
import { Category } from "../categories/entities/category.entity";
import { tr } from "../i18n/translate";
import { ScheduledTransaction } from "../scheduled-transactions/entities/scheduled-transaction.entity";
import { ScheduledTransactionSplit } from "../scheduled-transactions/entities/scheduled-transaction-split.entity";
import {
  CreatePayrollDeductionRuleDto,
  CreatePayrollDeductionRulesDto,
  PayrollDeductionLineDto,
  UpdatePayrollDeductionRuleDto,
} from "./dto/create-payroll-deduction-rule.dto";
import { PayrollDeductionRule } from "./entities/payroll-deduction-rule.entity";
import {
  PayrollDeductionFigures,
  resolveExpectedPerPaycheque,
  resolvePayrollDeductionFigures,
} from "./payroll-deduction-cap";
import { subtractMonths } from "./payroll-deduction-period";

/**
 * How far back the suggestion reads the ledger. Deduction rates change once
 * a year, so a year of paycheques holds one rate more often than any other;
 * a longer window would let last year's rate outvote this year's.
 */
export const SUGGESTION_WINDOW_MONTHS = 12;

/** A rule as the page reads it: the row, its names and today's figures. */
export type PayrollDeductionRuleView = PayrollDeductionRule &
  PayrollDeductionFigures & {
    categoryName: string;
    scheduledTransactionName: string;
  };

/**
 * What `GET /payroll-deductions/suggest` answers (decision 3): `line` is the
 * bill's own figure, `ledger` the magnitude the category's deduction rows
 * most often carry in the last `SUGGESTION_WINDOW_MONTHS`.
 */
export interface ExpectedAmountSuggestion {
  expectedPerPaycheque: number | null;
  expectedSource: "line" | "ledger" | null;
}

/**
 * Payroll deduction rules (docs/specs/payroll-deductions.md). Every method
 * takes the owner's id first and reads only that owner's rows; the ledger is
 * read for the year-to-date figure and never written (INV-PAYROLL-001).
 */
@Injectable()
export class PayrollDeductionsService {
  constructor(private readonly dataSource: DataSource) {}

  /** The owner's rules with their figures as of today, oldest first. */
  async findAll(userId: string): Promise<PayrollDeductionRuleView[]> {
    const today = todayYMD();
    return withScopedDb(this.dataSource, async (m) => {
      const rules = await m.getRepository(PayrollDeductionRule).find({
        where: { userId },
        relations: [
          "category",
          "scheduledTransaction",
          "scheduledTransaction.splits",
        ],
        order: { createdAt: "ASC" },
      });
      const views: PayrollDeductionRuleView[] = [];
      for (const rule of rules) {
        views.push(await this.toView(m, userId, rule, today));
      }
      return views;
    });
  }

  /**
   * The expected amount a new rule could start from: the bill's line for the
   * category, else the magnitude the category's deduction rows most often
   * carry over the last year (ties go to the more recently seen figure), else
   * nothing (the form then insists on a figure). A single row is one paycheque;
   * the mode is the figure the paycheque usually deducts, which the latest row
   * is not once the line has been capped or a rate has changed.
   */
  async suggestExpected(
    userId: string,
    scheduledTransactionId: string,
    categoryId: string,
  ): Promise<ExpectedAmountSuggestion> {
    const since = subtractMonths(todayYMD(), SUGGESTION_WINDOW_MONTHS);
    return withScopedDb(this.dataSource, async (m) => {
      const schedule = await this.ownedSchedule(
        m,
        userId,
        scheduledTransactionId,
      );
      const fromLine = resolveExpectedPerPaycheque(
        { categoryId, expectedPerPaycheque: null },
        schedule.splits ?? [],
      );
      if (fromLine.expectedSource === "line") {
        return {
          expectedPerPaycheque: fromLine.expectedPerPaycheque,
          expectedSource: "line",
        };
      }
      const rows = returnedRows<{ amount: string }>(
        await m.query(
          `SELECT x.amount
             FROM (
               SELECT t.amount, t.transaction_date, t.created_at
                 FROM transactions t
                WHERE t.user_id = $1 AND t.category_id = $2
                  AND t.is_split = false AND t.status <> 'VOID'
                  AND t.currency_code = $3
               UNION ALL
               SELECT s.amount, t.transaction_date, t.created_at
                 FROM transaction_splits s
                 JOIN transactions t ON t.id = s.transaction_id
                WHERE t.user_id = $1 AND s.category_id = $2
                  AND t.status <> 'VOID'
                  AND t.currency_code = $3
             ) x
            WHERE x.amount < 0 AND x.transaction_date >= $4
            GROUP BY x.amount
            ORDER BY COUNT(*) DESC, MAX(x.transaction_date) DESC
            LIMIT 1`,
          [userId, categoryId, schedule.currencyCode, since],
        ),
      );
      const usual = rows[0] ? roundMoney(-Number(rows[0].amount)) : null;
      return {
        expectedPerPaycheque: usual,
        expectedSource: usual === null ? null : "ledger",
      };
    });
  }

  /** One rule: the single-line form of `createMany`. */
  async create(
    userId: string,
    dto: CreatePayrollDeductionRuleDto,
  ): Promise<PayrollDeductionRuleView> {
    const [view] = await this.createMany(userId, {
      scheduledTransactionId: dto.scheduledTransactionId,
      resetPeriod: dto.resetPeriod,
      resetDate: dto.resetDate,
      lines: [
        {
          categoryId: dto.categoryId,
          yearlyMaximum: dto.yearlyMaximum,
          expectedPerPaycheque: dto.expectedPerPaycheque,
        },
      ],
    });
    return view;
  }

  /**
   * Several categories of one bill in one transaction: every ownership,
   * duplicate and expected-amount check runs before the first row is saved,
   * so a refused line leaves no sibling behind (AGENTS.md, "Transactions").
   */
  async createMany(
    userId: string,
    dto: CreatePayrollDeductionRulesDto,
  ): Promise<PayrollDeductionRuleView[]> {
    const today = todayYMD();
    return withScopedDb(this.dataSource, async (m) => {
      const schedule = await this.ownedSchedule(
        m,
        userId,
        dto.scheduledTransactionId,
      );
      const repo = m.getRepository(PayrollDeductionRule);
      const seen = new Set<string>();
      const rows: Partial<PayrollDeductionRule>[] = [];
      for (const line of dto.lines) {
        if (seen.has(line.categoryId)) throw this.duplicate();
        seen.add(line.categoryId);
        rows.push(await this.prepareLine(m, userId, schedule, dto, line));
      }
      const views: PayrollDeductionRuleView[] = [];
      for (const row of rows) {
        const saved = await repo.save(repo.create(row));
        views.push(
          await this.toView(
            m,
            userId,
            await this.reload(m, userId, saved.id),
            today,
          ),
        );
      }
      return views;
    });
  }

  /** The row one line becomes, after every check that can refuse it. */
  private async prepareLine(
    m: EntityManager,
    userId: string,
    schedule: ScheduledTransaction,
    shared: Pick<
      CreatePayrollDeductionRulesDto,
      "scheduledTransactionId" | "resetPeriod" | "resetDate"
    >,
    line: PayrollDeductionLineDto,
  ): Promise<Partial<PayrollDeductionRule>> {
    await this.ownedCategory(m, userId, line.categoryId);
    const duplicate = await m.getRepository(PayrollDeductionRule).findOne({
      where: {
        userId,
        scheduledTransactionId: shared.scheduledTransactionId,
        categoryId: line.categoryId,
      },
    });
    if (duplicate) throw this.duplicate();
    return {
      userId,
      scheduledTransactionId: shared.scheduledTransactionId,
      categoryId: line.categoryId,
      yearlyMaximum: roundMoney(line.yearlyMaximum),
      resetPeriod: shared.resetPeriod ?? "YEARLY",
      resetDate: shared.resetDate,
      expectedPerPaycheque: this.expectedOrRefuse(
        schedule,
        line.categoryId,
        line.expectedPerPaycheque,
      ),
    };
  }

  private duplicate(): ConflictException {
    return new ConflictException(
      tr(
        "errors.payrollDeductions.duplicate",
        "This bill already has a rule for that category",
      ),
    );
  }

  async update(
    userId: string,
    id: string,
    dto: UpdatePayrollDeductionRuleDto,
  ): Promise<PayrollDeductionRuleView> {
    const today = todayYMD();
    return withScopedDb(this.dataSource, async (m) => {
      const repo = m.getRepository(PayrollDeductionRule);
      const rule = await repo.findOne({ where: { id, userId } });
      if (!rule) throw this.notFound(id);
      const scheduledTransactionId =
        dto.scheduledTransactionId ?? rule.scheduledTransactionId;
      const categoryId = dto.categoryId ?? rule.categoryId;
      const schedule = await this.ownedSchedule(
        m,
        userId,
        scheduledTransactionId,
      );
      if (dto.categoryId !== undefined) {
        await this.ownedCategory(m, userId, categoryId);
      }
      if (
        scheduledTransactionId !== rule.scheduledTransactionId ||
        categoryId !== rule.categoryId
      ) {
        const duplicate = await repo.findOne({
          where: { userId, scheduledTransactionId, categoryId },
        });
        if (duplicate && duplicate.id !== id) throw this.duplicate();
      }
      const expected = this.expectedOrRefuse(
        schedule,
        categoryId,
        dto.expectedPerPaycheque === undefined
          ? rule.expectedPerPaycheque
          : dto.expectedPerPaycheque,
      );
      await repo.update(
        { id },
        {
          scheduledTransactionId,
          categoryId,
          yearlyMaximum:
            dto.yearlyMaximum === undefined
              ? rule.yearlyMaximum
              : roundMoney(dto.yearlyMaximum),
          resetPeriod: dto.resetPeriod ?? rule.resetPeriod,
          resetDate: dto.resetDate ?? rule.resetDate,
          expectedPerPaycheque: expected,
        },
      );
      return this.toView(m, userId, await this.reload(m, userId, id), today);
    });
  }

  async remove(userId: string, id: string): Promise<void> {
    await withScopedDb(this.dataSource, async (m) => {
      const result = await m
        .getRepository(PayrollDeductionRule)
        .delete({ id, userId });
      if (!result.affected) throw this.notFound(id);
    });
  }

  private notFound(id: string): NotFoundException {
    return new NotFoundException(
      tr(
        "errors.payrollDeductions.notFound",
        `Payroll deduction rule ${id} not found`,
        { id },
      ),
    );
  }

  /**
   * The expected figure to store: `null` when the bill's own line supplies it
   * (decision 3), the entered magnitude otherwise, refused when neither says.
   */
  private expectedOrRefuse(
    schedule: Pick<ScheduledTransaction, "splits">,
    categoryId: string,
    entered: number | null | undefined,
  ): number | null {
    const fromLine = resolveExpectedPerPaycheque(
      { categoryId, expectedPerPaycheque: null },
      schedule.splits ?? [],
    );
    if (fromLine.expectedSource === "line") return null;
    if (entered === null || entered === undefined) {
      throw new BadRequestException(
        tr(
          "errors.payrollDeductions.expectedRequired",
          "The bill has no line for this category; enter the amount expected per paycheque",
        ),
      );
    }
    return roundMoney(entered);
  }

  private async ownedSchedule(
    m: EntityManager,
    userId: string,
    id: string,
  ): Promise<ScheduledTransaction> {
    const schedule = await m.getRepository(ScheduledTransaction).findOne({
      where: { id, userId },
      relations: ["splits"],
    });
    if (!schedule) {
      throw new NotFoundException(
        tr(
          "errors.scheduled.notFound",
          `Scheduled transaction with ID ${id} not found`,
          { id },
        ),
      );
    }
    return schedule;
  }

  private async ownedCategory(
    m: EntityManager,
    userId: string,
    id: string,
  ): Promise<Category> {
    const category = await m
      .getRepository(Category)
      .findOne({ where: { id, userId } });
    if (!category) {
      throw new NotFoundException(
        tr("errors.categories.notFound", `Category with ID ${id} not found`, {
          id,
        }),
      );
    }
    return category;
  }

  private async reload(
    m: EntityManager,
    userId: string,
    id: string,
  ): Promise<PayrollDeductionRule> {
    const rule = await m.getRepository(PayrollDeductionRule).findOne({
      where: { id, userId },
      relations: [
        "category",
        "scheduledTransaction",
        "scheduledTransaction.splits",
      ],
    });
    if (!rule) throw this.notFound(id);
    return rule;
  }

  private async toView(
    m: EntityManager,
    userId: string,
    rule: PayrollDeductionRule,
    asOf: string,
  ): Promise<PayrollDeductionRuleView> {
    const lines: ScheduledTransactionSplit[] =
      rule.scheduledTransaction?.splits ?? [];
    const figures = await resolvePayrollDeductionFigures(
      m,
      userId,
      rule,
      lines,
      rule.scheduledTransaction?.currencyCode ?? "",
      asOf,
    );
    const { scheduledTransaction, category, ...row } = rule;
    return {
      ...row,
      yearlyMaximum: roundMoney(Number(rule.yearlyMaximum)),
      ...figures,
      categoryName: category?.name ?? "",
      scheduledTransactionName: scheduledTransaction?.name ?? "",
    } as PayrollDeductionRuleView;
  }
}
