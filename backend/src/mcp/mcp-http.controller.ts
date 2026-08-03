import {
  Controller,
  Post,
  Get,
  Delete,
  Req,
  Res,
  OnModuleDestroy,
} from "@nestjs/common";
import { ApiTags, ApiExcludeController } from "@nestjs/swagger";
import { Throttle } from "@nestjs/throttler";
import { Request, Response } from "express";
import { randomUUID } from "crypto";
import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { StreamableHTTPServerTransport } from "@modelcontextprotocol/sdk/server/streamableHttp.js";
import { SkipCsrf } from "../common/decorators/skip-csrf.decorator";
import { SetMetadata } from "@nestjs/common";
import { SKIP_PASSWORD_CHECK_KEY } from "../auth/guards/must-change-password.guard";
import { McpServerService } from "./mcp-server.service";
import { PatService } from "../auth/pat.service";
import { McpUserContext } from "./mcp-context";
import { OAuthProviderService } from "../oauth/oauth-provider.service";
import { ConfigService } from "@nestjs/config";
import { withUserContext } from "../common/db/with-context";

const SkipPasswordCheck = () => SetMetadata(SKIP_PASSWORD_CHECK_KEY, true);

/**
 * RLS: this transport is bearer-authenticated with no JWT guard, so `req.user`
 * is never set and `RequestContextInterceptor` enters its ALS scope with an
 * **undefined** userId. Every tool handler therefore reaches the domain services
 * with no ambient identity, and `withScopedDb` refuses to run without one. Each
 * `transport.handleRequest` is wrapped in `withUserContext(authResult.userId)`
 * so the session's authenticated user is the ambient identity for the whole
 * JSON-RPC exchange, including the tool handlers it dispatches.
 *
 * This is the MCP counterpart of what the interceptor does for cookie/JWT
 * routes; the id comes from `validatePat` (PAT or OAuth access token), never
 * from tool arguments. Individual tools may still re-seed the same id locally
 * (see `transactions.tool.ts`) -- a nested seed of the same user is a no-op.
 */
@ApiExcludeController()
@ApiTags("MCP")
@SkipCsrf()
@SkipPasswordCheck()
@Controller("mcp")
export class McpHttpController implements OnModuleDestroy {
  private static readonly SESSION_TTL_MS = 3_600_000; // 1 hour
  private static readonly MAX_SESSIONS_PER_USER = 10;
  private static readonly CLEANUP_INTERVAL_MS = 300_000; // 5 minutes

  private transports = new Map<string, StreamableHTTPServerTransport>();
  private servers = new Map<string, McpServer>();
  private sessionUsers = new Map<string, McpUserContext>();
  private sessionCreatedAt = new Map<string, number>();
  private cleanupTimer: ReturnType<typeof setInterval>;

  constructor(
    private readonly mcpServerService: McpServerService,
    private readonly patService: PatService,
    private readonly oauthProviderService: OAuthProviderService,
    private readonly configService: ConfigService,
  ) {
    this.cleanupTimer = setInterval(
      () => this.cleanupExpiredSessions(),
      McpHttpController.CLEANUP_INTERVAL_MS,
    );
  }

  onModuleDestroy() {
    clearInterval(this.cleanupTimer);
    for (const transport of this.transports.values()) {
      transport.close().catch(() => {});
    }
    this.transports.clear();
    this.servers.clear();
    this.sessionUsers.clear();
    this.sessionCreatedAt.clear();
  }

  private cleanupExpiredSessions() {
    const now = Date.now();
    for (const [sid, createdAt] of this.sessionCreatedAt.entries()) {
      if (now - createdAt > McpHttpController.SESSION_TTL_MS) {
        const transport = this.transports.get(sid);
        if (transport) transport.close().catch(() => {});
        this.transports.delete(sid);
        this.servers.delete(sid);
        this.sessionUsers.delete(sid);
        this.sessionCreatedAt.delete(sid);
      }
    }
  }

  private getUserSessionCount(userId: string): number {
    let count = 0;
    for (const ctx of this.sessionUsers.values()) {
      if (ctx.userId === userId) count++;
    }
    return count;
  }

  private isSessionExpired(sessionId: string): boolean {
    const createdAt = this.sessionCreatedAt.get(sessionId);
    if (!createdAt) return true;
    return Date.now() - createdAt > McpHttpController.SESSION_TTL_MS;
  }

  /**
   * Authorize an existing session against the credential presented on THIS
   * request, and re-bind the session's authorization to it.
   *
   * The session used to be accepted whenever the current token's `userId`
   * matched the cached one, while tools kept reading the scopes captured when
   * the session was created. Two consequences, both live (P2-004): a read-only
   * PAT that presented the session id of a session opened with a write PAT was
   * authorized for every mutating tool, and revoking the creating token left the
   * session usable until its TTL expired as long as the user still held any
   * valid token.
   *
   * So: the credential must be the same one (matching users is not enough --
   * one user holds many tokens with different scopes), and the scopes the tools
   * see are replaced by the ones the presented token carries right now. A
   * narrowed token narrows the session immediately; it never widens it back,
   * because a session may only ever be used by the credential that created it.
   *
   * Returns false when the request has been answered and must not proceed.
   */
  private authorizeExistingSession(
    sessionId: string,
    authResult: McpUserContext,
    res: Response,
  ): boolean {
    const sessionUser = this.sessionUsers.get(sessionId);
    if (
      sessionUser?.userId !== authResult.userId ||
      !sessionUser.credentialId ||
      !authResult.credentialId ||
      sessionUser.credentialId !== authResult.credentialId
    ) {
      res.status(403).json({
        jsonrpc: "2.0",
        error: { code: -32003, message: "Session credential mismatch" },
        id: null,
      });
      return false;
    }

    // Adopt the presented token's current authorization state. Immutable
    // replacement rather than a mutation of the object the tools hold.
    this.sessionUsers.set(sessionId, {
      userId: authResult.userId,
      scopes: authResult.scopes,
      credentialId: authResult.credentialId,
    });
    return true;
  }

  @Post()
  @Throttle({ default: { ttl: 60000, limit: 30 } })
  async handlePost(@Req() req: Request, @Res() res: Response) {
    const authResult = await this.validatePat(req);
    if (!authResult) {
      this.sendUnauthorized(res);
      return;
    }

    const sessionId = req.headers["mcp-session-id"] as string | undefined;

    if (sessionId) {
      const transport = this.transports.get(sessionId);
      if (!transport) {
        res.status(404).json({
          jsonrpc: "2.0",
          error: { code: -32004, message: "Session not found" },
          id: null,
        });
        return;
      }
      if (this.isSessionExpired(sessionId)) {
        this.destroySession(sessionId);
        res.status(404).json({
          jsonrpc: "2.0",
          error: { code: -32004, message: "Session expired" },
          id: null,
        });
        return;
      }
      if (!this.authorizeExistingSession(sessionId, authResult, res)) {
        return;
      }
      await withUserContext(authResult.userId, () =>
        transport.handleRequest(req, res, req.body),
      );
      return;
    }

    // Enforce per-user session limit
    if (
      this.getUserSessionCount(authResult.userId) >=
      McpHttpController.MAX_SESSIONS_PER_USER
    ) {
      res.status(429).json({
        jsonrpc: "2.0",
        error: {
          code: -32005,
          message: "Too many active sessions. Close existing sessions first.",
        },
        id: null,
      });
      return;
    }

    const transport = new StreamableHTTPServerTransport({
      sessionIdGenerator: () => randomUUID(),
    });

    transport.onclose = () => {
      const sid = transport.sessionId;
      if (sid) {
        this.destroySession(sid);
      }
    };

    const resolve = (sessionId?: string) => {
      if (!sessionId) return undefined;
      return this.sessionUsers.get(sessionId);
    };
    const server = this.mcpServerService.createServer(resolve);
    await server.connect(transport);
    await withUserContext(authResult.userId, () =>
      transport.handleRequest(req, res, req.body),
    );

    if (transport.sessionId) {
      this.transports.set(transport.sessionId, transport);
      this.servers.set(transport.sessionId, server);
      this.sessionUsers.set(transport.sessionId, {
        userId: authResult.userId,
        scopes: authResult.scopes,
        credentialId: authResult.credentialId,
      });
      this.sessionCreatedAt.set(transport.sessionId, Date.now());
    }
  }

  @Get()
  @Throttle({ default: { ttl: 60000, limit: 30 } })
  async handleGet(@Req() req: Request, @Res() res: Response) {
    const authResult = await this.validatePat(req);
    if (!authResult) {
      this.sendUnauthorized(res);
      return;
    }

    const sessionId = req.headers["mcp-session-id"] as string | undefined;
    if (!sessionId) {
      res.status(400).json({
        jsonrpc: "2.0",
        error: { code: -32000, message: "Session ID required" },
        id: null,
      });
      return;
    }

    const transport = this.transports.get(sessionId);
    if (!transport) {
      res.status(404).json({
        jsonrpc: "2.0",
        error: { code: -32004, message: "Session not found" },
        id: null,
      });
      return;
    }

    if (this.isSessionExpired(sessionId)) {
      this.destroySession(sessionId);
      res.status(404).json({
        jsonrpc: "2.0",
        error: { code: -32004, message: "Session expired" },
        id: null,
      });
      return;
    }

    if (!this.authorizeExistingSession(sessionId, authResult, res)) {
      return;
    }

    await withUserContext(authResult.userId, () =>
      transport.handleRequest(req, res),
    );
  }

  @Delete()
  @Throttle({ default: { ttl: 60000, limit: 30 } })
  async handleDelete(@Req() req: Request, @Res() res: Response) {
    const authResult = await this.validatePat(req);
    if (!authResult) {
      this.sendUnauthorized(res);
      return;
    }

    const sessionId = req.headers["mcp-session-id"] as string | undefined;
    if (!sessionId) {
      res.status(400).json({
        jsonrpc: "2.0",
        error: { code: -32000, message: "Session ID required" },
        id: null,
      });
      return;
    }

    const transport = this.transports.get(sessionId);
    if (!transport) {
      res.status(404).json({
        jsonrpc: "2.0",
        error: { code: -32004, message: "Session not found" },
        id: null,
      });
      return;
    }

    if (this.isSessionExpired(sessionId)) {
      this.destroySession(sessionId);
      res.status(404).json({
        jsonrpc: "2.0",
        error: { code: -32004, message: "Session expired" },
        id: null,
      });
      return;
    }

    if (!this.authorizeExistingSession(sessionId, authResult, res)) {
      return;
    }

    await withUserContext(authResult.userId, () =>
      transport.handleRequest(req, res),
    );
    this.destroySession(sessionId);
  }

  private destroySession(sessionId: string) {
    const transport = this.transports.get(sessionId);
    // Delete from maps BEFORE calling close() to prevent re-entrant loop:
    // close() fires transport.onclose → destroySession() → close() → stack overflow
    this.transports.delete(sessionId);
    this.servers.delete(sessionId);
    this.sessionUsers.delete(sessionId);
    this.sessionCreatedAt.delete(sessionId);
    if (transport) transport.close().catch(() => {});
  }

  private async validatePat(req: Request): Promise<McpUserContext | null> {
    const auth = req.headers.authorization;
    if (!auth || !auth.startsWith("Bearer ")) {
      return null;
    }
    const token = auth.substring(7);

    // PAT bearer tokens (legacy / advanced users)
    if (token.startsWith("pat_")) {
      try {
        const result = await this.patService.validateToken(token);
        return {
          userId: result.userId,
          scopes: result.scopes,
          credentialId: `pat:${result.tokenId}`,
        };
      } catch {
        return null;
      }
    }

    // OAuth 2.1 access tokens (issued via /oauth for MCP clients like
    // Claude Desktop's "Add Connector" flow). Audience-bound to the MCP
    // resource URL by the provider's resourceIndicators config.
    const oauthResult =
      await this.oauthProviderService.validateAccessToken(token);
    if (oauthResult) {
      return {
        userId: oauthResult.userId,
        scopes: oauthResult.scopes,
        // A grant with no id cannot be bound, and an unbindable credential must
        // not be able to open a session that a later request could match by
        // user alone -- refuse it here rather than mint one.
        credentialId: oauthResult.grantId
          ? `oauth:${oauthResult.grantId}`
          : undefined,
      };
    }

    return null;
  }

  private sendUnauthorized(res: Response): void {
    const publicUrl =
      this.configService.get<string>("PUBLIC_APP_URL")?.replace(/\/$/, "") ??
      "";
    const resourceMetadata = `${publicUrl}/.well-known/oauth-protected-resource`;
    res.setHeader(
      "WWW-Authenticate",
      `Bearer realm="monize", resource_metadata="${resourceMetadata}"`,
    );
    res.status(401).json({
      jsonrpc: "2.0",
      error: { code: -32001, message: "Unauthorized" },
      id: null,
    });
  }
}
