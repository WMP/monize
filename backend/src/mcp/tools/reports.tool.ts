import { Injectable } from "@nestjs/common";
import { z } from "zod";
import { McpServer } from "@modelcontextprotocol/server";
import { BuiltInReportsService } from "../../built-in-reports/built-in-reports.service";
import { NetWorthService } from "../../net-worth/net-worth.service";
import {
  resolveUserContext,
  requireScope,
  toolResult,
  toolError,
  safeToolError,
} from "../mcp-context";
import {
  getDefaultDateRange,
  getDefaultPreviousMonth,
  numberArg,
} from "../../common/tool-schemas";
import { generateReportOutput } from "../tool-output-schemas";
import { READ_ONLY } from "../mcp-annotations";

@Injectable()
export class McpReportsTools {
  constructor(
    private readonly reportsService: BuiltInReportsService,
    private readonly netWorthService: NetWorthService,
  ) {}

  register(server: McpServer) {
    server.registerTool(
      "generate_report",
      {
        title: "Generate report",
        annotations: READ_ONLY,
        description:
          "Run a built-in financial report, which returns a ready aggregate. " +
          "Prefer it over list_transactions for any breakdown, anomaly or " +
          "month-comparison question. The `type` field says what each report " +
          "answers and which of the date parameters it reads. For an arbitrary " +
          "pair of ranges use compare_periods instead.",
        inputSchema: z.object({
          type: z
            .enum([
              "spending_by_category",
              "spending_by_payee",
              "income_vs_expenses",
              "monthly_trend",
              "income_by_source",
              "spending_anomalies",
              "month_comparison",
              "net_worth_history",
            ])
            .describe(
              "Which report to run, exactly one of the listed values. The five totals reports (by category, by payee, income vs expenses, monthly trend, income by source) read startDate/endDate, default the last 30 days. net_worth_history reads them too, defaulting to 12 months. spending_anomalies reads months and finds transactions statistically large for their category -- an empty list means nothing was unusual, not a problem. month_comparison reads month and covers income, category changes, net worth and investments.",
            ),
          startDate: z
            .string()
            .max(10)
            .optional()
            .describe("Start date. See `type` for the per-report default."),
          endDate: z
            .string()
            .max(10)
            .optional()
            .describe("End date. Defaults to today."),
          months: numberArg(z.number().min(1).max(24))
            .optional()
            .describe("spending_anomalies: months of history. Default 3."),
          month: z
            .string()
            .max(7)
            .optional()
            .describe(
              "month_comparison: YYYY-MM. Defaults to the previous complete month.",
            ),
        }),
        outputSchema: generateReportOutput,
      },
      async (args, ctx) => {
        const user = resolveUserContext(ctx);
        if (!user) return toolError("No user context");
        const check = requireScope(user.scopes, "read");
        if (check.error) return check.result;

        try {
          if (args.type === "spending_anomalies") {
            const data = await this.reportsService.getSpendingAnomalies(
              user.userId,
              args.months ?? 3,
            );
            return toolResult(data);
          }
          if (args.type === "month_comparison") {
            const data = await this.reportsService.getMonthlyComparison(
              user.userId,
              args.month ?? getDefaultPreviousMonth(),
            );
            return toolResult(data);
          }
          if (args.type === "net_worth_history") {
            // Dates omitted -> getLlmHistory defaults to the last 12 months.
            const data = await this.netWorthService.getLlmHistory(
              user.userId,
              args.startDate,
              args.endDate,
            );
            return toolResult(data);
          }

          const defaults = getDefaultDateRange();
          const startDate = args.startDate ?? defaults.startDate;
          const endDate = args.endDate ?? defaults.endDate;
          let data: any;
          switch (args.type) {
            case "spending_by_category":
              data = await this.reportsService.getSpendingByCategory(
                user.userId,
                startDate,
                endDate,
              );
              break;
            case "spending_by_payee":
              data = await this.reportsService.getSpendingByPayee(
                user.userId,
                startDate,
                endDate,
              );
              break;
            case "income_vs_expenses":
              data = await this.reportsService.getIncomeVsExpenses(
                user.userId,
                startDate,
                endDate,
              );
              break;
            case "monthly_trend":
              data = await this.reportsService.getMonthlySpendingTrend(
                user.userId,
                startDate,
                endDate,
              );
              break;
            case "income_by_source":
              data = await this.reportsService.getIncomeBySource(
                user.userId,
                startDate,
                endDate,
              );
              break;
          }
          return toolResult(data);
        } catch (err: unknown) {
          return safeToolError(err);
        }
      },
    );
  }
}
