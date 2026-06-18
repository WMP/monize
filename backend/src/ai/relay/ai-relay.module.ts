import { Module } from "@nestjs/common";
import { AiRelayService } from "./ai-relay.service";
import { AiRelayController } from "./ai-relay.controller";

/**
 * Reverse MCP relay: routes AI chat prompts from the browser to the user's own
 * MCP agent and the answers back. AiRelayService is exported so the MCP relay
 * tools (in McpModule) can claim prompts and post responses against the same
 * in-memory broker the browser controller feeds.
 */
@Module({
  providers: [AiRelayService],
  controllers: [AiRelayController],
  exports: [AiRelayService],
})
export class AiRelayModule {}
