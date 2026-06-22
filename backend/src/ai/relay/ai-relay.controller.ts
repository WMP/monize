import {
  Body,
  Controller,
  Get,
  Logger,
  Param,
  ParseUUIDPipe,
  Post,
  Request,
  Res,
  UseGuards,
} from "@nestjs/common";
import { AuthGuard } from "@nestjs/passport";
import { Throttle } from "@nestjs/throttler";
import { ApiBearerAuth, ApiOperation, ApiTags } from "@nestjs/swagger";
import { Response } from "express";
import { AiRelayService, RelayTimeoutError } from "./ai-relay.service";
import { RelayQueryDto } from "./dto/relay-query.dto";
import { RelayTunnelStatus } from "./ai-relay.types";
import { tr } from "../../i18n/translate";

/**
 * Browser side of the reverse MCP relay. The chat posts a prompt here; the
 * request is held open (SSE) until the user's MCP agent answers it through the
 * post_response tool, or it times out. Status is exposed for the tunnel
 * indicator. The agent side lives in the MCP relay tools.
 */
@ApiTags("AI")
@ApiBearerAuth()
@Controller("ai/relay")
@UseGuards(AuthGuard("jwt"))
export class AiRelayController {
  private readonly logger = new Logger(AiRelayController.name);

  constructor(private readonly relayService: AiRelayService) {}

  @Get("status")
  @ApiOperation({ summary: "Reverse MCP relay tunnel status" })
  @Throttle({ default: { ttl: 60000, limit: 120 } })
  status(@Request() req: { user: { id: string } }): RelayTunnelStatus {
    return this.relayService.getStatus(req.user.id);
  }

  @Post("query/stream")
  @ApiOperation({
    summary: "Send a chat prompt to the user's MCP agent and stream the answer",
  })
  @Throttle({ default: { ttl: 60000, limit: 10 } })
  async streamQuery(
    @Request() req: { user: { id: string } },
    @Body() dto: RelayQueryDto,
    @Res() res: Response,
  ): Promise<void> {
    res.setHeader("Content-Type", "text/event-stream");
    res.setHeader("Cache-Control", "no-cache");
    res.setHeader("Connection", "keep-alive");
    res.setHeader("X-Accel-Buffering", "no");
    res.flushHeaders();

    const userId = req.user.id;
    const start = Date.now();

    const aborted = { value: false };
    res.on("close", () => {
      aborted.value = true;
    });

    // Keepalive: a parked agent may take minutes to answer; comment lines reset
    // proxy body timeouts without disturbing SSE consumers.
    const heartbeat = setInterval(() => {
      if (!aborted.value && !res.writableEnded) {
        res.write(`: heartbeat ${Date.now()}\n\n`);
      }
    }, 15_000);

    const write = (event: Record<string, unknown>): void => {
      if (!aborted.value && !res.writableEnded) {
        res.write(`data: ${JSON.stringify(event)}\n\n`);
      }
    };

    try {
      const history = (dto.conversationHistory ?? []).map((m) => ({
        role: m.role,
        content: m.content,
      }));

      const response = await this.relayService.enqueuePrompt(
        userId,
        dto.query,
        history,
        // Lets a write tool render its confirmation card in this browser stream
        // while the agent is still working on the prompt.
        write,
        // Tell the client its promptId up front so that if the stream dies
        // before the answer arrives it can poll the pickup endpoint for a late
        // answer (Fix 1) instead of showing a hard error.
        (promptId) => write({ type: "prompt_id", promptId }),
      );
      // Emit `content` (not `assistant_text`): the chat store treats
      // assistant_text as ephemeral "thinking" text and only `content` creates
      // the persisted assistant message, so the answer must arrive as content.
      write({ type: "content", text: response.text });
      write({ type: "done" });
    } catch (error) {
      const rawMessage =
        error instanceof Error ? error.message : "Unknown error";
      this.logger.warn(
        `Relay stream failed user=${userId} after=${Date.now() - start}ms: ${rawMessage}`,
      );
      // A claimed-then-quiet agent gets distinct copy from a never-claimed one,
      // and the late answer may still arrive: the client will try the pickup
      // endpoint with the promptId it was given above.
      const wentQuiet =
        error instanceof RelayTimeoutError && error.reason === "disconnected";
      const message = wentQuiet
        ? tr(
            "errors.ai.relayDisconnected",
            "Your assistant went quiet before answering. If it reconnects, its answer will appear here.",
          )
        : tr(
            "errors.ai.relayTimeout",
            "Your assistant did not respond. Make sure your MCP agent is connected and listening.",
          );
      write({ type: "error", message });
    } finally {
      clearInterval(heartbeat);
      if (!aborted.value && !res.writableEnded) {
        res.end();
      }
    }
  }

  @Get("response/:promptId")
  @ApiOperation({
    summary: "Pick up a late relay answer buffered after the stream gave up",
  })
  @Throttle({ default: { ttl: 60000, limit: 60 } })
  pickupResponse(
    @Request() req: { user: { id: string } },
    @Param("promptId", ParseUUIDPipe) promptId: string,
  ): { text: string | null } {
    const buffered = this.relayService.takeBufferedResponse(
      req.user.id,
      promptId,
    );
    return { text: buffered?.text ?? null };
  }
}
