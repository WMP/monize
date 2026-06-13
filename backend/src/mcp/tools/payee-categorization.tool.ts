import { Injectable } from "@nestjs/common";
import { z } from "zod";
import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { PayeesService } from "../../payees/payees.service";
import {
  UserContextResolver,
  requireScope,
  toolResult,
  toolError,
  safeToolError,
} from "../mcp-context";

@Injectable()
export class McpPayeeCategorizationTools {
  constructor(private readonly payeesService: PayeesService) {}

  register(server: McpServer, resolve: UserContextResolver) {
    server.registerTool(
      "get_payee_categorization_context",
      {
        description:
          "Get rich per-payee transaction context so you can suggest a default category for each payee. READ-ONLY: returns data only, makes no changes. There is no payment-method column on transactions -- the user records payment type via transaction tags and sometimes in the description, and the account (name + type) is also a payment-method signal, so each transaction row surfaces tags, description, and account. Defaults to payees that have no default category yet. Optionally includes the user's category tree to map suggestions onto. Use the returned categories list to pick a categoryId to assign.",
        inputSchema: {
          onlyUncategorized: z
            .boolean()
            .optional()
            .describe(
              "Only include payees that have no default category yet. Defaults to true.",
            ),
          limit: z
            .number()
            .int()
            .min(1)
            .max(200)
            .optional()
            .describe("Maximum number of payees to return. Defaults to 50."),
          minTransactions: z
            .number()
            .int()
            .min(0)
            .optional()
            .describe(
              "Only include payees with at least this many transactions. Defaults to 0.",
            ),
          maxTransactionsPerPayee: z
            .number()
            .int()
            .min(1)
            .max(100)
            .optional()
            .describe(
              "Cap the number of transactions listed per payee (most recent first). Defaults to 25.",
            ),
          payeeIds: z
            .array(z.string().uuid())
            .max(200)
            .optional()
            .describe(
              "Restrict to these payee IDs (must belong to the user). Omit to consider all eligible payees.",
            ),
          includeCategoryTree: z
            .boolean()
            .optional()
            .describe(
              "Include the user's category tree (id, name, parentId, isIncome) to map suggestions onto. Defaults to true.",
            ),
        },
      },
      async (args, extra) => {
        const ctx = resolve(extra.sessionId);
        if (!ctx) return toolError("No user context");
        const check = requireScope(ctx.scopes, "read");
        if (check.error) return check.result;

        try {
          const data = await this.payeesService.getCategorizationContext(
            ctx.userId,
            {
              onlyUncategorized: args.onlyUncategorized,
              limit: args.limit,
              minTransactions: args.minTransactions,
              maxTransactionsPerPayee: args.maxTransactionsPerPayee,
              payeeIds: args.payeeIds,
              includeCategoryTree: args.includeCategoryTree,
            },
          );
          return toolResult(data);
        } catch (err: unknown) {
          return safeToolError(err);
        }
      },
    );
  }
}
