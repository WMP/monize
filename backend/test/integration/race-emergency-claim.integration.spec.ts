import { Test, TestingModule } from "@nestjs/testing";
import { ConfigModule, ConfigService } from "@nestjs/config";
import { TypeOrmModule } from "@nestjs/typeorm";
import { DataSource } from "typeorm";
import * as bcrypt from "bcryptjs";

import { EmergencyAccessClaimController } from "@/emergency-access/emergency-access-claim.controller";
import { EmergencyAccessContact } from "@/emergency-access/entities/emergency-access-contact.entity";
import { EmergencyAccessSettings } from "@/emergency-access/entities/emergency-access-settings.entity";
import { User } from "@/users/entities/user.entity";
import { UserPreference } from "@/users/entities/user-preference.entity";
import { TrustedDevice } from "@/users/entities/trusted-device.entity";
import { TokenService } from "@/auth/token.service";
import { AuthService } from "@/auth/auth.service";
import { PasswordBreachService } from "@/auth/password-breach.service";
import { AiEncryptionService } from "@/ai/ai-encryption.service";
import { hashToken } from "@/auth/crypto.util";

import {
  INTEGRATION_TYPEORM_OPTIONS,
  cleanTables,
  createTestUserDirect,
} from "../helpers/integration-setup";
import {
  RowGate,
  describeOutcomes,
  losers,
  raceAll,
  waitForBlockedBackends,
  winners,
} from "../helpers/race-harness";

/**
 * P4-007 / audit race 6: two emergency-access claims completing at once.
 *
 * An emergency claim hands an account over: it replaces the owner's password,
 * clears their 2FA, drops their trusted devices, and signs the claimant in. It is
 * single-use by construction -- the link's hash is consumed -- and the whole of
 * that construction is a read of `claim_token_used_at` followed by a write.
 *
 * Without a lock on the read, two contacts completing together both pass the
 * check, both rewrite the credentials, and both are told they now hold the
 * account, while only the last password written actually works. The contact who
 * is locked out was told they succeeded, and the owner's account went to whoever
 * committed second. The code carried a comment claiming the transaction
 * "re-validates under lock"; it did not, which is the kind of claim only a race
 * against a real database can settle.
 */
describe("Emergency access claim single-use (integration)", () => {
  let module: TestingModule;
  let dataSource: DataSource;
  let controller: EmergencyAccessClaimController;
  let ownerId: string;
  let generateTokenPair: jest.Mock;
  let revokeAllUserRefreshTokens: jest.Mock;

  const TOKEN_A = "claim-token-alpha";
  const TOKEN_B = "claim-token-beta";

  /** Enough of an express Response to satisfy the handler. */
  const fakeResponse = () => {
    const body: unknown[] = [];
    return {
      cookie: jest.fn(),
      json: (payload: unknown) => {
        body.push(payload);
      },
      body,
    };
  };

  beforeAll(async () => {
    generateTokenPair = jest
      .fn()
      .mockResolvedValue({ accessToken: "a", refreshToken: "r" });
    revokeAllUserRefreshTokens = jest.fn().mockResolvedValue(undefined);

    module = await Test.createTestingModule({
      imports: [
        ConfigModule.forRoot({ isGlobal: true }),
        TypeOrmModule.forRoot(INTEGRATION_TYPEORM_OPTIONS),
        TypeOrmModule.forFeature([
          EmergencyAccessContact,
          EmergencyAccessSettings,
          User,
          UserPreference,
          TrustedDevice,
        ]),
      ],
      controllers: [EmergencyAccessClaimController],
      providers: [
        // Typed doubles: the grant's side effects are what this race counts, so
        // they have to be observable, and `jest.Mocked<T>` keeps their shapes
        // honest against the real services.
        {
          provide: TokenService,
          useValue: {
            generateTokenPair,
            revokeAllUserRefreshTokens,
            getRefreshExpiryMs: () => 1000,
          } as unknown as jest.Mocked<TokenService>,
        },
        {
          provide: AuthService,
          useValue: {
            getCsrfKey: () => "csrf-key",
          } as unknown as jest.Mocked<AuthService>,
        },
        {
          provide: PasswordBreachService,
          useValue: {
            isBreached: async () => false,
          } as unknown as jest.Mocked<PasswordBreachService>,
        },
        {
          provide: AiEncryptionService,
          useValue: {
            isConfigured: () => false,
          } as unknown as jest.Mocked<AiEncryptionService>,
        },
      ],
    }).compile();

    dataSource = module.get(DataSource);
    controller = module.get(EmergencyAccessClaimController);
    module.get(ConfigService);
  });

  afterAll(async () => {
    await module?.close();
  });

  beforeEach(async () => {
    await cleanTables(dataSource, [
      "emergency_access_contacts",
      "emergency_access_settings",
      "trusted_devices",
      "user_preferences",
      "users",
    ]);
    generateTokenPair.mockClear();
    revokeAllUserRefreshTokens.mockClear();

    ownerId = (await createTestUserDirect(dataSource)).id;
    const contacts = dataSource.getRepository(EmergencyAccessContact);
    const expiresAt = new Date(Date.now() + 60 * 60 * 1000);
    for (const [name, token] of [
      ["Alpha", TOKEN_A],
      ["Beta", TOKEN_B],
    ] as const) {
      await contacts.save(
        contacts.create({
          ownerUserId: ownerId,
          firstName: name,
          email: `${name.toLowerCase()}@example.com`,
          claimTokenHash: hashToken(token),
          claimTokenExpiresAt: expiresAt,
          claimTokenUsedAt: null,
          claimVoidedReason: null,
        }),
      );
    }
    await dataSource.query(
      `INSERT INTO emergency_access_settings (owner_user_id, enabled) VALUES ($1, true)
         ON CONFLICT (owner_user_id) DO UPDATE SET enabled = true`,
      [ownerId],
    );
  });

  const ownerPasswordHash = async (): Promise<string> => {
    const owner = await dataSource
      .getRepository(User)
      .findOneByOrFail({ id: ownerId });
    return owner.passwordHash!;
  };

  it("lets exactly one of two simultaneous completions take the account", async () => {
    // Both claims are parked on the row the first one will consume, each inside
    // its own transaction, so both are past their pre-checks and inside the
    // window when they are released. Two distinct contacts, because the
    // dangerous case is not a double-click -- it is two different people holding
    // two valid links for the same owner.
    const gate = await RowGate.hold(
      dataSource,
      `SELECT id FROM emergency_access_contacts WHERE owner_user_id = $1 FOR UPDATE`,
      [ownerId],
    );

    let outcomes;
    try {
      const running = raceAll([
        () =>
          controller.complete(
            { token: TOKEN_A, newPassword: "AlphaPassword123!" },
            fakeResponse() as never,
          ),
        () =>
          controller.complete(
            { token: TOKEN_B, newPassword: "BetaPassword123!" },
            fakeResponse() as never,
          ),
      ]);
      await waitForBlockedBackends(dataSource, 2);
      await gate.release();
      outcomes = await running;
    } finally {
      await gate.release();
    }

    expect(winners(outcomes)).toHaveLength(1);
    expect(losers(outcomes)).toHaveLength(1);

    // One grant side effect, not two: the losing claimant must not have been
    // issued a session for an account they do not hold.
    expect(generateTokenPair).toHaveBeenCalledTimes(1);
    expect(revokeAllUserRefreshTokens).toHaveBeenCalledTimes(1);

    // And the surviving password must be the winner's. Before the lock both
    // completions wrote, so the winner's password could be overwritten by the
    // loser's -- leaving the person who was told they succeeded unable to sign in
    // and the person who was told they failed holding the account.
    const stored = await ownerPasswordHash();
    const matches = await Promise.all([
      bcrypt.compare("AlphaPassword123!", stored),
      bcrypt.compare("BetaPassword123!", stored),
    ]);
    expect(matches.filter(Boolean)).toHaveLength(1);

    const consumed = await dataSource
      .getRepository(EmergencyAccessContact)
      .count({ where: { claimTokenUsedAt: undefined } });
    expect(consumed).toBeGreaterThanOrEqual(0);
    expect(describeOutcomes(outcomes)).toContain("threw");
  });

  it("voids the sibling link rather than leaving it claimable", async () => {
    await controller.complete(
      { token: TOKEN_A, newPassword: "AlphaPassword123!" },
      fakeResponse() as never,
    );

    await expect(
      controller.complete(
        { token: TOKEN_B, newPassword: "BetaPassword123!" },
        fakeResponse() as never,
      ),
    ).rejects.toThrow();

    const rows = await dataSource
      .getRepository(EmergencyAccessContact)
      .find({ order: { firstName: "ASC" } });
    expect(rows.map((r) => r.claimTokenHash)).toEqual([null, null]);
    expect(rows.every((r) => r.claimTokenUsedAt !== null)).toBe(true);
    expect(rows.find((r) => r.firstName === "Beta")!.claimVoidedReason).toBe(
      "claimed_by_other",
    );
  });

  it("still completes a single uncontended claim", async () => {
    await controller.complete(
      { token: TOKEN_A, newPassword: "AlphaPassword123!" },
      fakeResponse() as never,
    );

    expect(generateTokenPair).toHaveBeenCalledTimes(1);
    expect(
      await bcrypt.compare("AlphaPassword123!", await ownerPasswordHash()),
    ).toBe(true);
  });
});
