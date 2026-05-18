import {
  CanActivate,
  ExecutionContext,
  ForbiddenException,
  Injectable,
} from "@nestjs/common";
import { Reflector } from "@nestjs/core";
import { JwtService } from "@nestjs/jwt";
import { Request } from "express";
import {
  ALLOW_DELEGATE_KEY,
  DELEGATED_ACCOUNT_PARAM_KEY,
} from "../decorators/delegate-access.decorator";
import { DelegationService } from "../delegation.service";

/**
 * Fail-closed enforcement for delegate ("acting as owner") requests.
 *
 * Registered globally. Because NestJS runs global guards before route-level
 * AuthGuard('jwt'), this guard does NOT rely on req.user being populated --
 * it independently reads and verifies the access token. This keeps a single
 * ordering-independent choke point.
 *
 * Behaviour:
 *  - No token / invalid token / non-delegate token: returns true. The normal
 *    AuthGuard('jwt') still authenticates/authorizes the request as before;
 *    normal users and owners are completely unaffected.
 *  - Delegate (acting) token: the route MUST be @AllowDelegate(); otherwise
 *    403. If the route is @DelegatedAccountParam(), an active READ grant for
 *    the referenced account is additionally required.
 */
@Injectable()
export class AccountDelegateGuard implements CanActivate {
  constructor(
    private reflector: Reflector,
    private jwtService: JwtService,
    private delegationService: DelegationService,
  ) {}

  async canActivate(context: ExecutionContext): Promise<boolean> {
    if (context.getType() !== "http") return true;

    const req = context.switchToHttp().getRequest<Request>();
    const token = this.extractToken(req);
    if (!token) return true;

    let payload: any;
    try {
      payload = this.jwtService.verify(token);
    } catch {
      return true; // AuthGuard('jwt') will reject it
    }

    if (payload?.type === "2fa_pending") return true;
    if (!payload?.actingAsUserId || !payload?.delegationId) {
      return true; // acting as self / normal user
    }

    const allowed = this.reflector.getAllAndOverride<boolean>(
      ALLOW_DELEGATE_KEY,
      [context.getHandler(), context.getClass()],
    );
    if (!allowed) {
      throw new ForbiddenException(
        "Delegated access is not permitted for this resource",
      );
    }

    const accountParamKey = this.reflector.getAllAndOverride<string>(
      DELEGATED_ACCOUNT_PARAM_KEY,
      [context.getHandler(), context.getClass()],
    );
    if (accountParamKey) {
      const accountId = this.resolveAccountId(req, accountParamKey);
      if (accountId) {
        const ok = await this.delegationService.hasReadAccess(
          payload.delegationId,
          accountId,
        );
        if (!ok) {
          throw new ForbiddenException(
            "You do not have access to this account",
          );
        }
      }
    }

    return true;
  }

  private extractToken(req: Request): string | null {
    const header = req.headers?.authorization;
    if (header && header.startsWith("Bearer ")) {
      return header.slice(7);
    }
    const cookieToken = (req as any).cookies?.["auth_token"];
    return typeof cookieToken === "string" ? cookieToken : null;
  }

  private resolveAccountId(req: Request, key: string): string | undefined {
    const params = req.params as Record<string, unknown> | undefined;
    const body = req.body as Record<string, unknown> | undefined;
    const query = req.query as Record<string, unknown> | undefined;
    const candidate = params?.[key] ?? body?.[key] ?? (query?.[key] as unknown);
    return typeof candidate === "string" ? candidate : undefined;
  }
}
