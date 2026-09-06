import { Injectable } from "@nestjs/common";
import { McpServer } from "@modelcontextprotocol/server";
import { TransactionsService } from "../../transactions/transactions.service";
import { TransactionAnalyticsService } from "../../transactions/transaction-analytics.service";
import { resolveUserContext, hasScope } from "../mcp-context";
import { formatDateYMD, todayYMD } from "../../common/date-utils";

@Injectable()
export class McpRecentTransactionsResource {
  constructor(
    private readonly transactionsService: TransactionsService,
    private readonly analyticsService: TransactionAnalyticsService,
  ) {}

  register(server: McpServer) {
    server.registerResource(
      "recent-transactions",
      "monize://recent-transactions",
      {
        // Live data: a cached answer here is a stale figure, not a stale name.
        cacheHint: { ttlMs: 0, cacheScope: "private" },
        title: "Recent transactions",
        description: "Last 30 days of transactions (summarized)",
      },
      async (_uri, ctx) => {
        const user = resolveUserContext(ctx);
        if (!user) {
          return {
            contents: [
              {
                uri: "monize://recent-transactions",
                text: "Error: No user context",
              },
            ],
          };
        }
        if (!hasScope(user.scopes, "read")) {
          return {
            contents: [
              {
                uri: "monize://recent-transactions",
                text: 'Error: Insufficient scope. Requires "read" scope.',
              },
            ],
          };
        }

        try {
          const endDate = todayYMD();
          const startDate = new Date();
          startDate.setDate(startDate.getDate() - 30);
          const startDateStr = formatDateYMD(startDate);

          const [result, summary] = await Promise.all([
            this.transactionsService.findAll(
              user.userId,
              undefined,
              startDateStr,
              endDate,
              undefined,
              undefined,
              1,
              100,
            ),
            // Exclude investment-linked cash transactions so BUY/SELL/
            // DIVIDEND side-effects don't skew the MCP "recent activity"
            // summary with uncategorised spending/income.
            this.analyticsService.getSummary(
              user.userId,
              undefined,
              startDateStr,
              endDate,
              undefined,
              undefined,
              undefined,
              undefined,
              undefined,
              true,
            ),
          ]);

          return {
            contents: [
              {
                uri: "monize://recent-transactions",
                mimeType: "application/json",
                text: JSON.stringify(
                  {
                    period: { startDate: startDateStr, endDate },
                    summary,
                    // Expand split transactions so each split appears as its
                    // own row with its real category. Split parents have
                    // categoryId NULL by design; returning the parent would
                    // make the AI treat the transaction as uncategorized.
                    recentTransactions: result.data
                      .slice(0, 50)
                      .flatMap((t: any) =>
                        t.isSplit &&
                        Array.isArray(t.splits) &&
                        t.splits.length > 0
                          ? t.splits.map((s: any) => ({
                              date: t.transactionDate,
                              payeeName: t.payeeName,
                              categoryName: s.category?.name,
                              amount: Number(s.amount),
                              accountName: t.account?.name,
                              isSplit: true,
                            }))
                          : [
                              {
                                date: t.transactionDate,
                                payeeName: t.payeeName,
                                categoryName: t.category?.name,
                                amount: Number(t.amount),
                                accountName: t.account?.name,
                              },
                            ],
                      ),
                    total: result.pagination.total,
                  },
                  null,
                  2,
                ),
              },
            ],
          };
        } catch {
          return {
            contents: [
              {
                uri: "monize://recent-transactions",
                text: "Error: An error occurred while loading recent transactions",
              },
            ],
          };
        }
      },
    );
  }
}
