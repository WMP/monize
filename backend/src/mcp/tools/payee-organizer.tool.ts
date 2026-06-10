import { Injectable } from "@nestjs/common";
import { z } from "zod";
import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { PayeeOrganizerService } from "../../ai/payee-organizer/payee-organizer.service";
import {
  UserContextResolver,
  requireScope,
  toolResult,
  toolError,
  safeToolError,
} from "../mcp-context";

@Injectable()
export class McpPayeeOrganizerTools {
  constructor(private readonly payeeOrganizerService: PayeeOrganizerService) {}

  register(server: McpServer, resolve: UserContextResolver) {
    server.registerTool(
      "suggest_payee_organization",
      {
        description:
          "Use AI to suggest default categories for uncategorized payees (from their names) and detect likely-duplicate payees to merge. Read-only preview: returns categorySuggestions and mergeGroups but applies nothing.",
        inputSchema: {
          allowNewCategories: z
            .boolean()
            .optional()
            .describe(
              "When true, the AI may propose creating new categories that do not yet exist. Defaults to false (existing categories only).",
            ),
        },
      },
      async (args, extra) => {
        const ctx = resolve(extra.sessionId);
        if (!ctx) return toolError("No user context");
        const check = requireScope(ctx.scopes, "read");
        if (check.error) return check.result;

        try {
          const data = await this.payeeOrganizerService.suggest(ctx.userId, {
            allowNewCategories: args.allowNewCategories === true,
          });
          return toolResult(data);
        } catch (err: unknown) {
          return safeToolError(err);
        }
      },
    );

    server.registerTool(
      "apply_payee_organization",
      {
        description:
          "Apply reviewed payee-organization selections: create any approved new categories, assign default categories to payees, and merge duplicate payees into their canonical payee. This performs writes.",
        inputSchema: {
          categoryAssignments: z
            .array(
              z.object({
                payeeId: z.string().uuid().describe("Payee to categorize"),
                categoryId: z
                  .string()
                  .uuid()
                  .optional()
                  .describe("Existing category id to assign"),
                newCategoryName: z
                  .string()
                  .max(100)
                  .optional()
                  .describe("Name of a new category to create and assign"),
              }),
            )
            .max(1000)
            .describe("Category assignments to apply"),
          merges: z
            .array(
              z.object({
                targetPayeeId: z
                  .string()
                  .uuid()
                  .describe("Canonical payee duplicates merge into"),
                sourcePayeeIds: z
                  .array(z.string().uuid())
                  .max(1000)
                  .describe("Duplicate payees to merge and delete"),
              }),
            )
            .max(1000)
            .describe("Merge groups to apply"),
          rejectedMerges: z
            .array(
              z.object({
                canonicalPayeeId: z
                  .string()
                  .uuid()
                  .describe(
                    "Canonical payee of a group marked NOT a duplicate",
                  ),
                duplicatePayeeIds: z
                  .array(z.string().uuid())
                  .max(1000)
                  .describe("Payees that are NOT duplicates of the canonical"),
              }),
            )
            .max(1000)
            .optional()
            .describe(
              "Merge groups the user marked NOT a duplicate; persisted so they are never re-suggested",
            ),
        },
      },
      async (args, extra) => {
        const ctx = resolve(extra.sessionId);
        if (!ctx) return toolError("No user context");
        const check = requireScope(ctx.scopes, "write");
        if (check.error) return check.result;

        try {
          const data = await this.payeeOrganizerService.apply(ctx.userId, {
            categoryAssignments: args.categoryAssignments ?? [],
            merges: args.merges ?? [],
            rejectedMerges: args.rejectedMerges ?? [],
          });
          return toolResult(data);
        } catch (err: unknown) {
          return safeToolError(err);
        }
      },
    );
  }
}
