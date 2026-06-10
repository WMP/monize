import { Injectable } from "@nestjs/common";
import { z } from "zod";
import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { BrokerImportService } from "../../ai/broker-import/broker-import.service";
import {
  UserContextResolver,
  requireScope,
  toolResult,
  toolError,
  safeToolError,
} from "../mcp-context";

@Injectable()
export class McpBrokerImportTools {
  constructor(private readonly brokerImportService: BrokerImportService) {}

  register(server: McpServer, resolve: UserContextResolver) {
    server.registerTool(
      "parse_broker_import",
      {
        description:
          "Use AI to parse pasted brokerage order-history HTML into structured buy/sell orders. Only executed orders are extracted. Read-only preview: returns orders (each matched to an existing security where possible) plus warnings, but records nothing.",
        inputSchema: {
          html: z
            .string()
            .max(1_000_000)
            .describe(
              "Raw HTML of the brokerage account's order history, as pasted by the user.",
            ),
        },
      },
      async (args, extra) => {
        const ctx = resolve(extra.sessionId);
        if (!ctx) return toolError("No user context");
        const check = requireScope(ctx.scopes, "read");
        if (check.error) return check.result;

        try {
          const data = await this.brokerImportService.parse(ctx.userId, {
            html: args.html,
          });
          return toolResult(data);
        } catch (err: unknown) {
          return safeToolError(err);
        }
      },
    );

    server.registerTool(
      "apply_broker_import",
      {
        description:
          "Apply reviewed broker-import orders into an investment account: create any new securities (from a user-supplied symbol) and record BUY/SELL investment transactions. This performs writes.",
        inputSchema: {
          accountId: z
            .string()
            .uuid()
            .describe("Investment/brokerage account to import the orders into"),
          orders: z
            .array(
              z.object({
                securityId: z
                  .string()
                  .uuid()
                  .optional()
                  .describe("Existing security to use for this order"),
                newSecurity: z
                  .object({
                    symbol: z
                      .string()
                      .max(20)
                      .describe("Ticker/symbol for the new security"),
                    name: z.string().max(255).describe("Full security name"),
                    exchange: z.string().max(50).optional(),
                    currency: z.string().max(10).describe("Currency code"),
                    type: z.string().max(50).optional(),
                  })
                  .optional()
                  .describe("New security to create for this order"),
                side: z.enum(["BUY", "SELL"]),
                quantity: z.number().min(0).describe("Number of shares"),
                price: z.number().min(0).describe("Price per share"),
                commission: z.number().min(0).describe("Commission or fee"),
                currency: z.string().max(10).describe("Instrument currency"),
                tradeDate: z
                  .string()
                  .describe("Trade date in YYYY-MM-DD format"),
              }),
            )
            .max(1000)
            .describe("Reviewed orders to import"),
        },
      },
      async (args, extra) => {
        const ctx = resolve(extra.sessionId);
        if (!ctx) return toolError("No user context");
        const check = requireScope(ctx.scopes, "write");
        if (check.error) return check.result;

        try {
          const data = await this.brokerImportService.apply(ctx.userId, {
            accountId: args.accountId,
            orders: args.orders ?? [],
          });
          return toolResult(data);
        } catch (err: unknown) {
          return safeToolError(err);
        }
      },
    );
  }
}
