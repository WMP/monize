import { Injectable } from "@nestjs/common";
import { z } from "zod";
import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { AiSuggestionSessionService } from "../../ai/sessions/ai-suggestion-session.service";
import {
  UserContextResolver,
  requireScope,
  toolResult,
  toolError,
  safeToolError,
} from "../mcp-context";

/**
 * MCP write tool for AI payee categorization. Hard rule: the external LLM may
 * only create a DRAFT suggestion session here -- it never applies category
 * changes. Applying a draft is a human action performed in the app's review UI.
 * Shares its implementation with the AI assistant via the session service.
 */
@Injectable()
export class McpPayeeSuggestionSessionTools {
  constructor(
    private readonly suggestionSessionService: AiSuggestionSessionService,
  ) {}

  register(server: McpServer, resolve: UserContextResolver) {
    server.registerTool(
      "save_payee_category_suggestions",
      {
        description:
          "Save your per-payee default-category suggestions as a DRAFT for the user to review and apply in the app. IMPORTANT: this makes NO changes -- it only stores a draft session. You must never apply category changes yourself; applying is a human action in the UI. Call after get_payee_categorization_context. For each payee provide EITHER an existing categoryId OR a newCategoryName (exactly one). Pass an existing sessionId to replace a draft you created earlier, or omit it to start a new draft. Requires the 'write' scope.",
        inputSchema: {
          sessionId: z
            .string()
            .uuid()
            .optional()
            .describe(
              "Existing draft session ID to replace. Omit to create a new draft.",
            ),
          title: z
            .string()
            .max(255)
            .optional()
            .describe("Optional short title for the draft session."),
          suggestions: z
            .array(
              z.object({
                payeeId: z
                  .string()
                  .uuid()
                  .describe("Payee to categorize (must belong to the user)."),
                categoryId: z
                  .string()
                  .uuid()
                  .optional()
                  .describe(
                    "Existing category to assign. Provide this OR newCategoryName, not both.",
                  ),
                newCategoryName: z
                  .string()
                  .min(1)
                  .max(100)
                  .optional()
                  .describe(
                    "New category to propose. Provide this OR categoryId, not both.",
                  ),
                reason: z
                  .string()
                  .max(500)
                  .optional()
                  .describe("Optional short rationale shown to the user."),
                confidence: z
                  .number()
                  .min(0)
                  .max(1)
                  .optional()
                  .describe("Optional confidence between 0 and 1."),
              }),
            )
            .min(1)
            .max(500)
            .describe(
              "Per-payee suggestions. Each item must specify exactly one of categoryId or newCategoryName.",
            ),
        },
      },
      async (args, extra) => {
        const ctx = resolve(extra.sessionId);
        if (!ctx) return toolError("No user context");
        const check = requireScope(ctx.scopes, "write");
        if (check.error) return check.result;

        try {
          const data =
            await this.suggestionSessionService.savePayeeCategorySuggestions(
              ctx.userId,
              {
                sessionId: args.sessionId,
                title: args.title,
                suggestions: args.suggestions,
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
