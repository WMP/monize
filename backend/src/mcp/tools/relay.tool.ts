import { Injectable } from "@nestjs/common";
import { z } from "zod";
import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { AiRelayService } from "../../ai/relay/ai-relay.service";
import {
  UserContextResolver,
  requireScope,
  toolResult,
  toolError,
  safeToolError,
} from "../mcp-context";
import {
  getNextPromptOutput,
  postResponseOutput,
} from "../tool-output-schemas";
import { READ_ONLY } from "../mcp-annotations";

/**
 * Reverse-relay control tools. These do not touch the financial dataset -- they
 * route a chat prompt from the Monize web UI to this agent and the answer back
 * -- so both carry the READ_ONLY annotation (the hint describes effect on the
 * user's data, which is none here). The agent does the actual work through the
 * other MCP tools between `get_next_prompt` and `post_response`.
 *
 * Usage pattern the agent is told to follow: loop forever -- call
 * `get_next_prompt`; if `hasPrompt` is false, call it again; otherwise handle
 * the request with the Monize tools, then call `post_response` with the answer,
 * then loop.
 */
@Injectable()
export class McpRelayTools {
  constructor(private readonly relayService: AiRelayService) {}

  register(server: McpServer, resolve: UserContextResolver) {
    server.registerTool(
      "get_next_prompt",
      {
        title: "Wait for the next chat prompt",
        annotations: READ_ONLY,
        description:
          "Long-poll for the next prompt a user typed in the Monize web chat. Returns { hasPrompt: false } if none arrives within the poll window -- in that case call this tool again immediately to keep listening. When hasPrompt is true, handle the request using the other Monize tools, then call post_response with promptId and your answer. 'history' is the prior conversation, oldest first.",
        inputSchema: {},
        outputSchema: getNextPromptOutput,
      },
      async (_args, extra) => {
        const ctx = resolve(extra.sessionId);
        if (!ctx) return toolError("No user context");
        const check = requireScope(ctx.scopes, "read");
        if (check.error) return check.result;

        try {
          const claimed = await this.relayService.waitForPrompt(ctx.userId);
          if (!claimed) {
            return toolResult({ hasPrompt: false });
          }
          return toolResult({
            hasPrompt: true,
            promptId: claimed.promptId,
            prompt: claimed.prompt,
            history: claimed.history,
          });
        } catch (err: unknown) {
          return safeToolError(err);
        }
      },
    );

    server.registerTool(
      "post_response",
      {
        title: "Send a chat answer",
        annotations: READ_ONLY,
        description:
          "Deliver your answer for a prompt obtained from get_next_prompt back to the Monize web chat. Pass the promptId you received and the full answer text. Returns { delivered: false } if the prompt is unknown or already answered (e.g. the user's request timed out) -- in that case simply continue polling.",
        inputSchema: {
          promptId: z
            .string()
            .uuid()
            .describe("The promptId from get_next_prompt"),
          text: z
            .string()
            .max(50000)
            .describe("The answer to show the user in the chat"),
        },
        outputSchema: postResponseOutput,
      },
      async (args, extra) => {
        const ctx = resolve(extra.sessionId);
        if (!ctx) return toolError("No user context");
        const check = requireScope(ctx.scopes, "read");
        if (check.error) return check.result;

        try {
          const delivered = this.relayService.postResponse(
            ctx.userId,
            args.promptId,
            args.text,
          );
          return toolResult({ delivered });
        } catch (err: unknown) {
          return safeToolError(err);
        }
      },
    );
  }
}
