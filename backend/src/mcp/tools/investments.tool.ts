import { Injectable } from "@nestjs/common";
import { z } from "zod";
import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { PortfolioService } from "../../securities/portfolio.service";
import { HoldingsService } from "../../securities/holdings.service";
import { SecuritiesService } from "../../securities/securities.service";
import {
  InvestmentTransactionsService,
  LlmCapitalGainsGroupBy,
  LlmInvestmentTxGroupBy,
} from "../../securities/investment-transactions.service";
import { InvestmentAction } from "../../securities/entities/investment-transaction.entity";
import {
  SECURITY_EXCHANGES,
  SECURITY_TYPES,
} from "../../securities/security-enums";
import { AiRelayService } from "../../ai/relay/ai-relay.service";
import {
  AiActionBuilderService,
  investmentPreviewRow,
} from "../../ai/actions/ai-action-builder.service";
import {
  AiActionPreviewRow,
  MAX_BULK_ACTION_ROWS,
} from "../../ai/actions/ai-action.types";
import { BulkCreateSkip, bulkSkipReason } from "../../common/bulk-create.types";
import { CreateInvestmentTransactionPreview } from "../../securities/investment-transactions.service";
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
  getPortfolioSummaryOutput,
  queryInvestmentTransactionsOutput,
  getCapitalGainsOutput,
  getHoldingDetailsOutput,
  createSecurityOutput,
  createInvestmentTransactionOutput,
  createInvestmentTransactionsOutput,
} from "../tool-output-schemas";
import { READ_ONLY, CREATE } from "../mcp-annotations";

@Injectable()
export class McpInvestmentsTools {
  private readonly writeLimiter = new McpWriteLimiter();

  constructor(
    private readonly portfolioService: PortfolioService,
    private readonly holdingsService: HoldingsService,
    private readonly investmentTransactionsService: InvestmentTransactionsService,
    private readonly securitiesService: SecuritiesService,
    private readonly relayService: AiRelayService,
    private readonly actionBuilder: AiActionBuilderService,
  ) {}

  register(server: McpServer, resolve: UserContextResolver) {
    server.registerTool(
      "get_portfolio_summary",
      {
        title: "Portfolio summary",
        annotations: READ_ONLY,
        description:
          "Get investment portfolio overview with holdings, gains/losses, and allocation. Returns the same compact, LLM-friendly shape as the AI Assistant's tool.",
        inputSchema: {
          accountIds: z
            .array(z.string().uuid())
            .max(50)
            .optional()
            .describe(
              "Optional investment account IDs to filter to. Omit to cover all investment accounts.",
            ),
        },
        outputSchema: getPortfolioSummaryOutput,
      },
      async (args, extra) => {
        const ctx = resolve(extra.sessionId);
        if (!ctx) return toolError("No user context");
        const check = requireScope(ctx.scopes, "read");
        if (check.error) return check.result;

        try {
          const summary = await this.portfolioService.getLlmSummary(
            ctx.userId,
            args.accountIds,
          );
          return toolResult(summary);
        } catch (err: unknown) {
          return safeToolError(err);
        }
      },
    );

    server.registerTool(
      "query_investment_transactions",
      {
        title: "Query investment transactions",
        annotations: READ_ONLY,
        description:
          "Query brokerage investment-account transactions (buys, sells, dividends, interest, capital gains, splits, transfers, reinvestments, share adjustments). Filter by account, security symbol, action, and date; optionally group by account, date, security, or action. Returns the same compact, LLM-friendly shape as the AI Assistant's tool.",
        inputSchema: {
          startDate: z
            .string()
            .max(10)
            .optional()
            .describe("Optional start date (YYYY-MM-DD)"),
          endDate: z
            .string()
            .max(10)
            .optional()
            .describe("Optional end date (YYYY-MM-DD)"),
          accountIds: z
            .array(z.string().uuid())
            .max(50)
            .optional()
            .describe("Optional investment account IDs."),
          symbols: z
            .array(z.string().min(1).max(20))
            .max(50)
            .optional()
            .describe("Optional security ticker symbols (case insensitive)."),
          actions: z
            .array(z.nativeEnum(InvestmentAction))
            .max(11)
            .optional()
            .describe(
              "Optional transaction types (BUY, SELL, DIVIDEND, INTEREST, CAPITAL_GAIN, SPLIT, TRANSFER_IN, TRANSFER_OUT, REINVEST, ADD_SHARES, REMOVE_SHARES).",
            ),
          groupBy: z
            .enum(["account", "date", "security", "action"])
            .optional()
            .describe(
              "Grouping: by account name, transaction date, security symbol, or action type. Defaults to 'security' when omitted.",
            ),
        },
        outputSchema: queryInvestmentTransactionsOutput,
      },
      async (args, extra) => {
        const ctx = resolve(extra.sessionId);
        if (!ctx) return toolError("No user context");
        const check = requireScope(ctx.scopes, "read");
        if (check.error) return check.result;

        try {
          const result =
            await this.investmentTransactionsService.getLlmInvestmentTransactions(
              ctx.userId,
              {
                startDate: args.startDate,
                endDate: args.endDate,
                accountIds: args.accountIds,
                symbols: args.symbols,
                actions: args.actions,
                groupBy:
                  (args.groupBy as LlmInvestmentTxGroupBy | undefined) ??
                  "security",
              },
            );
          return toolResult(result);
        } catch (err: unknown) {
          return safeToolError(err);
        }
      },
    );

    server.registerTool(
      "get_capital_gains",
      {
        title: "Capital gains",
        annotations: READ_ONLY,
        description:
          "Per-period capital gains (realized + unrealized) for the user's investment accounts. Replays transaction history and snapshots positions against historical close prices, so the output includes mark-to-market movement on currently-held positions in addition to realized SELL gains. Requires startDate and endDate. Returns the same compact, LLM-friendly shape as the AI Assistant's tool.",
        inputSchema: {
          startDate: z
            .string()
            .regex(/^\d{4}-\d{2}-\d{2}$/)
            .describe("Start date of the window (YYYY-MM-DD)"),
          endDate: z
            .string()
            .regex(/^\d{4}-\d{2}-\d{2}$/)
            .describe("End date of the window (YYYY-MM-DD)"),
          accountIds: z
            .array(z.string().uuid())
            .max(50)
            .optional()
            .describe("Optional investment account IDs."),
          symbols: z
            .array(z.string().min(1).max(20))
            .max(50)
            .optional()
            .describe("Optional security ticker symbols (case insensitive)."),
          groupBy: z
            .enum(["month", "security", "account"])
            .optional()
            .describe(
              "Bucket the breakdown by month, security, or account. Defaults to 'month' when omitted.",
            ),
        },
        outputSchema: getCapitalGainsOutput,
      },
      async (args, extra) => {
        const ctx = resolve(extra.sessionId);
        if (!ctx) return toolError("No user context");
        const check = requireScope(ctx.scopes, "read");
        if (check.error) return check.result;

        try {
          const result =
            await this.investmentTransactionsService.getLlmCapitalGains(
              ctx.userId,
              {
                startDate: args.startDate,
                endDate: args.endDate,
                accountIds: args.accountIds,
                symbols: args.symbols,
                groupBy:
                  (args.groupBy as LlmCapitalGainsGroupBy | undefined) ??
                  "month",
              },
            );
          return toolResult(result);
        } catch (err: unknown) {
          return safeToolError(err);
        }
      },
    );

    server.registerTool(
      "get_holding_details",
      {
        title: "Holding details",
        annotations: READ_ONLY,
        description: "Get details for holdings in a specific account",
        inputSchema: {
          accountId: z
            .string()
            .uuid()
            .optional()
            .describe("Account ID to filter holdings"),
        },
        outputSchema: getHoldingDetailsOutput,
      },
      async (args, extra) => {
        const ctx = resolve(extra.sessionId);
        if (!ctx) return toolError("No user context");
        const check = requireScope(ctx.scopes, "read");
        if (check.error) return check.result;

        try {
          const holdings = await this.holdingsService.findAll(
            ctx.userId,
            args.accountId,
          );
          return toolResult(holdings);
        } catch (err: unknown) {
          return safeToolError(err);
        }
      },
    );

    server.registerTool(
      "create_security",
      {
        title: "Create security",
        annotations: CREATE,
        description:
          "Add a new security (stock, ETF, mutual fund, etc.) to the user's security list. The security is looked up and validated by ticker symbol or name against the user's configured price provider, which fills in the official symbol, name, exchange, type, and currency -- do not invent those. Pass the optional `exchange` only to disambiguate a symbol that trades on several exchanges; an ambiguous lookup returns an error listing the candidates. `exchange` and `securityType` MUST come from the enumerated lists -- never guess a value outside them. Set dryRun=true to preview the resolved security without saving. When dryRun is false, the user is asked to confirm before it is saved (clients that support it show a confirmation dialog). Uses the same shared lookup/validation logic as the AI Assistant's create_security tool. Creates one security per call.",
        inputSchema: {
          query: z
            .string()
            .min(1)
            .max(100)
            .describe(
              "Ticker symbol (e.g. 'AAPL') or security name to look up and validate.",
            ),
          exchange: z
            .enum(SECURITY_EXCHANGES)
            .optional()
            .describe(
              "Optional exchange to disambiguate the lookup when a symbol trades on more than one exchange. Must be one of the enumerated values; omit to let the lookup choose.",
            ),
          securityType: z
            .enum(SECURITY_TYPES)
            .optional()
            .describe(
              "Optional security type override. Must be one of the enumerated values; omit to use the looked-up type.",
            ),
          isFavourite: z
            .boolean()
            .optional()
            .describe(
              "Pin the new security to the dashboard Favourite Securities widget. Defaults to false.",
            ),
          dryRun: z
            .boolean()
            .optional()
            .default(false)
            .describe(
              "If true, validate and return a preview without creating the security.",
            ),
        },
        outputSchema: createSecurityOutput,
      },
      async (args, extra) => {
        const ctx = resolve(extra.sessionId);
        if (!ctx) return toolError("No user context");
        const check = requireScope(ctx.scopes, "write");
        if (check.error) return check.result;

        const limitCheck = this.writeLimiter.checkLimit(ctx.userId);
        if (!limitCheck.allowed) {
          return toolError(
            `Daily write limit reached (${limitCheck.limit} operations per day). Try again tomorrow.`,
          );
        }

        try {
          // Shared lookup/validation: resolves the symbol/name against the
          // user's quote provider, fills exchange/type/currency, and enforces
          // the per-user unique symbol -- identical to the AI Assistant flow.
          const preview = await this.securitiesService.previewCreateSecurity(
            ctx.userId,
            {
              query: args.query,
              exchange: args.exchange,
              securityType: args.securityType,
              isFavourite: args.isFavourite,
            },
          );

          if (args.dryRun) {
            return toolResult({
              dryRun: true,
              preview: {
                symbol: preview.symbol,
                name: preview.name,
                securityType: preview.securityType,
                exchange: preview.exchange,
                currencyCode: preview.currencyCode,
                isFavourite: preview.isFavourite,
                quoteProvider: preview.quoteProvider,
              },
              message:
                "This is a preview. Call again with dryRun=false to create the security.",
            });
          }

          // Relay path: confirm in the web chat via the approve/reject card
          // rather than an elicitation in the agent's MCP client.
          const pendingAction = this.actionBuilder.buildCreateSecurity(
            ctx.userId,
            preview,
          );
          if (this.relayService.emitPendingAction(ctx.userId, pendingAction)) {
            return toolResult(RELAY_PREVIEW_SHOWN);
          }

          // Ask the client to confirm before persisting (AI Assistant parity).
          const confirmLines = [
            "Create this security?",
            `Symbol: ${preview.symbol}`,
            `Name: ${preview.name}`,
          ];
          if (preview.securityType) {
            confirmLines.push(`Type: ${preview.securityType}`);
          }
          if (preview.exchange) {
            confirmLines.push(`Exchange: ${preview.exchange}`);
          }
          confirmLines.push(`Currency: ${preview.currencyCode}`);
          if (preview.isFavourite) {
            confirmLines.push("Pinned to favourites: yes");
          }
          const confirmation = await confirmWrite(
            server,
            confirmLines.join("\n"),
            extra.requestId,
          );
          if (confirmation === "declined") {
            return toolError(
              "Cancelled: the confirmation was declined, so no security was created. Do not retry unless the user asks again.",
            );
          }

          const security = await this.securitiesService.create(ctx.userId, {
            symbol: preview.symbol,
            name: preview.name,
            securityType: preview.securityType ?? undefined,
            exchange: preview.exchange ?? undefined,
            currencyCode: preview.currencyCode,
            isFavourite: preview.isFavourite,
            quoteProvider: preview.quoteProvider ?? undefined,
            msnInstrumentId: preview.msnInstrumentId ?? undefined,
          });

          this.writeLimiter.record(ctx.userId, "create_security");

          return toolResult({
            id: security.id,
            symbol: security.symbol,
            name: security.name,
            securityType: security.securityType,
            exchange: security.exchange,
            currencyCode: security.currencyCode,
            isFavourite: security.isFavourite,
          });
        } catch (err: unknown) {
          return safeToolError(err);
        }
      },
    );

    server.registerTool(
      "create_investment_transaction",
      {
        title: "Create investment transaction",
        annotations: CREATE,
        description:
          "Create a brokerage/investment-account transaction of any type (BUY, SELL, DIVIDEND, INTEREST, CAPITAL_GAIN, SPLIT, TRANSFER_IN, TRANSFER_OUT, REINVEST, ADD_SHARES, REMOVE_SHARES). The security is matched automatically by ticker symbol or name; an ambiguous or unknown reference returns an error. Buys debit and sells/dividends/interest/capital gains credit the brokerage's linked cash account automatically -- do not also create a separate cash transaction. Set dryRun=true to preview (validates and resolves the security, computes the total and cash impact) without saving. When dryRun is false, the user is asked to confirm before the transaction is saved (clients that support it show a confirmation dialog). Uses the same shared logic as the AI Assistant's create_investment_transaction tool.",
        inputSchema: {
          accountId: z.string().uuid().describe("Investment account ID"),
          action: z
            .nativeEnum(InvestmentAction)
            .describe("Transaction type (e.g. BUY, SELL, DIVIDEND)"),
          date: z.string().max(10).describe("Transaction date (YYYY-MM-DD)"),
          security: z
            .string()
            .min(1)
            .max(100)
            .optional()
            .describe(
              "Security ticker symbol or name. Required for BUY, SELL, SPLIT, REINVEST, ADD_SHARES, REMOVE_SHARES. Matched to one of the user's securities.",
            ),
          quantity: z
            .number()
            .min(0)
            .max(999999999999)
            .optional()
            .describe(
              "Number of shares (8 dp). For SPLIT, the split ratio (>0).",
            ),
          price: z
            .number()
            .min(0)
            .max(999999999999)
            .optional()
            .describe(
              "Price per share (6 dp). For DIVIDEND/INTEREST/CAPITAL_GAIN with no quantity, the total cash amount.",
            ),
          commission: z
            .number()
            .min(0)
            .max(999999999999)
            .optional()
            .describe("Commission or fee (4 dp). Defaults to 0."),
          fundingAccountId: z
            .string()
            .uuid()
            .optional()
            .describe(
              "Optional cash account that funds a buy or receives a sell's proceeds. Omit to use the brokerage's own linked cash account.",
            ),
          description: z
            .string()
            .max(500)
            .optional()
            .describe("Description or memo"),
          dryRun: z
            .boolean()
            .optional()
            .default(false)
            .describe(
              "If true, validate and return a preview without creating the transaction",
            ),
        },
        outputSchema: createInvestmentTransactionOutput,
      },
      async (args, extra) => {
        const ctx = resolve(extra.sessionId);
        if (!ctx) return toolError("No user context");
        const check = requireScope(ctx.scopes, "write");
        if (check.error) return check.result;

        const limitCheck = this.writeLimiter.checkLimit(ctx.userId);
        if (!limitCheck.allowed) {
          return toolError(
            `Daily write limit reached (${limitCheck.limit} operations per day). Try again tomorrow.`,
          );
        }

        try {
          // Shared preview: validates the account + action, matches the
          // security by symbol/name, computes the total/FX/cash impact, and
          // sanitizes strings -- identical to the AI Assistant flow.
          const preview =
            await this.investmentTransactionsService.previewCreateInvestmentTransaction(
              ctx.userId,
              {
                accountId: args.accountId,
                action: args.action,
                transactionDate: args.date,
                securityQuery: args.security,
                quantity: args.quantity,
                price: args.price,
                commission: args.commission,
                fundingAccountId: args.fundingAccountId,
                description: args.description,
              },
            );

          if (args.dryRun) {
            return toolResult({
              dryRun: true,
              preview: {
                accountId: preview.accountId,
                accountName: preview.accountName,
                action: preview.action,
                date: preview.transactionDate,
                securityId: preview.securityId,
                symbol: preview.symbol,
                securityName: preview.securityName,
                securityCurrency: preview.securityCurrency,
                quantity: preview.quantity,
                price: preview.price,
                commission: preview.commission,
                totalAmount: preview.totalAmount,
                exchangeRate: preview.exchangeRate,
                cashAccountName: preview.cashAccountName,
                cashCurrency: preview.cashCurrency,
                cashAmount: preview.cashAmount,
                description: preview.description,
              },
              message:
                "This is a preview. Call again with dryRun=false to create the transaction.",
            });
          }

          // Relay path: confirm in the web chat via the approve/reject card
          // rather than an elicitation in the agent's MCP client.
          const pendingAction =
            this.actionBuilder.buildCreateInvestmentTransaction(
              ctx.userId,
              preview,
            );
          if (this.relayService.emitPendingAction(ctx.userId, pendingAction)) {
            return toolResult(RELAY_PREVIEW_SHOWN);
          }

          // Ask the client to confirm before persisting (AI Assistant parity).
          const confirmLines = [
            "Create this investment transaction?",
            `Account: ${preview.accountName}`,
            `Type: ${preview.action}`,
            `Date: ${preview.transactionDate}`,
          ];
          if (preview.symbol) {
            confirmLines.push(
              `Security: ${preview.symbol}${preview.securityName ? ` (${preview.securityName})` : ""}`,
            );
          }
          if (preview.quantity !== null) {
            confirmLines.push(`Quantity: ${preview.quantity}`);
          }
          if (preview.price !== null) {
            confirmLines.push(`Price: ${preview.price}`);
          }
          if (preview.commission) {
            confirmLines.push(`Commission: ${preview.commission}`);
          }
          if (preview.cashAccountName && preview.cashAmount !== null) {
            confirmLines.push(
              `Cash: ${preview.cashAmount} ${preview.cashCurrency} in ${preview.cashAccountName}`,
            );
          }
          const confirmation = await confirmWrite(
            server,
            confirmLines.join("\n"),
            extra.requestId,
          );
          if (confirmation === "declined") {
            return toolError(
              "Cancelled: the confirmation was declined, so no investment transaction was created. Do not retry unless the user asks again.",
            );
          }

          const transaction = await this.investmentTransactionsService.create(
            ctx.userId,
            {
              accountId: preview.accountId,
              action: preview.action,
              transactionDate: preview.transactionDate,
              securityId: preview.securityId ?? undefined,
              fundingAccountId: preview.fundingAccountId ?? undefined,
              quantity: preview.quantity ?? undefined,
              price: preview.price ?? undefined,
              commission: preview.commission,
              exchangeRate: preview.exchangeRate,
              description: preview.description ?? undefined,
            },
          );

          this.writeLimiter.record(ctx.userId, "create_investment_transaction");

          return toolResult({
            id: transaction.id,
            action: transaction.action,
            date: transaction.transactionDate,
            symbol: preview.symbol,
            quantity:
              transaction.quantity !== null
                ? Number(transaction.quantity)
                : null,
            price:
              transaction.price !== null ? Number(transaction.price) : null,
            totalAmount: Number(transaction.totalAmount),
          });
        } catch (err: unknown) {
          return safeToolError(err);
        }
      },
    );

    server.registerTool(
      "create_investment_transactions",
      {
        title: "Create investment transactions (bulk)",
        annotations: CREATE,
        description:
          "Create SEVERAL brokerage/investment-account transactions at once from a list or pasted table of trades (max 25 rows). Each security is matched automatically by ticker symbol or name. Best-effort: rows that fail to resolve or save are reported in `skipped` and do not abort the rest. Set dryRun=true to preview every row (and see which would be skipped) without saving. When dryRun is false the user confirms once for the whole batch (web chat card via relay, or an MCP confirmation dialog). For a single transaction, use create_investment_transaction. Shares the bulk logic with the AI Assistant's create_investment_transactions tool.",
        inputSchema: {
          rows: z
            .array(
              z.object({
                accountId: z.string().uuid().describe("Investment account ID"),
                action: z
                  .nativeEnum(InvestmentAction)
                  .describe("Transaction type (e.g. BUY, SELL, DIVIDEND)"),
                date: z
                  .string()
                  .max(10)
                  .describe("Transaction date (YYYY-MM-DD)"),
                security: z
                  .string()
                  .min(1)
                  .max(100)
                  .optional()
                  .describe(
                    "Security ticker symbol or name. Required for BUY, SELL, SPLIT, REINVEST, ADD_SHARES, REMOVE_SHARES.",
                  ),
                quantity: z.number().min(0).max(999999999999).optional(),
                price: z.number().min(0).max(999999999999).optional(),
                commission: z.number().min(0).max(999999999999).optional(),
                fundingAccountId: z.string().uuid().optional(),
                description: z.string().max(500).optional(),
              }),
            )
            .min(1)
            .max(MAX_BULK_ACTION_ROWS)
            .describe("The investment transactions to create (1-25 rows)."),
          dryRun: z
            .boolean()
            .optional()
            .default(false)
            .describe(
              "If true, validate and return a per-row preview without creating anything.",
            ),
        },
        outputSchema: createInvestmentTransactionsOutput,
      },
      async (args, extra) => {
        const ctx = resolve(extra.sessionId);
        if (!ctx) return toolError("No user context");
        const check = requireScope(ctx.scopes, "write");
        if (check.error) return check.result;

        try {
          // Best-effort preview of every row, preserving input order.
          const okPreviews: CreateInvestmentTransactionPreview[] = [];
          const okOriginalIndex: number[] = [];
          const previewRows: AiActionPreviewRow[] = [];
          const skipped: BulkCreateSkip[] = [];
          for (let i = 0; i < args.rows.length; i++) {
            const row = args.rows[i];
            try {
              const preview =
                await this.investmentTransactionsService.previewCreateInvestmentTransaction(
                  ctx.userId,
                  {
                    accountId: row.accountId,
                    action: row.action,
                    transactionDate: row.date,
                    securityQuery: row.security,
                    quantity: row.quantity,
                    price: row.price,
                    commission: row.commission,
                    fundingAccountId: row.fundingAccountId,
                    description: row.description,
                  },
                );
              okPreviews.push(preview);
              okOriginalIndex.push(i);
              previewRows.push(investmentPreviewRow(preview));
            } catch (err) {
              const reason = bulkSkipReason(err);
              skipped.push({ index: i, reason });
              previewRows.push({
                status: "error",
                investmentAction: row.action,
                transactionDate: row.date,
                symbol: row.security ?? null,
                quantity: row.quantity ?? null,
                price: row.price ?? null,
                error: reason,
              });
            }
          }

          if (args.dryRun) {
            return toolResult({
              dryRun: true,
              preview: { rows: previewRows, skipped },
              message:
                "This is a preview. Call again with dryRun=false to create the transactions.",
            });
          }

          if (okPreviews.length === 0) {
            return toolError(
              "None of the investment transactions could be prepared. Check the account, security, action, and date for each row.",
            );
          }

          const limitCheck = this.writeLimiter.checkLimit(ctx.userId);
          if (limitCheck.currentCount + okPreviews.length > limitCheck.limit) {
            return toolError(
              `Daily write limit reached (${limitCheck.limit} operations per day). Try again tomorrow.`,
            );
          }

          // Relay first: show one approve/reject card in the web chat.
          const pendingAction =
            this.actionBuilder.buildCreateInvestmentTransactions(
              ctx.userId,
              okPreviews,
              previewRows,
            );
          if (this.relayService.emitPendingAction(ctx.userId, pendingAction)) {
            return toolResult(RELAY_PREVIEW_SHOWN);
          }

          const skippedNote = skipped.length
            ? ` (${skipped.length} row(s) could not be prepared and will be skipped)`
            : "";
          const confirmation = await confirmWrite(
            server,
            `Create ${okPreviews.length} investment transaction(s)?${skippedNote}`,
            extra.requestId,
          );
          if (confirmation === "declined") {
            return toolError(
              "Cancelled: the confirmation was declined, so no investment transactions were created. Do not retry unless the user asks again.",
            );
          }

          const result = await this.investmentTransactionsService.createBulk(
            ctx.userId,
            okPreviews.map((preview) => ({
              accountId: preview.accountId,
              action: preview.action,
              transactionDate: preview.transactionDate,
              securityId: preview.securityId ?? undefined,
              fundingAccountId: preview.fundingAccountId ?? undefined,
              quantity: preview.quantity ?? undefined,
              price: preview.price ?? undefined,
              commission: preview.commission,
              exchangeRate: preview.exchangeRate,
              description: preview.description ?? undefined,
            })),
          );
          // Map createBulk's skip indices (relative to okPreviews) back to the
          // caller's original row indices.
          for (const s of result.skipped) {
            skipped.push({
              index: okOriginalIndex[s.index],
              reason: s.reason,
            });
          }
          for (let i = 0; i < result.created.length; i++) {
            this.writeLimiter.record(
              ctx.userId,
              "create_investment_transaction",
            );
          }

          return toolResult({
            created: result.created.map((t) => ({
              id: t.id,
              action: t.action,
              date: t.transactionDate,
              totalAmount: Number(t.totalAmount),
            })),
            ids: result.created.map((t) => t.id),
            count: result.created.length,
            skipped,
          });
        } catch (err: unknown) {
          return safeToolError(err);
        }
      },
    );
  }
}
