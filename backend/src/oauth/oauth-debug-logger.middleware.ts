import { randomBytes } from "crypto";
import { Logger } from "@nestjs/common";
import type { NextFunction, Request, Response } from "express";

const logger = new Logger("OAuthDebug");

/**
 * Off by default. Set OAUTH_DEBUG_LOG=true (or =1, =yes) to enable
 * per-request tracing of the MCP / OAuth surface. Useful when
 * diagnosing connector handshake failures with Claude Desktop,
 * mcp-remote, or similar clients.
 */
function isEnabled(): boolean {
  const v = process.env.OAUTH_DEBUG_LOG;
  if (!v) return false;
  return ["true", "1", "yes", "on"].includes(v.toLowerCase());
}

const DEBUG_ENABLED = isEnabled();

const NOOP = (_req: Request, _res: Response, next: NextFunction): void => {
  next();
};

/**
 * Express middleware that logs every request hitting an OAuth-related path
 * along with its outcome (status code, latency). Designed to make
 * misbehaving MCP clients (Claude Desktop, mcp-remote, etc.) easy to
 * diagnose without enabling provider-internal debug logging.
 *
 * Logs intentionally include query strings (auth/token/registration
 * parameters) and DCR request bodies — these are non-secret protocol
 * metadata. Authorization headers are summarized (type only) instead of
 * being logged in full so PATs and access tokens never end up in logs.
 */
export function oauthDebugLogger(scope: string) {
  if (!DEBUG_ENABLED) return NOOP;
  return (req: Request, res: Response, next: NextFunction): void => {
    const start = Date.now();
    const reqId = randomBytes(3).toString("hex");
    const auth = req.headers["authorization"];
    const authSummary = !auth
      ? "none"
      : Array.isArray(auth)
        ? "multi"
        : auth.startsWith("Bearer pat_")
          ? "Bearer pat_..."
          : auth.startsWith("Bearer ")
            ? "Bearer <opaque>"
            : auth.split(" ")[0];

    const query =
      Object.keys(req.query).length > 0
        ? ` ?${new URLSearchParams(req.query as Record<string, string>).toString()}`
        : "";

    logger.log(
      `[${scope}][${reqId}] -> ${req.method} ${req.originalUrl ?? req.url}${query} ` +
        `auth=${authSummary} ua="${(req.headers["user-agent"] ?? "").slice(0, 80)}"`,
    );

    // Log JSON request bodies for non-token endpoints. Skip token endpoint to
    // avoid logging refresh tokens or client secrets in the body.
    const path = req.path ?? req.url ?? "";
    const isTokenEndpoint =
      path.includes("/token") || path.endsWith("/token");
    if (
      !isTokenEndpoint &&
      req.body &&
      typeof req.body === "object" &&
      Object.keys(req.body).length > 0
    ) {
      try {
        logger.log(
          `[${scope}][${reqId}]    body=${JSON.stringify(redact(req.body)).slice(0, 1000)}`,
        );
      } catch {
        // ignore stringify failures
      }
    }

    res.on("finish", () => {
      const ms = Date.now() - start;
      const location = res.getHeader("location");
      const wwwAuth = res.getHeader("www-authenticate");
      const extras: string[] = [];
      if (location) extras.push(`location=${String(location).slice(0, 200)}`);
      if (wwwAuth) extras.push(`www-authenticate="${String(wwwAuth)}"`);
      logger.log(
        `[${scope}][${reqId}] <- ${res.statusCode} ${ms}ms ${extras.join(" ")}`,
      );
    });

    next();
  };
}

const SECRET_KEYS = new Set([
  "client_secret",
  "code",
  "refresh_token",
  "access_token",
  "id_token",
  "password",
  "code_verifier",
]);

function redact(obj: unknown): unknown {
  if (!obj || typeof obj !== "object") return obj;
  const out: Record<string, unknown> = {};
  for (const [k, v] of Object.entries(obj as Record<string, unknown>)) {
    if (SECRET_KEYS.has(k)) {
      out[k] = typeof v === "string" ? `<redacted:${v.length}>` : "<redacted>";
    } else {
      out[k] = v;
    }
  }
  return out;
}
