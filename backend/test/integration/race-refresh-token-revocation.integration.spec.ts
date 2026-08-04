import { Test, TestingModule } from "@nestjs/testing";
import { ConfigModule, ConfigService } from "@nestjs/config";
import { TypeOrmModule } from "@nestjs/typeorm";
import { JwtModule } from "@nestjs/jwt";
import { DataSource } from "typeorm";

import { TokenService } from "@/auth/token.service";
import { RefreshToken } from "@/auth/entities/refresh-token.entity";
import { User } from "@/users/entities/user.entity";
import { hashToken } from "@/auth/crypto.util";
import { withUserContext } from "@/common/db/with-context";

import {
  INTEGRATION_TYPEORM_OPTIONS,
  cleanTables,
  createTestUserDirect,
} from "../helpers/integration-setup";
import {
  RowGate,
  describeOutcomes,
  raceAll,
  waitForBlockedBackends,
  winners,
} from "../helpers/race-harness";

/**
 * P4-007 / audit race 7: a refresh rotation running against a family revocation.
 *
 * The interleaving is not exotic -- it is what a "log out everywhere" click and
 * a background token refresh do to each other, and every backend replica can
 * serve either. What makes it worth a real database is that the defect is a
 * property of MVCC rather than of the code as read: the rotation holds
 * `FOR UPDATE` on the token it replaces, so the revocation's single
 * `UPDATE ... WHERE family_id = $1` necessarily blocks behind it and necessarily
 * commits second -- with a snapshot taken before the replacement row existed.
 * The replacement therefore survives, and the user who logged out still has a
 * usable session. No unit test with a mocked manager can show that; no
 * `Promise.all` reliably reaches it either.
 *
 * The gate makes the ordering deterministic: both participants are parked on the
 * same row, in their own transactions, before either is allowed to proceed.
 */
describe("Refresh rotation vs family revocation (integration)", () => {
  let module: TestingModule;
  let dataSource: DataSource;
  let tokens: TokenService;
  let userId: string;

  beforeAll(async () => {
    module = await Test.createTestingModule({
      imports: [
        ConfigModule.forRoot({ isGlobal: true }),
        TypeOrmModule.forRoot(INTEGRATION_TYPEORM_OPTIONS),
        TypeOrmModule.forFeature([RefreshToken, User]),
        JwtModule.register({ secret: "race-harness-secret-not-a-real-key" }),
      ],
      providers: [TokenService],
    }).compile();

    dataSource = module.get(DataSource);
    tokens = module.get(TokenService);
    // Present so `refreshTokens` finds an active user; the value is irrelevant.
    module.get(ConfigService);
  });

  afterAll(async () => {
    await module?.close();
  });

  beforeEach(async () => {
    await cleanTables(dataSource, ["refresh_tokens", "users"]);
    userId = (await createTestUserDirect(dataSource)).id;
  });

  /** Issues a session and returns its raw refresh token plus its family. */
  async function issueSession(): Promise<{ raw: string; familyId: string }> {
    const user = await dataSource.getRepository(User).findOneByOrFail({
      id: userId,
    });
    const pair = await withUserContext(userId, () =>
      tokens.generateTokenPair(user),
    );
    const row = await dataSource.getRepository(RefreshToken).findOneByOrFail({
      tokenHash: hashToken(pair.refreshToken),
    });
    return { raw: pair.refreshToken, familyId: row.familyId };
  }

  const liveTokenCount = (familyId: string) =>
    dataSource
      .getRepository(RefreshToken)
      .count({ where: { familyId, isRevoked: false } });

  it("leaves no live descendant when a revocation races the rotation that created it", async () => {
    const { raw, familyId } = await issueSession();

    // Both participants must contend for the row the rotation replaces, so the
    // gate holds exactly that row and lets each of them queue behind it. The
    // order they queue in is the order they are started in, which is what makes
    // the rotation-commits-first interleaving -- the broken one -- the case under
    // test rather than a coin toss.
    const gate = await RowGate.hold(
      dataSource,
      `SELECT id FROM refresh_tokens WHERE token_hash = $1 FOR UPDATE`,
      [hashToken(raw)],
    );

    let outcomes;
    try {
      const rotating = raceAll([
        () => withUserContext(userId, () => tokens.refreshTokens(raw)),
      ]);
      await waitForBlockedBackends(dataSource, 1);

      const revoking = raceAll([
        () => withUserContext(userId, () => tokens.revokeTokenFamily(familyId)),
      ]);
      await waitForBlockedBackends(dataSource, 2);

      await gate.release();
      outcomes = [...(await rotating), ...(await revoking)];
    } finally {
      await gate.release();
    }

    // The revocation must not report success while leaving a usable token
    // behind: that is the whole claim a logout makes.
    expect(await liveTokenCount(familyId)).toBe(0);

    const rotated = winners(outcomes).find(
      (value): value is { refreshToken: string } =>
        typeof value === "object" && value !== null && "refreshToken" in value,
    );
    // With the gate's arrival ordering the rotation wins the lock, so it should
    // have produced a token -- and that token is the one that used to survive.
    expect(rotated).toBeDefined();
    expect(describeOutcomes(outcomes)).not.toContain("did not converge");

    await expect(
      withUserContext(userId, () =>
        tokens.refreshTokens(rotated!.refreshToken),
      ),
    ).rejects.toThrow();
  });

  it("leaves no live token when a whole-user revocation races a rotation", async () => {
    // `revokeAllUserRefreshTokens` is the account-lockout and password-change
    // path, and it has the same shape as the family case, so it needs the same
    // proof rather than the same assumption.
    const { raw, familyId } = await issueSession();

    const gate = await RowGate.hold(
      dataSource,
      `SELECT id FROM refresh_tokens WHERE token_hash = $1 FOR UPDATE`,
      [hashToken(raw)],
    );

    try {
      const rotating = raceAll([
        () => withUserContext(userId, () => tokens.refreshTokens(raw)),
      ]);
      await waitForBlockedBackends(dataSource, 1);

      const revoking = raceAll([
        () =>
          withUserContext(userId, () =>
            tokens.revokeAllUserRefreshTokens(userId),
          ),
      ]);
      await waitForBlockedBackends(dataSource, 2);

      await gate.release();
      await rotating;
      await revoking;
    } finally {
      await gate.release();
    }

    expect(await liveTokenCount(familyId)).toBe(0);
    expect(
      await dataSource
        .getRepository(RefreshToken)
        .count({ where: { userId, isRevoked: false } }),
    ).toBe(0);
  });

  it("still revokes an ordinary uncontended family", async () => {
    // The positive control for the loop itself: convergence logic that only
    // works under contention would be a regression in the common case.
    const { raw, familyId } = await issueSession();
    await withUserContext(userId, () => tokens.refreshTokens(raw));

    await withUserContext(userId, () => tokens.revokeTokenFamily(familyId));

    expect(await liveTokenCount(familyId)).toBe(0);
    expect(
      await dataSource
        .getRepository(RefreshToken)
        .count({ where: { familyId } }),
    ).toBe(2);
  });
});
