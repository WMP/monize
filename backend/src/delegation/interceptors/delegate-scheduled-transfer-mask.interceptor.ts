import {
  CallHandler,
  ExecutionContext,
  Injectable,
  NestInterceptor,
} from "@nestjs/common";
import { Request } from "express";
import { Observable, from, switchMap } from "rxjs";
import { map } from "rxjs/operators";
import { DelegationService } from "../delegation.service";

const HIDDEN = "Hidden account";

/**
 * 3B: when a delegate (acting as owner) reads scheduled transactions, any
 * scheduled transfer whose counterpart account they lack READ on must be
 * masked so the other side shows "Hidden account" instead of the real
 * account/name. Mirrors DelegateTransferMaskInterceptor but for the
 * scheduled-transaction shape (transferAccount / transferAccountId).
 *
 * Runs after the route handler, so req.user is populated by JwtStrategy.
 * Non-delegate requests pass straight through.
 */
@Injectable()
export class DelegateScheduledTransferMaskInterceptor implements NestInterceptor {
  constructor(private readonly delegationService: DelegationService) {}

  intercept(context: ExecutionContext, next: CallHandler): Observable<unknown> {
    if (context.getType() !== "http") return next.handle();
    const req = context
      .switchToHttp()
      .getRequest<
        Request & { user?: { isActing?: boolean; delegationId?: string } }
      >();
    const user = req.user;
    if (!user?.isActing || !user.delegationId) {
      return next.handle();
    }
    const delegationId = user.delegationId;

    return next.handle().pipe(
      switchMap((body) =>
        from(this.delegationService.readableAccountIds(delegationId)).pipe(
          map((readableIds) => {
            const readable = new Set(readableIds);
            this.maskPayload(body, readable);
            return body;
          }),
        ),
      ),
    );
  }

  private maskPayload(body: unknown, readable: Set<string>): void {
    if (Array.isArray(body)) {
      body.forEach((s) => this.maskScheduled(s, readable));
      return;
    }
    if (body && typeof body === "object") {
      const obj = body as Record<string, unknown>;
      if (Array.isArray(obj.data)) {
        (obj.data as unknown[]).forEach((s) => this.maskScheduled(s, readable));
        return;
      }
      this.maskScheduled(body, readable);
    }
  }

  private maskScheduled(st: unknown, readable: Set<string>): void {
    if (!st || typeof st !== "object") return;
    const s = st as Record<string, any>;
    this.maskLeg(s, readable);
    if (Array.isArray(s.splits)) {
      s.splits.forEach((sp: unknown) => {
        if (sp && typeof sp === "object") {
          this.maskLeg(sp as Record<string, any>, readable);
        }
      });
    }
  }

  private maskLeg(s: Record<string, any>, readable: Set<string>): void {
    const otherId: string | undefined = s.transferAccountId;
    if (!s.isTransfer && !otherId) return;
    if (!otherId || readable.has(otherId)) return;
    if (s.transferAccount && typeof s.transferAccount === "object") {
      s.transferAccount = { id: otherId, name: HIDDEN };
    }
    if (typeof s.transferAccountName === "string") {
      s.transferAccountName = HIDDEN;
    }
  }
}
