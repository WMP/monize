import { Test, TestingModule } from "@nestjs/testing";
import { DataSource } from "typeorm";
import { ConfigService } from "@nestjs/config";
import { I18nService } from "nestjs-i18n";
import { EmergencyAccessMonitorService } from "./emergency-access-monitor.service";
import { EmergencyAccessSettings } from "./entities/emergency-access-settings.entity";
import { EmergencyAccessContact } from "./entities/emergency-access-contact.entity";
import { AiEncryptionService } from "../ai/ai-encryption.service";
import { EmailService } from "../notifications/email.service";
import { User } from "../users/entities/user.entity";
import { UserPreference } from "../users/entities/user-preference.entity";
import { getRequestContext } from "../common/request-context";
import { hashToken } from "../auth/crypto.util";
import { createScopedDbMocks } from "../test-helpers/scoped-db-testing";
import {
  createJobClaimMock,
  JobClaimMock,
  jobClaimProvider,
} from "../test-helpers/job-claim-testing";

jest.mock("../common/db/scoped-db", () =>
  jest.requireActual("../test-helpers/scoped-db-testing").scopedDbMockModule(),
);

describe("EmergencyAccessMonitorService", () => {
  /** Wins every claim, matching the pre-claim behaviour these specs describe. */
  const jobClaims: JobClaimMock = createJobClaimMock();
  /** Whether the conditional grant-claim UPDATE returns a row this run. */
  let grantClaimWins: boolean;
  let scopedManagerQuery: jest.Mock;
  let service: EmergencyAccessMonitorService;
  let settingsRepo: Record<string, jest.Mock>;
  let contactsRepo: Record<string, jest.Mock>;
  let usersRepo: Record<string, jest.Mock>;
  let prefsRepo: Record<string, jest.Mock>;
  let emailService: Record<string, jest.Mock>;
  let encryption: Record<string, jest.Mock>;
  let configService: Record<string, jest.Mock>;

  const userId = "11111111-1111-1111-1111-111111111111";

  function daysAgo(n: number): Date {
    return new Date(Date.now() - n * 24 * 60 * 60 * 1000);
  }

  /**
   * A contacts `find` that honours the `claimNotifiedAt IS NULL` predicate.
   *
   * That predicate is the mechanism under test -- it is what makes a resumed
   * grant skip a contact who already holds a working link -- so a spec about the
   * resume path cannot use a `mockResolvedValue` that returns everything. Specs
   * that do not care keep the simpler double.
   */
  function contactsAre(
    rows: {
      id: string;
      firstName: string;
      email: string;
      notified?: boolean;
      /** A credential from an earlier attempt that was never confirmed sent. */
      undeliveredToken?: string;
      /** A token issued by a version that did not keep it -- hash, no ciphertext. */
      unrecoverableToken?: boolean;
    }[],
  ): void {
    contactsRepo.find.mockImplementation(
      async (opts?: { where?: Record<string, unknown> }) => {
        const wantsPending = "claimNotifiedAt" in (opts?.where ?? {});
        return rows
          .filter((row) => !wantsPending || !row.notified)
          .map((row) => ({
            id: row.id,
            firstName: row.firstName,
            email: row.email,
            claimNotifiedAt: row.notified ? daysAgo(1) : null,
            claimTokenHash: row.undeliveredToken
              ? hashToken(row.undeliveredToken)
              : row.unrecoverableToken
                ? "a-hash-from-an-older-version"
                : null,
            claimTokenCiphertext: row.undeliveredToken
              ? `enc(${row.undeliveredToken})`
              : null,
          }));
      },
    );
  }

  /** The claim URLs this run put in front of recipients. */
  function sentClaimUrls(): string[] {
    return emailService.sendMail.mock.calls
      .map((call) => /token=([0-9a-f]+)/.exec(String(call[2]))?.[1])
      .filter((token): token is string => Boolean(token));
  }

  /** The contact ids whose delivery record this run stamped. */
  function notifiedContactIds(): string[] {
    return contactsRepo.createQueryBuilder.mock.results.flatMap((result) => {
      if (result.type !== "return") return [];
      const builder = result.value as {
        set: jest.Mock;
        where: jest.Mock;
      };
      const stampedNotified = builder.set.mock.calls.some(
        (call) => "claimNotifiedAt" in (call[0] ?? {}),
      );
      if (!stampedNotified) return [];
      return builder.where.mock.calls
        .map((call) => (call[1] as { id?: string } | undefined)?.id)
        .filter((id): id is string => typeof id === "string");
    });
  }

  beforeEach(async () => {
    // The claim double is shared across tests, so its recorded calls and any
    // queued `...Once` would otherwise leak forward -- which is invisible until a
    // spec asserts a claim was *not* taken, and then reads as a product bug.
    jobClaims.claimOnce.mockReset().mockResolvedValue(true);
    jobClaims.claimLease.mockReset().mockResolvedValue(true);
    jobClaims.release.mockReset().mockResolvedValue(undefined);

    settingsRepo = {
      find: jest.fn().mockResolvedValue([]),
      // The reminder's delivery record is re-read under the lease, because a
      // claim says "may I send" and only `lastReminderSentAt` says "this was
      // sent" (audit FV4-005). Served from the rows this spec's `find` returned,
      // so a fixture that sets `lastReminderSentAt` states the committed value
      // once rather than twice.
      findOne: jest.fn(async (opts?: { where?: { ownerUserId?: string } }) => {
        const wanted = opts?.where?.ownerUserId;
        for (const result of settingsRepo.find.mock.results) {
          if (result.type !== "return") continue;
          const rows = (await result.value) as
            | { ownerUserId?: string }[]
            | undefined;
          const hit = rows?.find(
            (row) => wanted === undefined || row.ownerUserId === wanted,
          );
          if (hit) return hit;
        }
        return null;
      }),
      save: jest.fn(),
      // grantedAt / lastReminderSentAt are now written with targeted UPDATEs
      // rather than by re-saving the entity the sweep read, so a concurrent
      // settings change is not reverted by a bookkeeping write.
      createQueryBuilder: jest.fn(() => ({
        update: jest.fn().mockReturnThis(),
        set: jest.fn().mockReturnThis(),
        where: jest.fn().mockReturnThis(),
        execute: jest.fn().mockResolvedValue({ affected: 1 }),
      })),
    };
    contactsRepo = {
      find: jest.fn().mockResolvedValue([]),
      save: jest.fn(async (row) => row),
      createQueryBuilder: jest.fn(() => ({
        update: jest.fn().mockReturnThis(),
        set: jest.fn().mockReturnThis(),
        where: jest.fn().mockReturnThis(),
        andWhere: jest.fn().mockReturnThis(),
        execute: jest.fn().mockResolvedValue({ affected: 1 }),
      })),
    };
    usersRepo = { findOne: jest.fn() };
    prefsRepo = { findOne: jest.fn().mockResolvedValue(null) };
    emailService = {
      getStatus: jest.fn().mockReturnValue({ configured: true }),
      sendMail: jest.fn().mockResolvedValue(undefined),
    };
    encryption = {
      isConfigured: jest.fn().mockReturnValue(true),
      // A real round trip, not two unrelated stubs: the credential a retry
      // re-sends is the one the first attempt stored, so a double that could not
      // decrypt what it encrypted would make the reuse path untestable and the
      // rotation path look like the only one (audit RV4-004).
      encrypt: jest.fn((plain: string) => `enc(${plain})`),
      decrypt: jest.fn((s) => s.replace(/^enc\(/, "").replace(/\)$/, "")),
    };
    configService = {
      get: jest.fn((key: string, fallback: string) => fallback),
    };

    // Every read/write now runs through `withScopedDb`; the former QueryRunner
    // is the transaction's EntityManager, so keep `queryRunner.manager` pointing
    // at the same jest.fn()s the manager exposes.
    const scoped = createScopedDbMocks([
      [EmergencyAccessSettings, settingsRepo as never],
      [EmergencyAccessContact, contactsRepo as never],
      [User, usersRepo as never],
      [UserPreference, prefsRepo as never],
    ]);
    // The grant transition is claimed with a conditional UPDATE ... RETURNING,
    // so exactly one replica may issue tokens (audit P4-014). The default is
    // "this process won the claim", which is what the pre-claim specs describe;
    // `losesGrantClaim()` below is the other side.
    grantClaimWins = true;
    scopedManagerQuery = scoped.manager.query;
    scoped.manager.query.mockImplementation(async (sql: string) => {
      if (sql.includes("UPDATE emergency_access_settings")) {
        return grantClaimWins ? [[{ owner_user_id: "claimed" }], 1] : [[], 0];
      }
      return [];
    });
    const dataSource = scoped.dataSource;

    const module: TestingModule = await Test.createTestingModule({
      providers: [
        { provide: DataSource, useValue: dataSource },
        EmergencyAccessMonitorService,
        jobClaimProvider(jobClaims),
        { provide: EmailService, useValue: emailService },
        { provide: AiEncryptionService, useValue: encryption },
        { provide: ConfigService, useValue: configService },
        {
          provide: I18nService,
          useValue: {
            translate: (key: string, opts?: { defaultValue?: string }) =>
              opts?.defaultValue ?? key,
          },
        },
      ],
    }).compile();

    service = module.get(EmergencyAccessMonitorService);
  });

  it("returns immediately when SMTP is not configured", async () => {
    emailService.getStatus.mockReturnValue({ configured: false });
    await service.runDailyCheck();
    expect(settingsRepo.find).not.toHaveBeenCalled();
    expect(emailService.sendMail).not.toHaveBeenCalled();
  });

  // RLS (task C4): the cross-user sweep runs under a system context.
  it("runs the sweep under a system context", async () => {
    let ctx: ReturnType<typeof getRequestContext>;
    settingsRepo.find.mockImplementation(() => {
      ctx = getRequestContext();
      return Promise.resolve([]);
    });
    await service.runDailyCheck();
    expect(ctx).toEqual({ system: true });
  });

  it("sends a reminder when inactivity exceeds reminderAfterDays but not grantAfterDays", async () => {
    settingsRepo.find.mockResolvedValue([
      {
        ownerUserId: userId,
        enabled: true,
        grantAfterDays: 14,
        reminderAfterDays: 7,
        messageCiphertext: null,
        lastReminderSentAt: null,
        grantedAt: null,
      },
    ]);
    usersRepo.findOne.mockResolvedValue({
      id: userId,
      email: "owner@example.com",
      firstName: "Owner",
      lastName: "One",
      isActive: true,
      lastActivityAt: daysAgo(10),
    });
    contactsRepo.find.mockResolvedValue([
      { firstName: "Carol", email: "carol@example.com" },
    ]);

    await service.runDailyCheck();

    expect(emailService.sendMail).toHaveBeenCalledTimes(1);
    const [to, subject] = emailService.sendMail.mock.calls[0];
    expect(to).toBe("owner@example.com");
    expect(subject).toContain("10");
    // Two separate jobs: the lease excludes the other replica right now, and
    // `lastReminderSentAt` -- written below -- is what says the day is spent. A
    // permanent claim taken before the send was both, so a replica killed in
    // between consumed the day and sent nothing (audit FV4-005).
    expect(jobClaims.claimLease).toHaveBeenCalledWith(
      "emergency_access_reminder",
      userId,
      expect.stringMatching(/^\d{4}-\d{2}-\d{2}$/),
      expect.any(Number),
    );
    expect(jobClaims.claimOnce).not.toHaveBeenCalledWith(
      "emergency_access_reminder",
      userId,
      expect.anything(),
    );
    // And the timestamp is written with a targeted UPDATE, not by re-saving the
    // settings row the sweep read.
    expect(settingsRepo.createQueryBuilder).toHaveBeenCalled();
  });

  it("does not send the reminder while another replica holds the lease", async () => {
    jobClaims.claimLease.mockResolvedValueOnce(false);

    await service.runDailyCheck();

    expect(emailService.sendMail).not.toHaveBeenCalled();
  });

  it("issues a grant token + email to every contact once grantAfterDays is reached", async () => {
    const settings = {
      ownerUserId: userId,
      enabled: true,
      grantAfterDays: 14,
      reminderAfterDays: 7,
      messageCiphertext: "enc(my last wishes)",
      lastReminderSentAt: null,
      grantedAt: null,
    };
    settingsRepo.find.mockResolvedValue([settings]);
    usersRepo.findOne.mockResolvedValue({
      id: userId,
      email: "owner@example.com",
      firstName: "Owner",
      lastName: "One",
      isActive: true,
      lastActivityAt: daysAgo(20),
    });
    contactsRepo.find.mockResolvedValue([
      { id: "c1", firstName: "Carol", email: "carol@example.com" },
      { id: "c2", firstName: "Dave", email: "dave@example.com" },
    ]);

    await service.runDailyCheck();

    expect(emailService.sendMail).toHaveBeenCalledTimes(2);
    const recipients = emailService.sendMail.mock.calls.map((c) => c[0]);
    expect(recipients).toEqual(["carol@example.com", "dave@example.com"]);
    expect(contactsRepo.save).toHaveBeenCalledTimes(2);
    expect(contactsRepo.save.mock.calls[0][0].claimTokenHash).toBeTruthy();
    // grantedAt is set by the conditional claim UPDATE, before any token is
    // generated -- not by saving the entity after the emails went out. That
    // ordering is the fix: two replicas both saw null and both sent, and only
    // the last token hash written was still valid (audit P4-014).
    const claimSql = scopedManagerQuery.mock.calls
      .map((c) => String(c[0]))
      .find((sql) => sql.includes("UPDATE emergency_access_settings"));
    expect(claimSql).toContain("granted_at IS NULL");
    expect(claimSql).toContain("RETURNING");
  });

  it("issues nothing when another replica won the grant claim", async () => {
    grantClaimWins = false;

    await service.runDailyCheck();

    expect(contactsRepo.save).not.toHaveBeenCalled();
    expect(emailService.sendMail).not.toHaveBeenCalled();
  });

  it("does not re-issue grants once granted_at is set", async () => {
    settingsRepo.find.mockResolvedValue([
      {
        ownerUserId: userId,
        enabled: true,
        grantAfterDays: 14,
        reminderAfterDays: 7,
        messageCiphertext: null,
        lastReminderSentAt: daysAgo(0),
        grantedAt: daysAgo(1),
      },
    ]);
    usersRepo.findOne.mockResolvedValue({
      id: userId,
      email: "owner@example.com",
      isActive: true,
      lastActivityAt: daysAgo(20),
    });

    await service.runDailyCheck();
    expect(emailService.sendMail).not.toHaveBeenCalled();
  });

  /**
   * FV4-004: the crash window between the grant claim and the emails.
   *
   * `granted_at` used to be the claim and the grant state at once, so a replica
   * killed in between left the account permanently marked granted with nobody
   * holding a link -- and step 1's `granted_at IS NULL` predicate meant nothing
   * would ever look again. The delivery record is per contact now, so the state
   * is discoverable: a granted owner with an un-notified contact is a link owed.
   */
  describe("a grant that was claimed but never delivered", () => {
    const grantedButUndelivered = () => {
      settingsRepo.find.mockResolvedValue([
        {
          ownerUserId: userId,
          enabled: true,
          grantAfterDays: 14,
          reminderAfterDays: 7,
          messageCiphertext: null,
          lastReminderSentAt: null,
          // The claim committed; the process died before any email.
          grantedAt: daysAgo(1),
        },
      ]);
      usersRepo.findOne.mockResolvedValue({
        id: userId,
        email: "owner@example.com",
        firstName: "Owner",
        isActive: true,
        lastActivityAt: daysAgo(20),
      });
    };

    it("resumes delivery for the contacts still owed a link", async () => {
      grantedButUndelivered();
      contactsAre([
        { id: "c1", firstName: "Carol", email: "carol@example.com" },
        { id: "c2", firstName: "Dave", email: "dave@example.com" },
      ]);

      await service.runDailyCheck();

      expect(emailService.sendMail.mock.calls.map((c) => c[0])).toEqual([
        "carol@example.com",
        "dave@example.com",
      ]);
      expect(notifiedContactIds()).toEqual(["c1", "c2"]);
      // The grant is already ours; it must not be re-claimed or re-set.
      expect(
        scopedManagerQuery.mock.calls
          .map((c) => String(c[0]))
          .filter((sql) => sql.includes("UPDATE emergency_access_settings")),
      ).toEqual([]);
    });

    it("never re-issues a token for a contact who already received one", async () => {
      grantedButUndelivered();
      contactsAre([
        {
          id: "c1",
          firstName: "Carol",
          email: "carol@example.com",
          notified: true,
        },
        { id: "c2", firstName: "Dave", email: "dave@example.com" },
      ]);

      await service.runDailyCheck();

      // Re-issuing Carol's token would invalidate the link already in her inbox,
      // and a dead emergency-access link during a recovery is indistinguishable
      // from a revoked one -- the exact P4-014 failure this must not reintroduce.
      expect(emailService.sendMail.mock.calls.map((c) => c[0])).toEqual([
        "dave@example.com",
      ]);
      expect(contactsRepo.save).toHaveBeenCalledTimes(1);
      expect(contactsRepo.save.mock.calls[0][0].email).toBe("dave@example.com");
    });

    it("takes a lease, so two replicas do not both resume it", async () => {
      grantedButUndelivered();
      contactsAre([{ id: "c1", firstName: "Carol", email: "c@example.com" }]);
      jobClaims.claimLease.mockResolvedValueOnce(false);

      await service.runDailyCheck();

      expect(jobClaims.claimLease).toHaveBeenCalledWith(
        "emergency_access_grant_notify",
        userId,
        expect.stringMatching(/^\d{4}-\d{2}-\d{2}$/),
        expect.any(Number),
      );
      expect(emailService.sendMail).not.toHaveBeenCalled();
    });

    it("does nothing when every contact has already been notified", async () => {
      grantedButUndelivered();
      contactsAre([
        {
          id: "c1",
          firstName: "Carol",
          email: "c@example.com",
          notified: true,
        },
      ]);

      await service.runDailyCheck();

      expect(emailService.sendMail).not.toHaveBeenCalled();
      expect(jobClaims.claimLease).not.toHaveBeenCalled();
    });

    /**
     * The send-to-marker crash boundary (audit RV4-004).
     *
     * SMTP acceptance and the delivery record cannot commit together, so a
     * process killed between them leaves a contact who may already hold a working
     * link while the row still says the notice is owed. The retry must re-send the
     * *same* link: minting a new one overwrites the hash and kills what is already
     * in their inbox, and a second send failure then leaves them with a dead link
     * during a recovery.
     */
    it("re-sends the same link rather than minting one that kills the delivered link", async () => {
      grantedButUndelivered();
      const alreadyIssued = "a".repeat(64);
      contactsAre([
        {
          id: "c1",
          firstName: "Carol",
          email: "carol@example.com",
          undeliveredToken: alreadyIssued,
        },
      ]);

      await service.runDailyCheck();

      expect(sentClaimUrls()).toEqual([alreadyIssued]);
      // Nothing on the row changed, so a link already delivered keeps working
      // whatever happens to this attempt.
      expect(contactsRepo.save).not.toHaveBeenCalled();
    });

    it("leaves the delivered link valid when the retry's own send fails too", async () => {
      grantedButUndelivered();
      const alreadyIssued = "b".repeat(64);
      contactsAre([
        {
          id: "c1",
          firstName: "Carol",
          email: "carol@example.com",
          undeliveredToken: alreadyIssued,
        },
      ]);
      emailService.sendMail.mockRejectedValue(new Error("smtp down"));

      await service.runDailyCheck();

      // The hash is untouched, so the token in Carol's inbox still verifies, and
      // the notice is still recorded as owed.
      expect(contactsRepo.save).not.toHaveBeenCalled();
      expect(notifiedContactIds()).toEqual([]);
    });

    it("clears the stored credential once delivery is recorded", async () => {
      grantedButUndelivered();
      contactsAre([
        {
          id: "c1",
          firstName: "Carol",
          email: "carol@example.com",
          undeliveredToken: "c".repeat(64),
        },
      ]);

      await service.runDailyCheck();

      // A credential is a credential: once there is nothing left to re-send it
      // must not outlive the delivery it existed for.
      const cleared = contactsRepo.createQueryBuilder.mock.results
        .flatMap((result) =>
          result.type === "return"
            ? (result.value as { set: jest.Mock }).set.mock.calls
            : [],
        )
        .map((call) => call[0] as Record<string, unknown>);
      expect(cleared).toContainEqual(
        expect.objectContaining({ claimTokenCiphertext: null }),
      );
    });

    it("rotates a token this version cannot re-send, and says so", async () => {
      // A legacy row: hash present, no stored credential. Replacing it is
      // deliberate -- a link that is delivered beats one nobody can confirm, and
      // asserting delivery instead would disarm the safeguard permanently
      // (audit RV4-003).
      grantedButUndelivered();
      contactsAre([
        {
          id: "c1",
          firstName: "Carol",
          email: "carol@example.com",
          unrecoverableToken: true,
        },
      ]);
      const warn = jest
        .spyOn(service["logger"], "warn")
        .mockImplementation(() => undefined);

      await service.runDailyCheck();

      expect(contactsRepo.save).toHaveBeenCalledTimes(1);
      expect(sentClaimUrls()).toHaveLength(1);
      expect(warn).toHaveBeenCalledWith(
        expect.stringContaining("cannot re-send"),
      );
    });

    it("rotates and reports when the stored credential does not decrypt", async () => {
      grantedButUndelivered();
      contactsAre([
        {
          id: "c1",
          firstName: "Carol",
          email: "carol@example.com",
          undeliveredToken: "d".repeat(64),
        },
      ]);
      encryption.decrypt.mockImplementation(() => {
        throw new Error("bad key");
      });
      const error = jest
        .spyOn(service["logger"], "error")
        .mockImplementation(() => undefined);

      await service.runDailyCheck();

      expect(contactsRepo.save).toHaveBeenCalledTimes(1);
      expect(error).toHaveBeenCalledWith(
        expect.stringContaining("Could not read the stored"),
      );
    });

    it("rotates when the stored credential no longer matches its hash", async () => {
      grantedButUndelivered();
      contactsAre([
        {
          id: "c1",
          firstName: "Carol",
          email: "carol@example.com",
          undeliveredToken: "e".repeat(64),
        },
      ]);
      // The ciphertext decrypts, but to something the hash does not verify -- the
      // pair is inconsistent, so neither can be trusted to be what was delivered.
      encryption.decrypt.mockReturnValue("f".repeat(64));
      const error = jest
        .spyOn(service["logger"], "error")
        .mockImplementation(() => undefined);

      await service.runDailyCheck();

      expect(contactsRepo.save).toHaveBeenCalledTimes(1);
      expect(error).toHaveBeenCalledWith(
        expect.stringContaining("does not match its hash"),
      );
    });

    it("stores the credential with its hash, before the first send", async () => {
      grantedButUndelivered();
      contactsAre([{ id: "c1", firstName: "Carol", email: "c@example.com" }]);

      await service.runDailyCheck();

      const saved = contactsRepo.save.mock.calls[0][0];
      expect(saved.claimTokenCiphertext).toBe(`enc(${sentClaimUrls()[0]})`);
      expect(saved.claimTokenHash).toBe(hashToken(sentClaimUrls()[0]));
      // Committed before the send, since a hash with no recoverable token is
      // exactly the state that forces a rotation later.
      expect(contactsRepo.save.mock.invocationCallOrder[0]).toBeLessThan(
        emailService.sendMail.mock.invocationCallOrder[0],
      );
    });

    it("leaves a returning owner to the revoke path instead of resuming", async () => {
      settingsRepo.find.mockResolvedValue([
        {
          ownerUserId: userId,
          enabled: true,
          grantAfterDays: 14,
          reminderAfterDays: 7,
          messageCiphertext: null,
          lastReminderSentAt: null,
          grantedAt: daysAgo(1),
        },
      ]);
      usersRepo.findOne.mockResolvedValue({
        id: userId,
        email: "owner@example.com",
        isActive: true,
        // Signed back in: the grant is being revoked, not resumed.
        lastActivityAt: daysAgo(1),
      });
      contactsAre([{ id: "c1", firstName: "Carol", email: "c@example.com" }]);

      await service.runDailyCheck();

      // The one email is the owner's revocation notice, not a contact's link.
      expect(emailService.sendMail.mock.calls.map((c) => c[0])).toEqual([
        "owner@example.com",
      ]);
      expect(notifiedContactIds()).toEqual([]);
    });
  });

  it("stamps a contact's delivery record only after their own email is sent", async () => {
    settingsRepo.find.mockResolvedValue([
      {
        ownerUserId: userId,
        enabled: true,
        grantAfterDays: 14,
        reminderAfterDays: 7,
        messageCiphertext: null,
        lastReminderSentAt: null,
        grantedAt: null,
      },
    ]);
    usersRepo.findOne.mockResolvedValue({
      id: userId,
      email: "owner@example.com",
      isActive: true,
      lastActivityAt: daysAgo(20),
    });
    contactsAre([
      { id: "c1", firstName: "Carol", email: "carol@example.com" },
      { id: "c2", firstName: "Dave", email: "dave@example.com" },
    ]);
    // Carol's send fails; Dave's succeeds.
    emailService.sendMail
      .mockRejectedValueOnce(new Error("smtp down"))
      .mockResolvedValueOnce(undefined);

    await service.runDailyCheck();

    // Only Dave is recorded as delivered, so tomorrow's sweep still owes Carol a
    // link -- the partial failure is recoverable rather than silent.
    expect(notifiedContactIds()).toEqual(["c2"]);
  });

  it("does not double-send the daily reminder", async () => {
    const today = new Date();
    today.setHours(12, 0, 0, 0);
    settingsRepo.find.mockResolvedValue([
      {
        ownerUserId: userId,
        enabled: true,
        grantAfterDays: 14,
        reminderAfterDays: 7,
        messageCiphertext: null,
        lastReminderSentAt: today,
        grantedAt: null,
      },
    ]);
    usersRepo.findOne.mockResolvedValue({
      id: userId,
      email: "owner@example.com",
      isActive: true,
      lastActivityAt: daysAgo(10),
    });

    await service.runDailyCheck();
    expect(emailService.sendMail).not.toHaveBeenCalled();
    // The refusal comes from the delivery record, not the claim: this replica
    // *won* the lease and still declined, which is what makes "once per day"
    // survive a process death (audit FV4-005). Under a permanent pre-send claim
    // the lease would already have been consumed by whoever died holding it.
    expect(jobClaims.claimLease).toHaveBeenCalledWith(
      "emergency_access_reminder",
      userId,
      expect.stringMatching(/^\d{4}-\d{2}-\d{2}$/),
      expect.any(Number),
    );
    // And the lease goes back immediately rather than being held for its TTL.
    expect(jobClaims.release).toHaveBeenCalledWith(
      "emergency_access_reminder",
      userId,
      expect.stringMatching(/^\d{4}-\d{2}-\d{2}$/),
    );
  });

  it("leaves the reminder owed when the send fails, and hands the lease back", async () => {
    settingsRepo.find.mockResolvedValue([
      {
        ownerUserId: userId,
        enabled: true,
        grantAfterDays: 14,
        reminderAfterDays: 7,
        messageCiphertext: null,
        lastReminderSentAt: null,
        grantedAt: null,
      },
    ]);
    usersRepo.findOne.mockResolvedValue({
      id: userId,
      email: "owner@example.com",
      isActive: true,
      lastActivityAt: daysAgo(10),
    });
    emailService.sendMail.mockRejectedValue(new Error("smtp down"));

    await service.runDailyCheck();

    // Nothing was delivered, so the delivery record must not move -- that is what
    // keeps the notice owed rather than silently spent.
    expect(settingsRepo.createQueryBuilder).not.toHaveBeenCalled();
    expect(jobClaims.release).toHaveBeenCalledWith(
      "emergency_access_reminder",
      userId,
      expect.stringMatching(/^\d{4}-\d{2}-\d{2}$/),
    );
  });

  it("skips users without a last_activity_at or last_login timestamp", async () => {
    settingsRepo.find.mockResolvedValue([
      {
        ownerUserId: userId,
        enabled: true,
        grantAfterDays: 14,
        reminderAfterDays: 7,
        messageCiphertext: null,
        lastReminderSentAt: null,
        grantedAt: null,
      },
    ]);
    usersRepo.findOne.mockResolvedValue({
      id: userId,
      email: "owner@example.com",
      isActive: true,
      lastActivityAt: null,
      lastLogin: null,
    });

    await service.runDailyCheck();
    expect(emailService.sendMail).not.toHaveBeenCalled();
  });

  it("falls back to last_login when last_activity_at is null", async () => {
    settingsRepo.find.mockResolvedValue([
      {
        ownerUserId: userId,
        enabled: true,
        grantAfterDays: 14,
        reminderAfterDays: 7,
        messageCiphertext: null,
        lastReminderSentAt: null,
        grantedAt: null,
      },
    ]);
    usersRepo.findOne.mockResolvedValue({
      id: userId,
      email: "owner@example.com",
      firstName: "Owner",
      isActive: true,
      lastActivityAt: null,
      lastLogin: daysAgo(10),
    });
    contactsRepo.find.mockResolvedValue([]);

    await service.runDailyCheck();
    expect(emailService.sendMail).toHaveBeenCalledTimes(1);
    expect(emailService.sendMail.mock.calls[0][0]).toBe("owner@example.com");
  });

  it("returns early when nobody has emergency access enabled", async () => {
    settingsRepo.find.mockResolvedValue([]);
    await service.runDailyCheck();
    expect(usersRepo.findOne).not.toHaveBeenCalled();
    expect(emailService.sendMail).not.toHaveBeenCalled();
  });

  it("logs and continues when one contact's grant email fails to send", async () => {
    settingsRepo.find.mockResolvedValue([
      {
        ownerUserId: userId,
        enabled: true,
        grantAfterDays: 14,
        reminderAfterDays: 7,
        messageCiphertext: null,
        lastReminderSentAt: null,
        grantedAt: null,
      },
    ]);
    usersRepo.findOne.mockResolvedValue({
      id: userId,
      email: "owner@example.com",
      firstName: "Owner",
      isActive: true,
      lastActivityAt: daysAgo(20),
    });
    contactsRepo.find.mockResolvedValue([
      { id: "c1", firstName: "Carol", email: "carol@example.com" },
      { id: "c2", firstName: "Dave", email: "dave@example.com" },
    ]);
    emailService.sendMail
      .mockRejectedValueOnce(new Error("smtp down"))
      .mockResolvedValueOnce(undefined);

    await service.runDailyCheck();

    expect(emailService.sendMail).toHaveBeenCalledTimes(2);
  });

  it("localizes the grant email to the contact's own account language when they are a Monize user", async () => {
    settingsRepo.find.mockResolvedValue([
      {
        ownerUserId: userId,
        enabled: true,
        grantAfterDays: 14,
        reminderAfterDays: 7,
        messageCiphertext: null,
        lastReminderSentAt: null,
        grantedAt: null,
      },
    ]);
    usersRepo.findOne.mockImplementation((opts) =>
      opts?.where?.email === "carol@example.com"
        ? Promise.resolve({ id: "contact-1", email: "carol@example.com" })
        : Promise.resolve({
            id: userId,
            email: "owner@example.com",
            firstName: "Owner",
            isActive: true,
            lastActivityAt: daysAgo(20),
          }),
    );
    contactsRepo.find.mockResolvedValue([
      { id: "c1", firstName: "Carol", email: "carol@example.com" },
    ]);
    prefsRepo.findOne.mockResolvedValue({
      userId: "contact-1",
      language: "fr",
    });

    await service.runDailyCheck();

    expect(usersRepo.findOne).toHaveBeenCalledWith({
      where: { email: "carol@example.com" },
    });
    expect(prefsRepo.findOne).toHaveBeenCalledWith({
      where: { userId: "contact-1" },
    });
    expect(emailService.sendMail).toHaveBeenCalledTimes(1);
  });

  it("skips a user gracefully when their settings row is inactive (no email)", async () => {
    settingsRepo.find.mockResolvedValue([
      {
        ownerUserId: userId,
        enabled: true,
        grantAfterDays: 14,
        reminderAfterDays: 7,
        messageCiphertext: null,
        lastReminderSentAt: null,
        grantedAt: null,
      },
    ]);
    usersRepo.findOne.mockResolvedValue({
      id: userId,
      email: null,
      isActive: true,
      lastActivityAt: daysAgo(20),
    });

    await service.runDailyCheck();
    expect(emailService.sendMail).not.toHaveBeenCalled();
  });

  it("does nothing if the grant threshold is reached but the user has no contacts", async () => {
    settingsRepo.find.mockResolvedValue([
      {
        ownerUserId: userId,
        enabled: true,
        grantAfterDays: 14,
        reminderAfterDays: 7,
        messageCiphertext: null,
        lastReminderSentAt: null,
        grantedAt: null,
      },
    ]);
    usersRepo.findOne.mockResolvedValue({
      id: userId,
      email: "owner@example.com",
      isActive: true,
      lastActivityAt: daysAgo(20),
    });
    contactsRepo.find.mockResolvedValue([]);

    await service.runDailyCheck();
    expect(emailService.sendMail).not.toHaveBeenCalled();
    expect(settingsRepo.save).not.toHaveBeenCalled();
  });

  it("emits a grant email with no message body when decryption fails", async () => {
    encryption.decrypt.mockImplementation(() => {
      throw new Error("bad key");
    });
    settingsRepo.find.mockResolvedValue([
      {
        ownerUserId: userId,
        enabled: true,
        grantAfterDays: 14,
        reminderAfterDays: 7,
        messageCiphertext: "enc(corrupt)",
        lastReminderSentAt: null,
        grantedAt: null,
      },
    ]);
    usersRepo.findOne.mockResolvedValue({
      id: userId,
      email: "owner@example.com",
      firstName: "Owner",
      isActive: true,
      lastActivityAt: daysAgo(20),
    });
    contactsRepo.find.mockResolvedValue([
      { id: "c1", firstName: "Carol", email: "carol@example.com" },
    ]);

    await service.runDailyCheck();
    expect(emailService.sendMail).toHaveBeenCalledTimes(1);
    // The HTML body should not include the original ciphertext or any block
    // that requires a non-null message.
    const html = emailService.sendMail.mock.calls[0][2] as string;
    expect(html).not.toContain("enc(corrupt)");
    expect(html).not.toContain("border-left: 4px solid");
  });

  it("emits a grant email with no message body when the key is not configured", async () => {
    encryption.isConfigured.mockReturnValue(false);
    settingsRepo.find.mockResolvedValue([
      {
        ownerUserId: userId,
        enabled: true,
        grantAfterDays: 14,
        reminderAfterDays: 7,
        messageCiphertext: "enc(unreadable)",
        lastReminderSentAt: null,
        grantedAt: null,
      },
    ]);
    usersRepo.findOne.mockResolvedValue({
      id: userId,
      email: "owner@example.com",
      isActive: true,
      lastActivityAt: daysAgo(20),
    });
    contactsRepo.find.mockResolvedValue([
      { id: "c1", firstName: "Carol", email: "carol@example.com" },
    ]);

    await service.runDailyCheck();
    expect(emailService.sendMail).toHaveBeenCalledTimes(1);
    expect(encryption.decrypt).not.toHaveBeenCalled();
  });

  it("uses singular phrasing in the reminder subject when daysSinceLogin === 1", async () => {
    settingsRepo.find.mockResolvedValue([
      {
        ownerUserId: userId,
        enabled: true,
        grantAfterDays: 14,
        reminderAfterDays: 1,
        messageCiphertext: null,
        lastReminderSentAt: null,
        grantedAt: null,
      },
    ]);
    usersRepo.findOne.mockResolvedValue({
      id: userId,
      email: "owner@example.com",
      firstName: "Owner",
      isActive: true,
      lastActivityAt: daysAgo(1),
    });
    contactsRepo.find.mockResolvedValue([]);

    await service.runDailyCheck();
    const subject = emailService.sendMail.mock.calls[0][1] as string;
    expect(subject).toContain("1 day");
    expect(subject).not.toContain("1 days");
  });

  it("logs without crashing when the outer catch sees a non-Error throw", async () => {
    settingsRepo.find.mockResolvedValue([
      {
        ownerUserId: userId,
        enabled: true,
        grantAfterDays: 14,
        reminderAfterDays: 7,
        messageCiphertext: null,
        lastReminderSentAt: null,
        grantedAt: null,
      },
    ]);
    usersRepo.findOne.mockImplementation(() => {
      throw "string-not-an-Error";
    });

    await expect(service.runDailyCheck()).resolves.toBeUndefined();
    expect(emailService.sendMail).not.toHaveBeenCalled();
  });

  it("logs without crashing when a per-contact send throws a non-Error value", async () => {
    settingsRepo.find.mockResolvedValue([
      {
        ownerUserId: userId,
        enabled: true,
        grantAfterDays: 14,
        reminderAfterDays: 7,
        messageCiphertext: null,
        lastReminderSentAt: null,
        grantedAt: null,
      },
    ]);
    usersRepo.findOne.mockResolvedValue({
      id: userId,
      email: "owner@example.com",
      isActive: true,
      lastActivityAt: daysAgo(20),
    });
    contactsRepo.find.mockResolvedValue([
      { id: "c1", firstName: "Carol", email: "carol@example.com" },
    ]);
    emailService.sendMail.mockRejectedValueOnce("smtp-string-error");

    await expect(service.runDailyCheck()).resolves.toBeUndefined();
    expect(emailService.sendMail).toHaveBeenCalledTimes(1);
  });

  it("logs without crashing when decrypt throws a non-Error value", async () => {
    encryption.decrypt.mockImplementation(() => {
      throw "decrypt-string-error";
    });
    settingsRepo.find.mockResolvedValue([
      {
        ownerUserId: userId,
        enabled: true,
        grantAfterDays: 14,
        reminderAfterDays: 7,
        messageCiphertext: "enc(corrupt)",
        lastReminderSentAt: null,
        grantedAt: null,
      },
    ]);
    usersRepo.findOne.mockResolvedValue({
      id: userId,
      email: "owner@example.com",
      isActive: true,
      lastActivityAt: daysAgo(20),
    });
    contactsRepo.find.mockResolvedValue([
      { id: "c1", firstName: "Carol", email: "carol@example.com" },
    ]);

    await service.runDailyCheck();
    expect(emailService.sendMail).toHaveBeenCalledTimes(1);
  });

  it("does not crash when processOne itself throws and continues to the next user", async () => {
    settingsRepo.find.mockResolvedValue([
      {
        ownerUserId: "u1",
        enabled: true,
        grantAfterDays: 14,
        reminderAfterDays: 7,
        messageCiphertext: null,
        lastReminderSentAt: null,
        grantedAt: null,
      },
      {
        ownerUserId: "u2",
        enabled: true,
        grantAfterDays: 14,
        reminderAfterDays: 7,
        messageCiphertext: null,
        lastReminderSentAt: null,
        grantedAt: null,
      },
    ]);
    usersRepo.findOne
      .mockRejectedValueOnce(new Error("db down"))
      .mockResolvedValueOnce({
        id: "u2",
        email: "two@example.com",
        isActive: true,
        lastActivityAt: daysAgo(10),
        lastLogin: null,
      });

    await expect(service.runDailyCheck()).resolves.toBeUndefined();
    expect(emailService.sendMail).toHaveBeenCalledTimes(1);
    expect(emailService.sendMail.mock.calls[0][0]).toBe("two@example.com");
  });

  it("continues processing other users when one fails", async () => {
    settingsRepo.find.mockResolvedValue([
      {
        ownerUserId: "u1",
        enabled: true,
        grantAfterDays: 14,
        reminderAfterDays: 7,
        messageCiphertext: null,
        lastReminderSentAt: null,
        grantedAt: null,
      },
      {
        ownerUserId: "u2",
        enabled: true,
        grantAfterDays: 14,
        reminderAfterDays: 7,
        messageCiphertext: null,
        lastReminderSentAt: null,
        grantedAt: null,
      },
    ]);
    usersRepo.findOne
      .mockResolvedValueOnce(null) // u1 missing -> skipped path
      .mockResolvedValueOnce({
        id: "u2",
        email: "two@example.com",
        isActive: true,
        lastActivityAt: daysAgo(10),
        lastLogin: null,
      });

    await service.runDailyCheck();
    expect(emailService.sendMail).toHaveBeenCalledTimes(1);
    expect(emailService.sendMail.mock.calls[0][0]).toBe("two@example.com");
  });

  it("does not commit the grant when every contact email fails to send", async () => {
    const settings = {
      ownerUserId: userId,
      enabled: true,
      grantAfterDays: 14,
      reminderAfterDays: 7,
      messageCiphertext: null,
      lastReminderSentAt: null,
      grantedAt: null,
    };
    settingsRepo.find.mockResolvedValue([settings]);
    usersRepo.findOne.mockResolvedValue({
      id: userId,
      email: "owner@example.com",
      firstName: "Owner",
      isActive: true,
      lastActivityAt: daysAgo(20),
    });
    contactsRepo.find.mockResolvedValue([
      { id: "c1", firstName: "Carol", email: "carol@example.com" },
      { id: "c2", firstName: "Dave", email: "dave@example.com" },
    ]);
    emailService.sendMail.mockRejectedValue(new Error("smtp down"));

    await service.runDailyCheck();

    // Both sends attempted, but grantedAt must stay null so the next daily
    // run retries instead of permanently disabling the safeguard.
    expect(emailService.sendMail).toHaveBeenCalledTimes(2);
    expect(settings.grantedAt).toBeNull();
    expect(settingsRepo.save).not.toHaveBeenCalled();
  });

  it("voids outstanding links and notifies the owner when they return after a grant", async () => {
    const settings = {
      ownerUserId: userId,
      enabled: true,
      grantAfterDays: 14,
      reminderAfterDays: 7,
      messageCiphertext: null,
      lastReminderSentAt: daysAgo(8),
      grantedAt: daysAgo(3),
    };
    settingsRepo.find.mockResolvedValue([settings]);
    usersRepo.findOne.mockResolvedValue({
      id: userId,
      email: "owner@example.com",
      firstName: "Owner",
      isActive: true,
      // Active again: well under the 14-day grant threshold.
      lastActivityAt: daysAgo(1),
    });
    const execute = jest.fn().mockResolvedValue({ affected: 2 });
    contactsRepo.createQueryBuilder.mockReturnValue({
      update: jest.fn().mockReturnThis(),
      set: jest.fn().mockReturnThis(),
      where: jest.fn().mockReturnThis(),
      andWhere: jest.fn().mockReturnThis(),
      execute,
    });

    await service.runDailyCheck();

    // Outstanding links voided, grant state re-armed, owner emailed.
    expect(execute).toHaveBeenCalledTimes(1);
    // Re-armed with a targeted UPDATE rather than by re-saving the snapshot the
    // sweep read, so a setting the owner changed in the meantime survives.
    expect(settingsRepo.createQueryBuilder).toHaveBeenCalled();
    expect(emailService.sendMail).toHaveBeenCalledTimes(1);
    const [to, subject] = emailService.sendMail.mock.calls[0];
    expect(to).toBe("owner@example.com");
    expect(subject).toContain("while you were away");
  });
});
