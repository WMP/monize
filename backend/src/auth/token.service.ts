import { Injectable, UnauthorizedException, Logger } from "@nestjs/common";
import { JwtService } from "@nestjs/jwt";
import { ConfigService } from "@nestjs/config";
import {
  DataSource,
  EntityTarget,
  LessThan,
  ObjectLiteral,
  Repository,
} from "typeorm";
import { withScopedDb } from "../common/db/scoped-db";
import { lockTokenFamily } from "../common/db/locks";
import { Cron, CronExpression } from "@nestjs/schedule";
import * as crypto from "crypto";

import { User } from "../users/entities/user.entity";
import { RefreshToken } from "./entities/refresh-token.entity";
import { hashToken } from "./crypto.util";
import { withSystemContext } from "../common/db/with-context";
import { tr } from "../i18n/translate";

export interface DelegationTokenContext {
  actingAsUserId: string;
  delegationId: string;
}

@Injectable()
export class TokenService {
  private readonly logger = new Logger(TokenService.name);
  private readonly ACCESS_TOKEN_EXPIRY = "15m";
  private readonly REFRESH_TOKEN_EXPIRY_MS = 1 * 24 * 60 * 60 * 1000; // 1 day
  private readonly REMEMBER_ME_EXPIRY_MS: number;

  constructor(
    private jwtService: JwtService,
    private dataSource: DataSource,
    private configService: ConfigService,
  ) {
    const rememberMeDays = parseInt(
      this.configService.get<string>("REMEMBER_ME_DAYS", "30"),
      10,
    );
    this.REMEMBER_ME_EXPIRY_MS =
      (rememberMeDays > 0 ? rememberMeDays : 30) * 24 * 60 * 60 * 1000;
  }

  /**
   * One repository call in its own short scoped transaction -- the RLS-era
   * replacement for the injected repositories this class used to hold, with the
   * same autocommit boundary each of those calls had. Multi-statement units use
   * an explicit `withScopedDb` block so their statements share one transaction.
   */
  private scoped<E extends ObjectLiteral, T>(
    entity: EntityTarget<E>,
    fn: (repo: Repository<E>) => Promise<T>,
  ): Promise<T> {
    return withScopedDb(this.dataSource, (manager) =>
      fn(manager.getRepository(entity)),
    );
  }

  getRefreshExpiryMs(rememberMe?: boolean): number {
    return rememberMe
      ? this.REMEMBER_ME_EXPIRY_MS
      : this.REFRESH_TOKEN_EXPIRY_MS;
  }

  async generateTokenPair(
    user: User,
    rememberMe?: boolean,
    context?: DelegationTokenContext,
  ): Promise<{ accessToken: string; refreshToken: string }> {
    // SECURITY: `sub` is ALWAYS the real authenticated user. When acting as a
    // delegate the data-scoping id is carried separately in actingAsUserId so
    // refresh rotation / family revocation / replay detection keep keying off
    // the real user.
    const payload: Record<string, unknown> = {
      sub: user.id,
      email: user.email,
      authProvider: user.authProvider,
      role: user.role,
    };
    if (context?.actingAsUserId && context?.delegationId) {
      payload.actingAsUserId = context.actingAsUserId;
      payload.delegationId = context.delegationId;
    }
    const accessToken = this.jwtService.sign(payload, {
      expiresIn: this.ACCESS_TOKEN_EXPIRY,
    });

    const rawRefreshToken = crypto.randomBytes(64).toString("hex");
    const tokenHash = hashToken(rawRefreshToken);
    const familyId = crypto.randomUUID();
    const expiryMs = this.getRefreshExpiryMs(rememberMe);

    await withScopedDb(this.dataSource, (manager) => {
      const repo = manager.getRepository(RefreshToken);
      return repo.save(
        repo.create({
          userId: user.id,
          tokenHash,
          familyId,
          isRevoked: false,
          expiresAt: new Date(Date.now() + expiryMs),
          replacedByHash: null,
          rememberMe: !!rememberMe,
          actingAsUserId: context?.actingAsUserId ?? null,
          delegationId: context?.delegationId ?? null,
        }),
      );
    });

    return { accessToken, refreshToken: rawRefreshToken };
  }

  async refreshTokens(
    rawRefreshToken: string,
  ): Promise<{ accessToken: string; refreshToken: string; userId: string }> {
    const tokenHash = hashToken(rawRefreshToken);

    return withScopedDb(this.dataSource, async (manager) => {
      // SECURITY: the family lock comes FIRST, before any row lock, and this
      // unlocked read exists only to learn which family to lock.
      //
      // The family lock is what makes revocation whole. Revocation is an `UPDATE
      // ... WHERE family_id = ?`, and under READ COMMITTED that statement uses
      // one snapshot: blocked on the old row, it waits, updates it -- and never
      // sees the replacement this rotation inserted *after* the snapshot was
      // taken. Logout returned success with a usable token still in the family
      // (audit P4-011).
      //
      // The order is not incidental. Taking the row lock first and the family
      // lock second would deadlock against `revokeAllUserRefreshTokens`, which
      // holds families and then wants rows. Family-then-rows, everywhere.
      // `family_id` never changes for a token row, so reading it unlocked is
      // safe -- everything the decisions below rest on is re-read under the lock.
      const familyProbe = await manager.findOne(RefreshToken, {
        where: { tokenHash },
        select: { familyId: true },
      });

      if (!familyProbe) {
        throw new UnauthorizedException(
          tr("errors.auth.invalidRefreshToken", "Invalid refresh token"),
        );
      }

      await lockTokenFamily(manager, familyProbe.familyId);

      // Re-read under the row lock, now that the family is held: this is the
      // version the rotation replaces.
      const existingToken = await manager.findOne(RefreshToken, {
        where: { tokenHash },
        lock: { mode: "pessimistic_write" },
      });

      if (!existingToken) {
        throw new UnauthorizedException(
          tr("errors.auth.invalidRefreshToken", "Invalid refresh token"),
        );
      }

      // Replay detection: if token is revoked, a previously-rotated token was reused
      if (existingToken.isRevoked) {
        await manager.update(
          RefreshToken,
          { familyId: existingToken.familyId },
          { isRevoked: true },
        );
        throw new UnauthorizedException(
          tr(
            "errors.auth.refreshTokenReuseDetected",
            "Refresh token reuse detected",
          ),
        );
      }

      if (existingToken.expiresAt < new Date()) {
        existingToken.isRevoked = true;
        await manager.save(existingToken);
        throw new UnauthorizedException(
          tr("errors.auth.refreshTokenExpired", "Refresh token expired"),
        );
      }

      const user = await manager.findOne(User, {
        where: { id: existingToken.userId },
      });

      if (!user || !user.isActive) {
        await manager.update(
          RefreshToken,
          { familyId: existingToken.familyId },
          { isRevoked: true },
        );
        throw new UnauthorizedException(
          tr(
            "errors.auth.userNotFoundOrInactive",
            "User not found or inactive",
          ),
        );
      }

      // Rotate: generate new refresh token in the same family
      const newRawRefreshToken = crypto.randomBytes(64).toString("hex");
      const newTokenHash = hashToken(newRawRefreshToken);

      existingToken.isRevoked = true;
      existingToken.replacedByHash = newTokenHash;
      await manager.save(existingToken);

      const rotatedExpiryMs = this.getRefreshExpiryMs(existingToken.rememberMe);
      const newRefreshTokenEntity = manager.create(RefreshToken, {
        userId: user.id,
        tokenHash: newTokenHash,
        familyId: existingToken.familyId,
        isRevoked: false,
        expiresAt: new Date(Date.now() + rotatedExpiryMs),
        replacedByHash: null,
        rememberMe: existingToken.rememberMe,
        // Carry the delegate "acting as owner" context forward through
        // rotation so the context survives access-token expiry.
        actingAsUserId: existingToken.actingAsUserId ?? null,
        delegationId: existingToken.delegationId ?? null,
      });
      await manager.save(newRefreshTokenEntity);

      const payload: Record<string, unknown> = {
        sub: user.id,
        email: user.email,
        authProvider: user.authProvider,
        role: user.role,
      };
      if (existingToken.actingAsUserId && existingToken.delegationId) {
        payload.actingAsUserId = existingToken.actingAsUserId;
        payload.delegationId = existingToken.delegationId;
      }
      const accessToken = this.jwtService.sign(payload, {
        expiresIn: this.ACCESS_TOKEN_EXPIRY,
      });

      return {
        accessToken,
        refreshToken: newRawRefreshToken,
        userId: user.id,
      };
    });
  }

  /**
   * Revoke every token in one family, under the family lock.
   *
   * The lock is what makes the guarantee whole. Without it a concurrent rotation
   * could insert a replacement after this statement's snapshot was taken, so the
   * update covered the old row and missed the new one -- and the caller was told
   * the family was revoked.
   */
  async revokeTokenFamily(familyId: string): Promise<void> {
    await withScopedDb(this.dataSource, async (manager) => {
      await lockTokenFamily(manager, familyId);
      await manager
        .getRepository(RefreshToken)
        .update({ familyId }, { isRevoked: true });
    });
  }

  /**
   * Log out: revoke the presented token's whole family.
   *
   * Lookup and revocation are ONE transaction. Two of them let a rotation slip
   * between the read and the family update; the family lock inside
   * `revokeTokenFamily` joins this transaction, so the ordering holds from the
   * lookup onwards.
   */
  async revokeRefreshToken(rawRefreshToken: string): Promise<void> {
    if (!rawRefreshToken) return;
    const tokenHash = hashToken(rawRefreshToken);
    await withScopedDb(this.dataSource, async (manager) => {
      const token = await manager.getRepository(RefreshToken).findOne({
        where: { tokenHash },
      });
      if (!token) return;
      await this.revokeTokenFamily(token.familyId);
    });
  }

  /**
   * Revoke every session this user has, whatever family it belongs to.
   *
   * Loops until a pass revokes nothing. One `UPDATE ... WHERE is_revoked = false`
   * has the same statement-snapshot blind spot as family revocation, and here
   * there is no single family to lock -- a rotation in any of the user's families
   * can insert a replacement the update never sees. Re-reading until a pass is
   * empty converges instead: each pass revokes what the previous one exposed, and
   * a rotation can only add a replacement for a token it has just revoked.
   */
  async revokeAllUserRefreshTokens(userId: string): Promise<void> {
    // Bounded: a legitimate client rotates once per refresh, so two passes is
    // the realistic worst case. The cap stops a pathological caller spinning
    // here forever rather than expressing a real expectation.
    const MAX_PASSES = 10;
    for (let pass = 0; pass < MAX_PASSES; pass++) {
      const affected = await withScopedDb(this.dataSource, async (manager) => {
        const families: { family_id: string }[] = await manager.query(
          `SELECT DISTINCT family_id FROM refresh_tokens
            WHERE user_id = $1 AND is_revoked = false`,
          [userId],
        );
        if (families.length === 0) return 0;
        // Ascending, the same fixed order every other multi-lock path uses.
        for (const { family_id } of [...families].sort((a, b) =>
          a.family_id.localeCompare(b.family_id),
        )) {
          await lockTokenFamily(manager, family_id);
        }
        const result = await manager
          .getRepository(RefreshToken)
          .update({ userId, isRevoked: false }, { isRevoked: true });
        return result.affected ?? 0;
      });
      if (affected === 0) return;
    }
    this.logger.warn(
      `Gave up revoking sessions for user ${userId} after ${MAX_PASSES} passes; ` +
        "a client may be rotating refresh tokens in a loop",
    );
  }

  @Cron(CronExpression.EVERY_DAY_AT_3AM)
  async purgeExpiredRefreshTokens(): Promise<void> {
    // RLS (task C2): cross-user bulk purge -- runs under a system context.
    return withSystemContext(() =>
      this.purgeExpiredRefreshTokensWithinContext(),
    );
  }

  private async purgeExpiredRefreshTokensWithinContext(): Promise<void> {
    const expiredResult = await this.scoped(RefreshToken, (repo) =>
      repo.delete({
        expiresAt: LessThan(new Date()),
      }),
    );

    const revokedResult = await this.scoped(RefreshToken, (repo) =>
      repo.delete({
        isRevoked: true,
      }),
    );

    const totalPurged =
      (expiredResult.affected || 0) + (revokedResult.affected || 0);
    if (totalPurged > 0) {
      this.logger.log(`Purged ${totalPurged} expired/revoked refresh tokens`);
    }
  }
}
