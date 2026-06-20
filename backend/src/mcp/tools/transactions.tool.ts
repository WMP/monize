import { Injectable } from "@nestjs/common";
import { z } from "zod";
import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { TransactionsService } from "../../transactions/transactions.service";
import { PayeesService } from "../../payees/payees.service";
import { TransactionAnalyticsService } from "../../transactions/transaction-analytics.service";
import {
  TransactionToolPrepService,
  CreateRowInput,
  TransferRowInput,
  UpdateRowInput,
} from "../../transactions/transaction-tool-prep.service";
import { AiRelayService } from "../../ai/relay/ai-relay.service";
import { AiActionBuilderService } from "../../ai/actions/ai-action-builder.service";
import { PendingAiAction } from "../../ai/actions/ai-action.types";
import { RELAY_PREVIEW_SHOWN } from "../mcp-relay-confirm";
import {
  UserContextResolver,
  requireScope,
  toolResult,
  toolError,
  safeToolError,
  confirmWrite,
} from "../mcp-context";
import { McpWriteLimiter } from "../mcp-write-limiter";
import {
  DEFAULT_TOP_N,
  getDefaultDateRange,
  resolveComparePeriods,
} from "../../common/tool-schemas";
import {
  searchTransactionsOutput,
  queryTransactionsOutput,
  getSpendingByCategoryOutput,
  getIncomeSummaryOutput,
  comparePeriodsOutput,
  getTransfersOutput,
  manageTransactionsOutput,
} from "../tool-output-schemas";
import { READ_ONLY, WRITE } from "../mcp-annotations";

type ManageOperation = "create" | "update" | "delete";
type ApprovalMode = "bulk" | "individual";

interface ManageItem {
  // create (standard)
  accountName?: string;
  // create (transfer)
  fromAccountName?: string;
  toAccountName?: string;
  // update / delete
  transactionId?: string;
  // shared
  amount?: number;
  date?: string;
  payeeName?: string;
  categoryName?: string;
  description?: string;
  createPayeeIfMissing?: boolean;
  exchangeRate?: number;
  toAmount?: number;
}

@Injectable()
export class McpTransactionsTools {
  private readonly writeLimiter = new McpWriteLimiter();

  constructor(
    private readonly transactionsService: TransactionsService,
    private readonly payeesService: PayeesService,
    private readonly analyticsService: TransactionAnalyticsService,
    private readonly relayService: AiRelayService,
    private readonly actionBuilder: AiActionBuilderService,
    private readonly prepService: TransactionToolPrepService,
  ) {}

  register(server: McpServer, resolve: UserContextResolver) {
    server.registerTool(
      "search_transactions",
      {
        title: "Search transactions",
        annotations: READ_ONLY,
        description: "Search and filter transactions",
        inputSchema: {
          query: z.string().max(200).optional().describe("Search text"),
          accountId: z
            .string()
            .uuid()
            .optional()
            .describe("Filter by account ID"),
          categoryId: z
            .string()
            .uuid()
            .optional()
            .describe("Filter by category ID"),
          payeeId: z.string().uuid().optional().describe("Filter by payee ID"),
          startDate: z
            .string()
            .max(10)
            .optional()
            .describe("Start date (YYYY-MM-DD)"),
          endDate: z
            .string()
            .max(10)
            .optional()
            .describe("End date (YYYY-MM-DD)"),
          minAmount: z
            .number()
            .min(-999999999999)
            .max(999999999999)
            .optional()
            .describe("Minimum amount"),
          maxAmount: z
            .number()
            .min(-999999999999)
            .max(999999999999)
            .optional()
            .describe("Maximum amount"),
          limit: z
            .number()
            .min(1)
            .max(100)
            .optional()
            .default(50)
            .describe("Max results (default 50, max 100)"),
        },
        outputSchema: searchTransactionsOutput,
      },
      async (args, extra) => {
        const ctx = resolve(extra.sessionId);
        if (!ctx) return toolError("No user context");
        const check = requireScope(ctx.scopes, "read");
        if (check.error) return check.result;

        try {
          // Split-expansion + amount filtering live on the domain service so
          // this tool stays a thin adapter and any AI Assistant equivalent
          // returns the same shape.
          const result = await this.transactionsService.getLlmTransactionRows(
            ctx.userId,
            {
              accountId: args.accountId,
              categoryId: args.categoryId,
              payeeId: args.payeeId,
              startDate: args.startDate,
              endDate: args.endDate,
              query: args.query,
              minAmount: args.minAmount,
              maxAmount: args.maxAmount,
              limit: args.limit,
            },
          );
          return toolResult(result);
        } catch (err: unknown) {
          return safeToolError(err);
        }
      },
    );

    server.registerTool(
      "query_transactions",
      {
        title: "Query transaction totals",
        annotations: READ_ONLY,
        description:
          "Search and aggregate transaction data. Returns totals, counts, and optional grouped breakdowns (category, payee, year, month, week) - never individual transaction details. Returns the same shape as the AI Assistant's query_transactions tool.",
        inputSchema: {
          startDate: z
            .string()
            .max(10)
            .optional()
            .describe("Start date (YYYY-MM-DD). Defaults to 30 days ago."),
          endDate: z
            .string()
            .max(10)
            .optional()
            .describe("End date (YYYY-MM-DD). Defaults to today."),
          accountIds: z
            .array(z.string().uuid())
            .max(50)
            .optional()
            .describe("Optional account IDs to filter to"),
          categoryIds: z
            .array(z.string().uuid())
            .max(100)
            .optional()
            .describe("Optional category IDs to filter to"),
          searchText: z
            .string()
            .max(200)
            .optional()
            .describe("Search payee names or transaction descriptions"),
          groupBy: z
            .enum(["category", "payee", "year", "month", "week"])
            .optional()
            .describe("How to group results for breakdown"),
          direction: z
            .enum(["expenses", "income", "both"])
            .optional()
            .describe("Filter by direction"),
        },
        outputSchema: queryTransactionsOutput,
      },
      async (args, extra) => {
        const ctx = resolve(extra.sessionId);
        if (!ctx) return toolError("No user context");
        const check = requireScope(ctx.scopes, "read");
        if (check.error) return check.result;

        try {
          const defaults = getDefaultDateRange();
          const data = await this.analyticsService.getLlmQueryTransactions(
            ctx.userId,
            {
              startDate: args.startDate ?? defaults.startDate,
              endDate: args.endDate ?? defaults.endDate,
              accountIds: args.accountIds,
              categoryIds: args.categoryIds,
              searchText: args.searchText,
              groupBy: args.groupBy,
              direction: args.direction,
            },
          );
          return toolResult(data);
        } catch (err: unknown) {
          return safeToolError(err);
        }
      },
    );

    server.registerTool(
      "get_spending_by_category",
      {
        title: "Spending by category",
        annotations: READ_ONLY,
        description:
          "Spending breakdown by category for a date range. Returns each category with total amount, percentage of total spending, and transaction count. Sorted by amount descending. Returns the same shape as the AI Assistant's get_spending_by_category tool.",
        inputSchema: {
          startDate: z
            .string()
            .max(10)
            .optional()
            .describe("Start date (YYYY-MM-DD). Defaults to 30 days ago."),
          endDate: z
            .string()
            .max(10)
            .optional()
            .describe("End date (YYYY-MM-DD). Defaults to today."),
          topN: z
            .number()
            .int()
            .min(1)
            .max(50)
            .optional()
            .describe(
              `Limit to top N categories by amount. Defaults to ${DEFAULT_TOP_N}.`,
            ),
        },
        outputSchema: getSpendingByCategoryOutput,
      },
      async (args, extra) => {
        const ctx = resolve(extra.sessionId);
        if (!ctx) return toolError("No user context");
        const check = requireScope(ctx.scopes, "read");
        if (check.error) return check.result;

        try {
          const defaults = getDefaultDateRange();
          const data = await this.analyticsService.getLlmSpendingByCategory(
            ctx.userId,
            args.startDate ?? defaults.startDate,
            args.endDate ?? defaults.endDate,
            args.topN ?? DEFAULT_TOP_N,
          );
          return toolResult(data);
        } catch (err: unknown) {
          return safeToolError(err);
        }
      },
    );

    server.registerTool(
      "get_income_summary",
      {
        title: "Income summary",
        annotations: READ_ONLY,
        description:
          "Income summary for a date range, grouped by category, payee, or month. Returns the same shape as the AI Assistant's get_income_summary tool.",
        inputSchema: {
          startDate: z
            .string()
            .max(10)
            .optional()
            .describe("Start date (YYYY-MM-DD). Defaults to 30 days ago."),
          endDate: z
            .string()
            .max(10)
            .optional()
            .describe("End date (YYYY-MM-DD). Defaults to today."),
          groupBy: z
            .enum(["category", "payee", "month"])
            .optional()
            .describe("How to group income (default: category)"),
        },
        outputSchema: getIncomeSummaryOutput,
      },
      async (args, extra) => {
        const ctx = resolve(extra.sessionId);
        if (!ctx) return toolError("No user context");
        const check = requireScope(ctx.scopes, "read");
        if (check.error) return check.result;

        try {
          const defaults = getDefaultDateRange();
          const data = await this.analyticsService.getLlmIncomeSummary(
            ctx.userId,
            args.startDate ?? defaults.startDate,
            args.endDate ?? defaults.endDate,
            args.groupBy ?? "category",
          );
          return toolResult(data);
        } catch (err: unknown) {
          return safeToolError(err);
        }
      },
    );

    server.registerTool(
      "compare_periods",
      {
        title: "Compare periods",
        annotations: READ_ONLY,
        description:
          "Compare spending or income between two time periods. Returns side-by-side comparison showing absolute and percentage changes per group. If any of the four period dates are omitted, defaults to the previous full month (period1) vs the current month-to-date (period2). Returns the same shape as the AI Assistant's compare_periods tool.",
        inputSchema: {
          period1Start: z
            .string()
            .max(10)
            .optional()
            .describe(
              "First period start (YYYY-MM-DD). Defaults to the start of last month.",
            ),
          period1End: z
            .string()
            .max(10)
            .optional()
            .describe(
              "First period end (YYYY-MM-DD). Defaults to the last day of last month.",
            ),
          period2Start: z
            .string()
            .max(10)
            .optional()
            .describe(
              "Second period start (YYYY-MM-DD). Defaults to the start of the current month.",
            ),
          period2End: z
            .string()
            .max(10)
            .optional()
            .describe("Second period end (YYYY-MM-DD). Defaults to today."),
          groupBy: z
            .enum(["category", "payee"])
            .optional()
            .describe("How to group comparison (default: category)"),
          direction: z
            .enum(["expenses", "income", "both"])
            .optional()
            .describe("Filter by direction (default: expenses)"),
        },
        outputSchema: comparePeriodsOutput,
      },
      async (args, extra) => {
        const ctx = resolve(extra.sessionId);
        if (!ctx) return toolError("No user context");
        const check = requireScope(ctx.scopes, "read");
        if (check.error) return check.result;

        try {
          const periods = resolveComparePeriods({
            period1Start: args.period1Start,
            period1End: args.period1End,
            period2Start: args.period2Start,
            period2End: args.period2End,
          });
          const data = await this.analyticsService.getLlmPeriodComparison(
            ctx.userId,
            {
              period1Start: periods.period1Start,
              period1End: periods.period1End,
              period2Start: periods.period2Start,
              period2End: periods.period2End,
              groupBy: args.groupBy,
              direction: args.direction,
            },
          );
          return toolResult(data);
        } catch (err: unknown) {
          return safeToolError(err);
        }
      },
    );

    server.registerTool(
      "get_transfers",
      {
        title: "Get transfers",
        annotations: READ_ONLY,
        description:
          "Get transfer activity between the user's own accounts for a date range. Returns per-account inbound, outbound, net, and count. Transfers are deliberately excluded from other transaction queries because they net to zero across accounts. Returns the same shape as the AI Assistant's get_transfers tool.",
        inputSchema: {
          startDate: z
            .string()
            .max(10)
            .optional()
            .describe("Start date (YYYY-MM-DD). Defaults to 30 days ago."),
          endDate: z
            .string()
            .max(10)
            .optional()
            .describe("End date (YYYY-MM-DD). Defaults to today."),
          accountIds: z
            .array(z.string().uuid())
            .max(50)
            .optional()
            .describe(
              "Optional account IDs to filter to. Omit to cover all accounts.",
            ),
        },
        outputSchema: getTransfersOutput,
      },
      async (args, extra) => {
        const ctx = resolve(extra.sessionId);
        if (!ctx) return toolError("No user context");
        const check = requireScope(ctx.scopes, "read");
        if (check.error) return check.result;

        try {
          const defaults = getDefaultDateRange();
          const result = await this.analyticsService.getTransfersByAccount(
            ctx.userId,
            args.startDate ?? defaults.startDate,
            args.endDate ?? defaults.endDate,
            args.accountIds,
          );
          return toolResult(result);
        } catch (err: unknown) {
          return safeToolError(err);
        }
      },
    );

    server.registerTool(
      "manage_transactions",
      {
        title: "Manage transactions",
        annotations: WRITE,
        description:
          "Create, update, or delete the user's cash transactions (including transfers between their own accounts). Accepts NAMES for account, category, and payee -- they are resolved internally, so you do NOT need to call get_accounts/get_categories first. operation = 'create' | 'update' | 'delete' with an items array (1-25 rows). " +
          "create (standard): { accountName, amount, date, payeeName?, categoryName?, description?, createPayeeIfMissing? } (amount positive=income, negative=expense). " +
          "create (transfer): { fromAccountName, toAccountName, amount, date, description?, payeeName?, createPayeeIfMissing?, exchangeRate?, toAmount? } -- an item is a transfer when toAccountName is present; payeeName is an optional custom label matched to an existing payee (or created if missing, like a normal transaction) and applied to both legs (omit to auto-generate 'Transfer to/from <account>'). " +
          "update: { transactionId, amount?, date?, payeeName?, categoryName?, description?, createPayeeIfMissing? } (>=1 field; a category-only change is transactionId + categoryName; transfers auto-detected; payeeName sets the transfer's custom label, matched to an existing payee or created if missing). " +
          "delete: { transactionId } (removes linked transfer legs / split children too). " +
          "approvalMode = 'bulk' (default; one confirmation for the whole batch) or 'individual' (one confirmation per item); ignored for a single item. Set dryRun=true to preview every item without saving. The user is asked to confirm before anything is saved (web chat card via relay, or an MCP confirmation dialog).",
        inputSchema: {
          operation: z
            .enum(["create", "update", "delete"])
            .describe("The operation to perform on every item."),
          items: z
            .array(
              z.object({
                accountName: z
                  .string()
                  .max(100)
                  .optional()
                  .describe("create (standard): account name."),
                fromAccountName: z
                  .string()
                  .max(100)
                  .optional()
                  .describe("create (transfer): source account name."),
                toAccountName: z
                  .string()
                  .max(100)
                  .optional()
                  .describe(
                    "create (transfer): destination account name (presence makes the item a transfer).",
                  ),
                transactionId: z
                  .string()
                  .uuid()
                  .optional()
                  .describe("update/delete: transaction ID."),
                amount: z
                  .number()
                  .min(-999999999999)
                  .max(999999999999)
                  .optional()
                  .describe(
                    "Signed amount (standard create/update) or positive transfer amount.",
                  ),
                date: z
                  .string()
                  .max(10)
                  .optional()
                  .describe("Transaction date (YYYY-MM-DD)."),
                payeeName: z
                  .string()
                  .max(100)
                  .optional()
                  .describe(
                    "Optional payee name (standard create/update; or a custom transfer label for create/update transfer). Matched to an existing payee when one exists, otherwise handled per createPayeeIfMissing. Omit (transfer) to auto-generate 'Transfer to/from <account>'.",
                  ),
                categoryName: z
                  .string()
                  .max(100)
                  .optional()
                  .describe(
                    'Optional category name (standard create/update; "Parent: Child" for a subcategory).',
                  ),
                description: z
                  .string()
                  .max(500)
                  .optional()
                  .describe("Optional description or memo."),
                createPayeeIfMissing: z
                  .boolean()
                  .optional()
                  .describe(
                    "When the payee name matches no existing payee, create a new payee (default true) or keep as free text (false). Applies to standard and transfer create/update.",
                  ),
                exchangeRate: z
                  .number()
                  .min(0)
                  .max(1_000_000)
                  .optional()
                  .describe(
                    "create (transfer): exchange rate for a cross-currency transfer.",
                  ),
                toAmount: z
                  .number()
                  .min(-999999999999)
                  .max(999999999999)
                  .optional()
                  .describe(
                    "create (transfer): explicit destination amount (overrides exchangeRate).",
                  ),
              }),
            )
            .min(1)
            .max(25)
            .describe("The rows to act on (1-25)."),
          approvalMode: z
            .enum(["bulk", "individual"])
            .optional()
            .describe(
              "How multi-item batches are approved: 'bulk' (default) one card for all; 'individual' one card per item. Ignored for a single item.",
            ),
          dryRun: z
            .boolean()
            .optional()
            .default(false)
            .describe(
              "If true, validate and return a per-item preview without saving anything.",
            ),
        },
        outputSchema: manageTransactionsOutput,
      },
      async (args, extra) => {
        const ctx = resolve(extra.sessionId);
        if (!ctx) return toolError("No user context");
        const check = requireScope(ctx.scopes, "write");
        if (check.error) return check.result;

        const operation = args.operation as ManageOperation;
        const items = args.items as ManageItem[];
        const approvalMode = (args.approvalMode ?? "bulk") as ApprovalMode;

        try {
          if (args.dryRun) {
            return this.manageDryRun(ctx.userId, operation, items);
          }
          if (operation === "create") {
            return await this.manageCreate(
              server,
              ctx.userId,
              items,
              approvalMode,
              extra.requestId,
            );
          }
          if (operation === "update") {
            return await this.manageUpdate(
              server,
              ctx.userId,
              items,
              approvalMode,
              extra.requestId,
            );
          }
          return await this.manageDelete(
            server,
            ctx.userId,
            items,
            approvalMode,
            extra.requestId,
          );
        } catch (err: unknown) {
          return safeToolError(err);
        }
      },
    );
  }

  // -------------------------------------------------------------------------
  // manage_transactions helpers
  // -------------------------------------------------------------------------

  private isTransferItem(item: ManageItem): boolean {
    return item.toAccountName !== undefined;
  }

  private toCreateRow(item: ManageItem): CreateRowInput {
    return {
      accountName: item.accountName as string,
      amount: item.amount as number,
      date: item.date as string,
      payeeName: item.payeeName,
      categoryName: item.categoryName,
      description: item.description,
      createPayeeIfMissing: item.createPayeeIfMissing,
    };
  }

  private toTransferRow(item: ManageItem): TransferRowInput {
    return {
      fromAccountName: item.fromAccountName as string,
      toAccountName: item.toAccountName as string,
      amount: item.amount as number,
      date: item.date as string,
      description: item.description,
      payeeName: item.payeeName,
      createPayeeIfMissing: item.createPayeeIfMissing,
      exchangeRate: item.exchangeRate,
      toAmount: item.toAmount,
    };
  }

  /**
   * Resolve the final payee id for a transfer preview/descriptor, mirroring the
   * normal cash-transaction flow: use the matched id, otherwise find-or-create
   * from the custom label when opted in. Returns undefined when no payee should
   * be linked.
   */
  private async resolveTransferPayeeId(
    userId: string,
    src: {
      payeeId: string | null;
      payeeName: string | null;
      payeeWillBeCreated?: boolean;
      createPayee?: boolean;
    },
  ): Promise<string | undefined> {
    let payeeId = src.payeeId ?? undefined;
    const shouldCreate = src.payeeWillBeCreated ?? src.createPayee ?? false;
    if (!payeeId && shouldCreate && src.payeeName) {
      const payee = await this.payeesService.findOrCreate(
        userId,
        src.payeeName,
      );
      payeeId = payee.id;
    }
    return payeeId;
  }

  private toUpdateRow(item: ManageItem): UpdateRowInput {
    return {
      transactionId: item.transactionId as string,
      amount: item.amount,
      date: item.date,
      payeeName: item.payeeName,
      categoryName: item.categoryName,
      description: item.description,
      createPayeeIfMissing: item.createPayeeIfMissing,
    };
  }

  /**
   * Reserve N writes against the daily cap or return an error result. Returns
   * undefined when allowed.
   */
  private checkWriteBudget(userId: string, count: number) {
    const limitCheck = this.writeLimiter.checkLimit(userId);
    if (limitCheck.currentCount + count > limitCheck.limit) {
      return toolError(
        `Daily write limit reached (${limitCheck.limit} operations per day). Try again tomorrow.`,
      );
    }
    return undefined;
  }

  /** Dry-run preview for every item without writing. */
  private async manageDryRun(
    userId: string,
    operation: ManageOperation,
    items: ManageItem[],
  ) {
    if (operation === "create") {
      const std = await this.prepService.prepareCreate(
        userId,
        items
          .filter((i) => !this.isTransferItem(i))
          .map((i) => this.toCreateRow(i)),
      );
      const xfer = await this.prepService.prepareCreateTransfer(
        userId,
        items
          .filter((i) => this.isTransferItem(i))
          .map((i) => this.toTransferRow(i)),
      );
      return toolResult({
        dryRun: true,
        operation,
        previews: [...std.previewRows, ...xfer.previewRows],
        skipped: [...std.skipped, ...xfer.skipped],
        message:
          "This is a preview. Call again with dryRun=false to apply the changes.",
      });
    }
    if (operation === "update") {
      const bulk = await this.prepService.prepareUpdateBulk(
        userId,
        items.map((i) => this.toUpdateRow(i)),
      );
      return toolResult({
        dryRun: true,
        operation,
        previews: bulk.previewRows,
        skipped: bulk.skipped,
        message:
          "This is a preview. Call again with dryRun=false to apply the changes.",
      });
    }
    const bulk = await this.prepService.prepareDeleteBulk(
      userId,
      items.map((i) => i.transactionId as string),
    );
    return toolResult({
      dryRun: true,
      operation,
      previews: bulk.previewRows,
      skipped: bulk.skipped,
      message:
        "This is a preview. Call again with dryRun=false to delete the transactions.",
    });
  }

  /**
   * Relay-first then confirmWrite for a single signed card. Returns the relay
   * result when handled there, otherwise the elicitation outcome.
   */
  private async emitOrConfirm(
    server: McpServer,
    userId: string,
    pendingAction: PendingAiAction,
    confirmMessage: string,
    requestId: unknown,
  ): Promise<"relay" | "accepted" | "declined"> {
    if (this.relayService.emitPendingAction(userId, pendingAction)) {
      return "relay";
    }
    const confirmation = await confirmWrite(
      server,
      confirmMessage,
      requestId as never,
    );
    return confirmation === "declined" ? "declined" : "accepted";
  }

  private async manageCreate(
    server: McpServer,
    userId: string,
    items: ManageItem[],
    approvalMode: ApprovalMode,
    requestId: unknown,
  ) {
    const single = items.length === 1;
    const standardItems = items.filter((i) => !this.isTransferItem(i));
    const transferItems = items.filter((i) => this.isTransferItem(i));

    const std = await this.prepService.prepareCreate(
      userId,
      standardItems.map((i) => this.toCreateRow(i)),
    );
    const xfer = await this.prepService.prepareCreateTransfer(
      userId,
      transferItems.map((i) => this.toTransferRow(i)),
    );

    const okCount = std.okPreviews.length + xfer.okPreviews.length;
    if (okCount === 0) {
      return toolError(
        "None of the transactions could be prepared. Check the account, category, and date for each row.",
      );
    }

    const budget = this.checkWriteBudget(userId, okCount);
    if (budget) return budget;

    if (single) {
      if (std.okPreviews.length === 1) {
        const preview = std.okPreviews[0];
        const action = this.actionBuilder.buildCreateTransaction(
          userId,
          preview,
        );
        const outcome = await this.emitOrConfirm(
          server,
          userId,
          action,
          `Create this transaction?\nAccount: ${preview.accountName}\nAmount: ${preview.amount} ${preview.currencyCode}\nDate: ${preview.transactionDate}`,
          requestId,
        );
        if (outcome === "relay") return toolResult(RELAY_PREVIEW_SHOWN);
        if (outcome === "declined")
          return toolError(
            "Cancelled: the confirmation was declined, so no transaction was created.",
          );
        const tx = await this.transactionsService.create(
          userId,
          {
            accountId: preview.accountId,
            amount: preview.amount,
            transactionDate: preview.transactionDate,
            payeeId: preview.payeeId ?? undefined,
            payeeName: preview.payeeName ?? undefined,
            categoryId: preview.categoryId ?? undefined,
            description: preview.description ?? undefined,
            currencyCode: preview.currencyCode,
          },
          { createPayeeIfMissing: std.okCreatePayee[0] },
        );
        this.writeLimiter.record(userId, "create_transaction");
        return toolResult({ id: tx.id, date: tx.transactionDate, count: 1 });
      }
      // single transfer
      const preview = xfer.okPreviews[0];
      const action = this.actionBuilder.buildCreateTransfer(userId, preview);
      const outcome = await this.emitOrConfirm(
        server,
        userId,
        action,
        `Create this transfer?\nFrom: ${preview.fromAccountName}\nTo: ${preview.toAccountName}\nAmount: ${preview.amount} ${preview.fromCurrencyCode}\nDate: ${preview.transactionDate}`,
        requestId,
      );
      if (outcome === "relay") return toolResult(RELAY_PREVIEW_SHOWN);
      if (outcome === "declined")
        return toolError(
          "Cancelled: the confirmation was declined, so no transfer was created.",
        );
      const payeeId = await this.resolveTransferPayeeId(userId, preview);
      const result = await this.transactionsService.createTransfer(userId, {
        fromAccountId: preview.fromAccountId,
        toAccountId: preview.toAccountId,
        transactionDate: preview.transactionDate,
        amount: preview.amount,
        fromCurrencyCode: preview.fromCurrencyCode,
        toCurrencyCode: preview.toCurrencyCode,
        exchangeRate: preview.exchangeRate,
        toAmount: preview.toAmount,
        description: preview.description ?? undefined,
        payeeId,
        payeeName: preview.payeeName ?? undefined,
      });
      this.writeLimiter.record(userId, "create_transfer");
      return toolResult({ id: result.fromTransaction.id, count: 1 });
    }

    if (approvalMode === "individual") {
      const cards: PendingAiAction[] = [
        ...std.okPreviews.map((p) =>
          this.actionBuilder.buildCreateTransaction(userId, p),
        ),
        ...xfer.okPreviews.map((p) =>
          this.actionBuilder.buildCreateTransfer(userId, p),
        ),
      ];
      return this.runIndividual(server, userId, cards, requestId, [
        ...std.skipped,
        ...xfer.skipped,
      ]);
    }

    // bulk mode: one card per kind that has ok rows.
    const cards: PendingAiAction[] = [];
    if (std.okPreviews.length > 0) {
      cards.push(
        this.actionBuilder.buildCreateTransactions(
          userId,
          std.okPreviews,
          std.previewRows,
        ),
      );
    }
    if (xfer.okPreviews.length > 0) {
      cards.push(
        this.actionBuilder.buildBatchActions(
          userId,
          "create_transfer",
          xfer.okPreviews.map((p) => this.prepService.transferToBatchRow(p)),
          xfer.previewRows,
        ),
      );
    }
    // Relay: emit each card to the web chat.
    if (this.relayService.emitPendingAction(userId, cards[0])) {
      for (let i = 1; i < cards.length; i++) {
        this.relayService.emitPendingAction(userId, cards[i]);
      }
      return toolResult(RELAY_PREVIEW_SHOWN);
    }
    const skipped = [...std.skipped, ...xfer.skipped];
    const confirmation = await confirmWrite(
      server,
      `Create ${okCount} transaction(s)?${skipped.length ? ` (${skipped.length} skipped)` : ""}`,
      requestId as never,
    );
    if (confirmation === "declined") {
      return toolError(
        "Cancelled: the confirmation was declined, so nothing was created.",
      );
    }
    const ids: string[] = [];
    for (let i = 0; i < std.okPreviews.length; i++) {
      const preview = std.okPreviews[i];
      const tx = await this.transactionsService.create(
        userId,
        {
          accountId: preview.accountId,
          amount: preview.amount,
          transactionDate: preview.transactionDate,
          payeeId: preview.payeeId ?? undefined,
          payeeName: preview.payeeName ?? undefined,
          categoryId: preview.categoryId ?? undefined,
          description: preview.description ?? undefined,
          currencyCode: preview.currencyCode,
        },
        { createPayeeIfMissing: std.okCreatePayee[i] },
      );
      ids.push(tx.id);
      this.writeLimiter.record(userId, "create_transaction");
    }
    for (const preview of xfer.okPreviews) {
      const payeeId = await this.resolveTransferPayeeId(userId, preview);
      const result = await this.transactionsService.createTransfer(userId, {
        fromAccountId: preview.fromAccountId,
        toAccountId: preview.toAccountId,
        transactionDate: preview.transactionDate,
        amount: preview.amount,
        fromCurrencyCode: preview.fromCurrencyCode,
        toCurrencyCode: preview.toCurrencyCode,
        exchangeRate: preview.exchangeRate,
        toAmount: preview.toAmount,
        description: preview.description ?? undefined,
        payeeId,
        payeeName: preview.payeeName ?? undefined,
      });
      ids.push(result.fromTransaction.id);
      this.writeLimiter.record(userId, "create_transfer");
    }
    return toolResult({ ids, count: ids.length, skipped });
  }

  private async manageUpdate(
    server: McpServer,
    userId: string,
    items: ManageItem[],
    approvalMode: ApprovalMode,
    requestId: unknown,
  ) {
    const single = items.length === 1;

    if (single) {
      const result = await this.prepService.prepareUpdate(
        userId,
        this.toUpdateRow(items[0]),
      );
      const budget = this.checkWriteBudget(userId, 1);
      if (budget) return budget;
      if (result.kind === "transfer") {
        const preview = result.preview;
        const action = this.actionBuilder.buildUpdateTransfer(userId, preview);
        const outcome = await this.emitOrConfirm(
          server,
          userId,
          action,
          `Apply this transfer edit?\nFrom: ${preview.fromAccountName}\nTo: ${preview.toAccountName}\nAmount: ${preview.amount} ${preview.fromCurrencyCode}\nDate: ${preview.transactionDate}`,
          requestId,
        );
        if (outcome === "relay") return toolResult(RELAY_PREVIEW_SHOWN);
        if (outcome === "declined")
          return toolError(
            "Cancelled: the confirmation was declined, so the transfer was not changed.",
          );
        const payeeId = await this.resolveTransferPayeeId(userId, preview);
        const r = await this.transactionsService.updateTransfer(
          userId,
          preview.transactionId,
          {
            amount: preview.amount,
            transactionDate: preview.transactionDate,
            exchangeRate: preview.exchangeRate,
            toAmount: preview.toAmount,
            description: preview.description ?? undefined,
            payeeId,
            payeeName: preview.payeeName ?? undefined,
          },
        );
        this.writeLimiter.record(userId, "update_transfer");
        return toolResult({ id: r.fromTransaction.id, count: 1 });
      }
      const preview = result.preview;
      const action = this.actionBuilder.buildUpdateTransaction(userId, preview);
      const outcome = await this.emitOrConfirm(
        server,
        userId,
        action,
        `Apply this transaction edit?\nAccount: ${preview.accountName}\nAmount: ${preview.amount} ${preview.currencyCode}\nDate: ${preview.transactionDate}`,
        requestId,
      );
      if (outcome === "relay") return toolResult(RELAY_PREVIEW_SHOWN);
      if (outcome === "declined")
        return toolError(
          "Cancelled: the confirmation was declined, so the transaction was not changed.",
        );
      const tx = await this.transactionsService.update(
        userId,
        preview.transactionId,
        {
          amount: preview.amount,
          transactionDate: preview.transactionDate,
          payeeId: preview.payeeId ?? undefined,
          payeeName: preview.payeeName ?? undefined,
          categoryId: preview.categoryId ?? undefined,
          description: preview.description ?? undefined,
          currencyCode: preview.currencyCode,
        },
        { createPayeeIfMissing: result.createPayee },
      );
      this.writeLimiter.record(userId, "update_transaction");
      return toolResult({ id: tx.id, count: 1 });
    }

    if (approvalMode === "individual") {
      const cards: PendingAiAction[] = [];
      const skipped: { index: number; reason: string }[] = [];
      for (let i = 0; i < items.length; i++) {
        try {
          const result = await this.prepService.prepareUpdate(
            userId,
            this.toUpdateRow(items[i]),
          );
          cards.push(
            result.kind === "transfer"
              ? this.actionBuilder.buildUpdateTransfer(userId, result.preview)
              : this.actionBuilder.buildUpdateTransaction(
                  userId,
                  result.preview,
                ),
          );
        } catch (err) {
          skipped.push({ index: i, reason: this.reason(err) });
        }
      }
      if (cards.length === 0)
        return toolError("None of the transaction edits could be prepared.");
      const budget = this.checkWriteBudget(userId, cards.length);
      if (budget) return budget;
      return this.runIndividual(server, userId, cards, requestId, skipped);
    }

    // bulk mode
    const bulk = await this.prepService.prepareUpdateBulk(
      userId,
      items.map((i) => this.toUpdateRow(i)),
    );
    if (bulk.okRows.length === 0)
      return toolError("None of the transaction edits could be prepared.");
    const budget = this.checkWriteBudget(userId, bulk.okRows.length);
    if (budget) return budget;
    const action = this.actionBuilder.buildBatchActions(
      userId,
      "update",
      bulk.okRows,
      bulk.previewRows,
    );
    if (this.relayService.emitPendingAction(userId, action)) {
      return toolResult(RELAY_PREVIEW_SHOWN);
    }
    const confirmation = await confirmWrite(
      server,
      `Apply ${bulk.okRows.length} transaction edit(s)?${bulk.skipped.length ? ` (${bulk.skipped.length} skipped)` : ""}`,
      requestId as never,
    );
    if (confirmation === "declined")
      return toolError(
        "Cancelled: the confirmation was declined, so nothing was changed.",
      );
    const ids: string[] = [];
    for (const row of bulk.okRows) {
      const tx = await this.transactionsService.update(
        userId,
        row.transactionId,
        {
          amount: row.amount,
          transactionDate: row.transactionDate,
          payeeId: row.payeeId ?? undefined,
          payeeName: row.payeeName ?? undefined,
          categoryId: row.categoryId ?? undefined,
          description: row.description ?? undefined,
          currencyCode: row.currencyCode,
        },
        { createPayeeIfMissing: row.createPayee === true },
      );
      ids.push(tx.id);
      this.writeLimiter.record(userId, "update_transaction");
    }
    return toolResult({ ids, count: ids.length, skipped: bulk.skipped });
  }

  private async manageDelete(
    server: McpServer,
    userId: string,
    items: ManageItem[],
    approvalMode: ApprovalMode,
    requestId: unknown,
  ) {
    const single = items.length === 1;

    if (single) {
      const preview = await this.prepService.prepareDelete(
        userId,
        items[0].transactionId as string,
      );
      const budget = this.checkWriteBudget(userId, 1);
      if (budget) return budget;
      const action = this.actionBuilder.buildDeleteTransaction(userId, preview);
      const outcome = await this.emitOrConfirm(
        server,
        userId,
        action,
        `Delete this transaction?\nAccount: ${preview.accountName}\nAmount: ${preview.amount} ${preview.currencyCode}\nDate: ${preview.transactionDate}`,
        requestId,
      );
      if (outcome === "relay") return toolResult(RELAY_PREVIEW_SHOWN);
      if (outcome === "declined")
        return toolError(
          "Cancelled: the confirmation was declined, so the transaction was not deleted.",
        );
      await this.transactionsService.removeAny(userId, preview.transactionId);
      this.writeLimiter.record(userId, "delete_transaction");
      return toolResult({ id: preview.transactionId, deleted: true, count: 1 });
    }

    if (approvalMode === "individual") {
      const cards: PendingAiAction[] = [];
      const skipped: { index: number; reason: string }[] = [];
      for (let i = 0; i < items.length; i++) {
        try {
          const preview = await this.prepService.prepareDelete(
            userId,
            items[i].transactionId as string,
          );
          cards.push(
            this.actionBuilder.buildDeleteTransaction(userId, preview),
          );
        } catch (err) {
          skipped.push({ index: i, reason: this.reason(err) });
        }
      }
      if (cards.length === 0)
        return toolError("None of the transactions could be prepared.");
      const budget = this.checkWriteBudget(userId, cards.length);
      if (budget) return budget;
      return this.runIndividual(server, userId, cards, requestId, skipped);
    }

    const bulk = await this.prepService.prepareDeleteBulk(
      userId,
      items.map((i) => i.transactionId as string),
    );
    if (bulk.okRows.length === 0)
      return toolError("None of the transactions could be prepared.");
    const budget = this.checkWriteBudget(userId, bulk.okRows.length);
    if (budget) return budget;
    const action = this.actionBuilder.buildBatchActions(
      userId,
      "delete",
      bulk.okRows,
      bulk.previewRows,
    );
    if (this.relayService.emitPendingAction(userId, action)) {
      return toolResult(RELAY_PREVIEW_SHOWN);
    }
    const confirmation = await confirmWrite(
      server,
      `Delete ${bulk.okRows.length} transaction(s)?${bulk.skipped.length ? ` (${bulk.skipped.length} skipped)` : ""}`,
      requestId as never,
    );
    if (confirmation === "declined")
      return toolError(
        "Cancelled: the confirmation was declined, so nothing was deleted.",
      );
    const ids: string[] = [];
    for (const row of bulk.okRows) {
      await this.transactionsService.removeAny(userId, row.transactionId);
      ids.push(row.transactionId);
      this.writeLimiter.record(userId, "delete_transaction");
    }
    return toolResult({ ids, count: ids.length, skipped: bulk.skipped });
  }

  /**
   * Individual mode: emit/confirm one card per item. Relay path emits every
   * card to the web chat; non-relay confirms+writes each one in turn.
   */
  private async runIndividual(
    server: McpServer,
    userId: string,
    cards: PendingAiAction[],
    requestId: unknown,
    skipped: { index: number; reason: string }[],
  ) {
    // Relay path: emit each card; the browser confirms+commits each.
    if (this.relayService.emitPendingAction(userId, cards[0])) {
      for (let i = 1; i < cards.length; i++) {
        this.relayService.emitPendingAction(userId, cards[i]);
      }
      return toolResult(RELAY_PREVIEW_SHOWN);
    }
    const ids: string[] = [];
    for (const card of cards) {
      const confirmation = await confirmWrite(
        server,
        this.confirmLineFor(card),
        requestId as never,
      );
      if (confirmation === "declined") continue;
      const id = await this.commitCard(userId, card);
      if (id) ids.push(id);
    }
    return toolResult({ ids, count: ids.length, skipped });
  }

  private confirmLineFor(card: PendingAiAction): string {
    const p = card.preview;
    switch (card.type) {
      case "create_transfer":
      case "update_transfer":
        return `${card.type === "create_transfer" ? "Create" : "Edit"} transfer?\nFrom: ${p.fromAccountName}\nTo: ${p.toAccountName}\nAmount: ${p.amount} ${p.currencyCode}`;
      case "delete_transaction":
        return `Delete this transaction?\nAccount: ${p.accountName}`;
      case "update_transaction":
        return `Apply this transaction edit?\nAccount: ${p.accountName}\nAmount: ${p.amount} ${p.currencyCode}`;
      default:
        return `Create this transaction?\nAccount: ${p.accountName}\nAmount: ${p.amount} ${p.currencyCode}`;
    }
  }

  /** Commit one signed card directly (non-relay individual mode). */
  private async commitCard(
    userId: string,
    card: PendingAiAction,
  ): Promise<string | null> {
    const d = card.descriptor;
    switch (d.type) {
      case "create_transaction": {
        const tx = await this.transactionsService.create(
          userId,
          {
            accountId: d.accountId,
            amount: d.amount,
            transactionDate: d.transactionDate,
            payeeId: d.payeeId ?? undefined,
            payeeName: d.payeeName ?? undefined,
            categoryId: d.categoryId ?? undefined,
            description: d.description ?? undefined,
            currencyCode: d.currencyCode,
          },
          { createPayeeIfMissing: d.createPayee === true },
        );
        this.writeLimiter.record(userId, "create_transaction");
        return tx.id;
      }
      case "create_transfer": {
        const payeeId = await this.resolveTransferPayeeId(userId, d);
        const r = await this.transactionsService.createTransfer(userId, {
          fromAccountId: d.fromAccountId,
          toAccountId: d.toAccountId,
          transactionDate: d.transactionDate,
          amount: d.amount,
          fromCurrencyCode: d.fromCurrencyCode,
          toCurrencyCode: d.toCurrencyCode,
          exchangeRate: d.exchangeRate,
          toAmount: d.toAmount,
          description: d.description ?? undefined,
          payeeId,
          payeeName: d.payeeName ?? undefined,
        });
        this.writeLimiter.record(userId, "create_transfer");
        return r.fromTransaction.id;
      }
      case "update_transaction": {
        const tx = await this.transactionsService.update(
          userId,
          d.transactionId,
          {
            amount: d.amount,
            transactionDate: d.transactionDate,
            payeeId: d.payeeId ?? undefined,
            payeeName: d.payeeName ?? undefined,
            categoryId: d.categoryId ?? undefined,
            description: d.description ?? undefined,
            currencyCode: d.currencyCode,
          },
          { createPayeeIfMissing: d.createPayee === true },
        );
        this.writeLimiter.record(userId, "update_transaction");
        return tx.id;
      }
      case "update_transfer": {
        const payeeId = await this.resolveTransferPayeeId(userId, d);
        const r = await this.transactionsService.updateTransfer(
          userId,
          d.transactionId,
          {
            amount: d.amount,
            transactionDate: d.transactionDate,
            exchangeRate: d.exchangeRate,
            toAmount: d.toAmount,
            description: d.description ?? undefined,
            payeeId,
            payeeName: d.payeeName ?? undefined,
          },
        );
        this.writeLimiter.record(userId, "update_transfer");
        return r.fromTransaction.id;
      }
      case "delete_transaction": {
        await this.transactionsService.removeAny(userId, d.transactionId);
        this.writeLimiter.record(userId, "delete_transaction");
        return d.transactionId;
      }
      default:
        return null;
    }
  }

  private reason(err: unknown): string {
    if (
      err &&
      typeof err === "object" &&
      "message" in err &&
      typeof (err as { message?: unknown }).message === "string"
    ) {
      return (err as { message: string }).message;
    }
    return "Could not be prepared.";
  }
}
