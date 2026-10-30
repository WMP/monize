import { SharedReviewService } from "../../shared-expenses/shared-review.service";
import { Injectable } from "@nestjs/common";
import { z } from "zod";
import { McpServer } from "@modelcontextprotocol/server";
import { BuiltInReportsService } from "../../built-in-reports/built-in-reports.service";
import {
  resolveUserContext,
  requireScope,
  toolResult,
  toolError,
  safeToolError,
} from "../mcp-context";
import { numberArg } from "../../common/tool-schemas";
import { REPORT_TOOL_TYPES } from "../../built-in-reports/report-tool.types";
import { generateReportOutput } from "../tool-output-schemas";
import { READ_ONLY } from "../mcp-annotations";

@Injectable()
export class McpReportsTools {
  constructor(
    private readonly sharedReview: SharedReviewService,
    private readonly reportsService: BuiltInReportsService,
  ) {}

  register(server: McpServer) {
    server.registerTool(
      "generate_report",
      {
        title: "Generate report",
        annotations: READ_ONLY,
        description:
          "Financial aggregates: prefer over list_transactions for breakdowns, " +
          "anomalies and month comparisons. See `type` for date parameters; " +
          "use compare_periods for arbitrary date ranges. Anomalies are cash-only.",
        inputSchema: z.object({
          basis: z
            .enum(["cash", "accrual"])
            .optional()
            .describe("Omit for your reporting preference."),
          type: z
            .enum(REPORT_TOOL_TYPES)
            .describe(
              "The five totals reports use startDate/endDate (default last 30 days); net_worth_history uses them too (default 12 months). spending_anomalies uses months to find transactions statistically large for their category; an empty list means no anomalies. month_comparison uses month and covers income, category changes, net worth and investments.",
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
            .describe("spending_anomalies: months of history. Default 6."),
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
          const data = await this.reportsService.getLlmReport(
            user.userId,
            args,
          );
          return toolResult(
            await this.sharedReview.annotate(user.userId, data.result),
          );
        } catch (err: unknown) {
          return safeToolError(err);
        }
      },
    );
  }
}
