import { ConfigService } from "@nestjs/config";
import { I18nService } from "nestjs-i18n";
import { DataSource } from "typeorm";

import { AiEncryptionService } from "@/ai/ai-encryption.service";
import { hashToken } from "@/auth/crypto.util";
import { affectedRowCount, returnedRows } from "@/common/db/query-result";
import { withUserContext } from "@/common/db/with-context";
import { JobClaimService } from "@/common/jobs/job-claim.service";
import { EmergencyAccessMonitorService } from "@/emergency-access/emergency-access-monitor.service";
import { EmergencyAccessService } from "@/emergency-access/emergency-access.service";
import { EmailService } from "@/notifications/email.service";

import {
  INTEGRATION_TYPEORM_OPTIONS,
  cleanTables,
  createTestUserDirect,
} from "../helpers/integration-setup";
import { applyRlsPolicies } from "../helpers/rls-setup";

/**
 * Two complete emergency-access grant cycles, and every path that re-arms
 * monitoring in between (audit RRV4-004).
 *
 * `claim_notified_at` was the pending predicate and nothing ever set it back to
 * NULL, so emergency access fired at most **once per contact row, for the lifetime
 * of the row**. The owner returns, `revokeAfterReturn` voids the links and clears
 * `granted_at` -- logging that monitoring is re-armed -- and the next inactivity
 * period finds nobody owed and grants nothing. Silently, with the settings page
 * still reporting the feature as armed. The same happened after a disable/re-enable
 * and after a manual reset.
 *
 * A unit spec cannot settle this. The claim, the generation bump and the delivery
 * record are three SQL statements whose interaction *is* the state machine, and a
 * mocked repository asserts only what the test author already believed. So this
 * runs the real service against a real database and reads the rows back after each
 * transition.
 *
 * Interesting numbers: the second cycle, not the first. A service that ignored the
 * generation entirely passes a one-cycle test.
 */
describe("emergency access across grant cycles", () => {
  let dataSource: DataSource;
  let monitor: EmergencyAccessMonitorService;
  let settingsService: EmergencyAccessService;
  let sent: { to: string; subject: string; html: string }[];
  let owner: string;

  const CONTACT_EMAIL = "carol@example.com";
  const APP_URL = "https://monize.test";

  const emailDouble = {
    getStatus: () => ({ configured: true }),
    sendMail: async (to: string, subject: string, html: string) => {
      sent.push({ to, subject, html });
    },
  } as unknown as EmailService;

  const configDouble = {
    get: (key: string, fallback?: string) =>
      key === "PUBLIC_APP_URL" ? APP_URL : (fallback ?? ""),
  } as unknown as ConfigService;

  const i18nDouble = {
    translate: (key: string, options?: { defaultValue?: string }) =>
      options?.defaultValue ?? key,
    t: (key: string, options?: { defaultValue?: string }) =>
      options?.defaultValue ?? key,
  } as unknown as I18nService;

  /** A real encryption service, so the stored credential really round-trips. */
  const encryption = new AiEncryptionService({
    get: (key: string, fallback?: string) =>
      key === "AI_ENCRYPTION_KEY"
        ? "integration-test-key-of-at-least-32-chars"
        : fallback,
  } as unknown as ConfigService);

  /** Move the owner's last activity, which is what the sweep measures. */
  const lastSeenDaysAgo = async (days: number): Promise<void> => {
    await dataSource.query(
      `UPDATE users
          SET last_activity_at = CURRENT_TIMESTAMP - ($2::text || ' days')::interval
        WHERE id = $1`,
      [owner, String(days)],
    );
  };

  const settingsRow = async (): Promise<{
    enabled: boolean;
    granted_at: Date | null;
    grant_generation: number;
  }> => {
    const [row] = await dataSource.query(
      `SELECT enabled, granted_at, grant_generation
         FROM emergency_access_settings WHERE owner_user_id = $1`,
      [owner],
    );
    return row;
  };

  const contactRow = async (): Promise<{
    id: string;
    email: string;
    claim_token_hash: string | null;
    claim_token_expires_at: Date | null;
    claim_token_used_at: Date | null;
    claim_token_ciphertext: string | null;
    claim_notified_at: Date | null;
    notified_grant_generation: number | null;
  }> => {
    const [row] = await dataSource.query(
      `SELECT id, email, claim_token_hash, claim_token_expires_at,
              claim_token_used_at, claim_token_ciphertext, claim_notified_at,
              notified_grant_generation
         FROM emergency_access_contacts WHERE owner_user_id = $1`,
      [owner],
    );
    return row;
  };

  /** The raw claim token the most recent email carried. */
  const tokenInLastEmail = (): string => {
    const match = /token=([0-9a-f]+)/.exec(sent[sent.length - 1].html);
    if (!match) throw new Error("the last email carried no claim token");
    return match[1];
  };

  /**
   * A grant cycle: the owner lapses, the daily check runs, and the delivered link
   * is checked against the row that has to honour it.
   */
  const runInactivityGrant = async (): Promise<{
    token: string;
    generation: number;
  }> => {
    const before = sent.length;
    await lastSeenDaysAgo(30);
    await monitor.runDailyCheck();
    expect(sent.slice(before).map((m) => m.to)).toEqual([CONTACT_EMAIL]);

    const token = tokenInLastEmail();
    const contact = await contactRow();
    // The link in the recipient's inbox is the one the database will honour.
    expect(contact.claim_token_hash).toBe(hashToken(token));
    expect(contact.claim_token_used_at).toBeNull();
    expect(contact.claim_token_expires_at!.getTime()).toBeGreaterThan(
      Date.now(),
    );
    // Delivery acknowledged, so the credential does not outlive it.
    expect(contact.claim_token_ciphertext).toBeNull();
    expect(contact.claim_notified_at).not.toBeNull();

    const settings = await settingsRow();
    expect(contact.notified_grant_generation).toBe(settings.grant_generation);
    return { token, generation: settings.grant_generation };
  };

  beforeAll(async () => {
    dataSource = new DataSource(INTEGRATION_TYPEORM_OPTIONS as never);
    await dataSource.initialize();
    await applyRlsPolicies(dataSource);

    const jobClaims = new JobClaimService(dataSource);
    monitor = new EmergencyAccessMonitorService(
      dataSource,
      emailDouble,
      encryption,
      configDouble,
      i18nDouble,
      jobClaims,
    );
    settingsService = new EmergencyAccessService(
      encryption,
      emailDouble,
      dataSource,
    );
  });

  afterAll(async () => {
    if (dataSource?.isInitialized) {
      await dataSource.destroy();
    }
  });

  beforeEach(async () => {
    await cleanTables(dataSource, [
      "job_claims",
      "emergency_access_contacts",
      "emergency_access_settings",
      "users",
    ]);
    sent = [];
    owner = (
      await createTestUserDirect(dataSource, { email: "owner@example.com" })
    ).id;
    await withUserContext(owner, async () => {
      await settingsService.upsertSettings(owner, {
        enabled: true,
        grantAfterDays: 14,
        reminderAfterDays: 7,
      });
      await settingsService.addContact(owner, {
        firstName: "Carol",
        email: CONTACT_EMAIL,
      });
    });
  });

  it("grants again after the owner returns and lapses a second time", async () => {
    const first = await runInactivityGrant();

    // The owner signs back in. Step 0 voids the outstanding link and re-arms.
    await lastSeenDaysAgo(0);
    await monitor.runDailyCheck();

    const revoked = await contactRow();
    expect(revoked.claim_token_hash).toBeNull();
    expect(revoked.claim_token_used_at).not.toBeNull();
    // DR-RRV4-03: the credential goes with the hash that made it usable.
    expect(revoked.claim_token_ciphertext).toBeNull();
    expect((await settingsRow()).granted_at).toBeNull();
    // The delivery marker is deliberately *not* reset here -- the next cycle's
    // generation is what owes the contact a link, so no re-arm path has to know.
    expect(revoked.notified_grant_generation).toBe(first.generation);

    const second = await runInactivityGrant();

    // The finding, in one assertion: under the lifetime marker this cycle sent
    // nothing at all.
    expect(second.generation).toBeGreaterThan(first.generation);
    expect(second.token).not.toBe(first.token);
  });

  it("grants again after the owner disables and re-enables the feature", async () => {
    const first = await runInactivityGrant();

    await withUserContext(owner, async () => {
      await settingsService.upsertSettings(owner, {
        enabled: false,
        grantAfterDays: 14,
        reminderAfterDays: 7,
      });
      await settingsService.upsertSettings(owner, {
        enabled: true,
        grantAfterDays: 14,
        reminderAfterDays: 7,
      });
    });

    const disabled = await contactRow();
    expect(disabled.claim_token_hash).toBeNull();
    expect(disabled.claim_token_ciphertext).toBeNull();

    const second = await runInactivityGrant();
    expect(second.generation).toBeGreaterThan(first.generation);
  });

  it("grants again after a manual reset of the granted state", async () => {
    const first = await runInactivityGrant();

    await withUserContext(owner, () =>
      settingsService.resetGrantedState(owner),
    );
    expect((await settingsRow()).granted_at).toBeNull();
    expect((await contactRow()).claim_token_ciphertext).toBeNull();

    const second = await runInactivityGrant();
    expect(second.generation).toBeGreaterThan(first.generation);
  });

  it("owes a corrected address a notice within the same cycle", async () => {
    const first = await runInactivityGrant();
    const contactId = (await contactRow()).id;

    // The one reset the generation cannot derive: the owner's cycle has not moved,
    // so without clearing the marker the new address would count as already served.
    await withUserContext(owner, () =>
      settingsService.updateContact(owner, contactId, {
        firstName: "Carol",
        email: "carol.new@example.com",
      }),
    );
    const edited = await contactRow();
    expect(edited.notified_grant_generation).toBeNull();
    expect(edited.claim_notified_at).toBeNull();
    expect(edited.claim_token_ciphertext).toBeNull();

    // Still the same grant (`granted_at` is set), so this is the resume path.
    const before = sent.length;
    await monitor.runDailyCheck();
    expect(sent.slice(before).map((m) => m.to)).toEqual([
      "carol.new@example.com",
    ]);
    const notified = await contactRow();
    expect(notified.notified_grant_generation).toBe(first.generation);
  });

  it("does not re-notify a contact already served by the current cycle", async () => {
    await runInactivityGrant();

    // A second run inside the same cycle: still inactive, still granted. The
    // generation must not undo FV4-004 -- re-issuing here would kill the link
    // already in the recipient's inbox.
    const before = sent.length;
    const tokenBefore = (await contactRow()).claim_token_hash;
    await monitor.runDailyCheck();

    expect(sent.slice(before)).toEqual([]);
    expect((await contactRow()).claim_token_hash).toBe(tokenBefore);
  });

  it("re-sends the same credential when a delivery could not be recorded", async () => {
    // The send-to-marker crash window (audit RV4-004), with the generation in
    // place: the contact is owed for this cycle and holds an unexpired credential,
    // so the retry must re-send *that* one rather than mint a replacement.
    await lastSeenDaysAgo(30);
    await monitor.runDailyCheck();
    const delivered = tokenInLastEmail();

    // Simulate the process dying between SMTP acceptance and the record: put the
    // credential back and un-record the delivery.
    await dataSource.query(
      `UPDATE emergency_access_contacts
          SET claim_notified_at = NULL,
              notified_grant_generation = NULL,
              claim_token_ciphertext = $2
        WHERE owner_user_id = $1`,
      [owner, encryption.encrypt(delivered)],
    );

    const before = sent.length;
    await monitor.runDailyCheck();

    expect(sent.slice(before)).toHaveLength(1);
    expect(tokenInLastEmail()).toBe(delivered);
  });

  it("mints a replacement when the undelivered credential has expired", async () => {
    // Audit RRV4-005. A token issued on day 0 and re-sent on day 31 is already
    // dead: sending it and recording the delivery leaves the contact with a link
    // the claim endpoint refuses and no retry.
    await lastSeenDaysAgo(30);
    await monitor.runDailyCheck();
    const stale = tokenInLastEmail();

    await dataSource.query(
      `UPDATE emergency_access_contacts
          SET claim_notified_at = NULL,
              notified_grant_generation = NULL,
              claim_token_ciphertext = $2,
              claim_token_expires_at = CURRENT_TIMESTAMP - INTERVAL '1 day'
        WHERE owner_user_id = $1`,
      [owner, encryption.encrypt(stale)],
    );

    const before = sent.length;
    await monitor.runDailyCheck();

    expect(sent.slice(before)).toHaveLength(1);
    const fresh = tokenInLastEmail();
    expect(fresh).not.toBe(stale);
    const contact = await contactRow();
    expect(contact.claim_token_hash).toBe(hashToken(fresh));
    expect(contact.claim_token_expires_at!.getTime()).toBeGreaterThan(
      Date.now(),
    );
    // And the email states the expiry the database holds, to the day.
    const expiryDay = contact
      .claim_token_expires_at!.toISOString()
      .split("T")[0];
    expect(sent[sent.length - 1].html).toContain(expiryDay);
  });

  it("refuses to arm the feature when credential encryption is unavailable", async () => {
    // Audit RRV4-003: without a key `credentialFor` throws for every contact, so
    // the grant delivers nothing, releases itself, and repeats forever -- while the
    // settings page reports the safeguard as armed.
    const keyless = new EmergencyAccessService(
      new AiEncryptionService({
        get: (_key: string, fallback?: string) => fallback ?? "",
      } as unknown as ConfigService),
      emailDouble,
      dataSource,
    );

    await withUserContext(owner, async () => {
      await expect(
        keyless.upsertSettings(owner, {
          enabled: true,
          grantAfterDays: 14,
          reminderAfterDays: 7,
        }),
      ).rejects.toThrow(/AI_ENCRYPTION_KEY/);
      const view = await keyless.getView(owner);
      expect(view.credentialEncryptionConfigured).toBe(false);
    });
  });

  it("lets the owner disable the feature even with neither dependency ready", async () => {
    // Audit V4R3-002: a missing dependency stops arming, never disabling. Enable
    // it, then take away both SMTP and the key, and the owner must still be able to
    // switch it off -- which voids the outstanding links.
    await runInactivityGrant();
    const brokenService = new EmergencyAccessService(
      new AiEncryptionService({
        get: (_key: string, fallback?: string) => fallback ?? "",
      } as unknown as ConfigService),
      {
        getStatus: () => ({ configured: false }),
      } as unknown as EmailService,
      dataSource,
    );

    await withUserContext(owner, () =>
      brokenService.upsertSettings(owner, {
        enabled: false,
        grantAfterDays: 14,
        reminderAfterDays: 7,
      }),
    );

    expect((await settingsRow()).enabled).toBe(false);
    const contact = await contactRow();
    expect(contact.claim_token_hash).toBeNull();
    expect(contact.claim_token_ciphertext).toBeNull();
  });

  it("revokes on return and kills the delivered link even with SMTP and the key gone", async () => {
    // Revocation is a security invariant, not a delivery: it needs neither SMTP
    // nor the encryption key, so it must run before either gate. A monitor that
    // returned at the first missing dependency left a returned owner's
    // outstanding claim link live on exactly the degraded install that could not
    // re-notify anyone about it.
    const { token } = await runInactivityGrant();

    const degradedMonitor = new EmergencyAccessMonitorService(
      dataSource,
      {
        getStatus: () => ({ configured: false }),
        sendMail: async () => {
          throw new Error("SMTP is down");
        },
      } as unknown as EmailService,
      new AiEncryptionService({
        get: (_key: string, fallback?: string) => fallback ?? "",
      } as unknown as ConfigService),
      configDouble,
      i18nDouble,
      new JobClaimService(dataSource),
    );

    // The owner signs back in; only the degraded binary is running.
    await lastSeenDaysAgo(0);
    await degradedMonitor.runDailyCheck();

    const contact = await contactRow();
    expect(contact.claim_token_hash).toBeNull();
    expect(contact.claim_token_used_at).not.toBeNull();
    expect(contact.claim_token_ciphertext).toBeNull();
    expect((await settingsRow()).granted_at).toBeNull();

    // The proof that matters: the claim controller's consume statement, replayed
    // verbatim against the delivered token, finds no row to honour.
    const consumed: unknown = await dataSource.query(
      `UPDATE emergency_access_contacts
          SET claim_token_used_at = CURRENT_TIMESTAMP,
              claim_token_hash = NULL,
              claim_token_ciphertext = NULL,
              claim_voided_reason = NULL
        WHERE claim_token_hash = $1
          AND claim_token_used_at IS NULL
          AND claim_token_expires_at IS NOT NULL
          AND claim_token_expires_at >= CURRENT_TIMESTAMP
        RETURNING id, owner_user_id`,
      [hashToken(token)],
    );
    expect(returnedRows(consumed)).toEqual([]);
  });

  describe("during a rolling deployment", () => {
    /**
     * The previous binary's grant acknowledgement (audit V4R3-001): it writes
     * `claim_notified_at` and clears the ciphertext, and does not know
     * `notified_grant_generation` exists. Executed verbatim against the migrated
     * schema, so the compatibility trigger is what has to make it land in the
     * current cycle.
     */
    const oldBinaryAcknowledges = (contactId: string): Promise<unknown> =>
      dataSource.query(
        `UPDATE emergency_access_contacts
            SET claim_notified_at = CURRENT_TIMESTAMP,
                claim_token_ciphertext = NULL
          WHERE id = $1`,
        [contactId],
      );

    /**
     * The binary in production *today* (pre-145) rotates the credential with
     * exactly this statement -- a TypeORM save of the four columns its entity
     * declares -- guarded only by a snapshot read of `granted_at`. It predates
     * `claim_token_ciphertext` and `notified_grant_generation`, so it can touch
     * neither (REMAINING-002). Migration 148's fence is what has to decide,
     * per row state, whether this write may land.
     */
    const oldBinaryRotates = (
      contactId: string,
      rawToken: string,
    ): Promise<unknown> =>
      dataSource.query(
        `UPDATE emergency_access_contacts
            SET claim_token_hash = $2,
                claim_token_expires_at = CURRENT_TIMESTAMP + INTERVAL '30 days',
                claim_token_used_at = NULL,
                claim_voided_reason = NULL,
                updated_at = CURRENT_TIMESTAMP
          WHERE id = $1`,
        [contactId, hashToken(rawToken)],
      );

    it("translates an old-binary acknowledgement into the current generation", async () => {
      // A new pod claims the grant and mints token A, but the *old* pod delivers it
      // and writes the old-style acknowledgement.
      await lastSeenDaysAgo(30);
      await monitor.runDailyCheck();
      const contactId = (await contactRow()).id;
      const tokenA = (await contactRow()).claim_token_hash;
      const generation = (await settingsRow()).grant_generation;

      // Undo only the generation-aware half of the record, leaving the row as the
      // old binary would: notified, ciphertext cleared, generation NULL.
      await dataSource.query(
        `UPDATE emergency_access_contacts
            SET claim_notified_at = NULL, notified_grant_generation = NULL
          WHERE id = $1`,
        [contactId],
      );
      await oldBinaryAcknowledges(contactId);

      // The trigger must have stamped the current generation, so the contact is not
      // treated as owed and token A is never rotated.
      const after = await contactRow();
      expect(after.notified_grant_generation).toBe(generation);
      expect(after.claim_token_hash).toBe(tokenA);

      const before = sent.length;
      await monitor.runDailyCheck();
      expect(sent.slice(before)).toEqual([]);
      expect((await contactRow()).claim_token_hash).toBe(tokenA);
    });

    it("does not let a delayed older-generation acknowledgement re-open a served contact", async () => {
      // Generation N delivered; the owner re-armed and generation N+1 delivered a
      // fresh link; now generation N's delayed acknowledgement arrives.
      await runInactivityGrant();
      const first = (await settingsRow()).grant_generation;
      await lastSeenDaysAgo(0);
      await monitor.runDailyCheck(); // revoke + re-arm
      const second = await runInactivityGrant();
      expect(second.generation).toBeGreaterThan(first);
      const servedGeneration = (await contactRow()).notified_grant_generation;

      // The forward-only markContactNotified predicate, exercised directly: an
      // update carrying the older generation must not lower the stored one.
      await dataSource.query(
        `UPDATE emergency_access_contacts
            SET claim_notified_at = CURRENT_TIMESTAMP,
                notified_grant_generation = $2
          WHERE owner_user_id = $1
            AND (notified_grant_generation IS NULL
                 OR notified_grant_generation < $2)`,
        [owner, first],
      );

      expect((await contactRow()).notified_grant_generation).toBe(
        servedGeneration,
      );
    });

    it("refuses the pre-delivery-column binary's rotation over a live delivered link", async () => {
      // The REMAINING-002 race: the new pod granted, delivered token A and
      // recorded the delivery; a stale old pod whose granted_at snapshot predates
      // that grant now mints token B over it. Without the fence the only link in
      // the recipient's inbox dies silently -- the P4-014 outcome, reachable by an
      // ordinary rolling deploy.
      const { token } = await runInactivityGrant();
      const contactId = (await contactRow()).id;

      await expect(
        oldBinaryRotates(contactId, "0123456789abcdef"),
      ).rejects.toThrow(/newer release owns this credential cycle/);

      // The delivered link is untouched and still the one the database honours.
      expect((await contactRow()).claim_token_hash).toBe(hashToken(token));
    });

    it("refuses the pre-delivery-column binary's rotation over an undelivered credential", async () => {
      // The in-flight window: credential minted, delivery not yet recorded. A
      // generation-blind rotation would desync hash and ciphertext, so the resume
      // path would re-send a link whose hash is gone -- a dead link recorded as
      // delivered, which is worse than no link at all.
      const { token } = await runInactivityGrant();
      const contactId = (await contactRow()).id;
      await dataSource.query(
        `UPDATE emergency_access_contacts
            SET claim_notified_at = NULL,
                notified_grant_generation = NULL,
                claim_token_ciphertext = $2
          WHERE id = $1`,
        [contactId, encryption.encrypt(token)],
      );

      await expect(
        oldBinaryRotates(contactId, "0123456789abcdef"),
      ).rejects.toThrow(/newer release owns this credential cycle/);
      expect((await contactRow()).claim_token_hash).toBe(hashToken(token));
    });

    it("keeps the legacy binary working where no new-protocol state exists", async () => {
      // A rotation over a row with neither ciphertext nor generation is the old
      // binary retrying its own legacy grant -- exactly as correct as it is on
      // current main. Refusing it would stall every grant on a rollback, so the
      // fence must let it through.
      const contactId = (await contactRow()).id;
      await oldBinaryRotates(contactId, "fedcba9876543210");
      expect((await contactRow()).claim_token_hash).toBe(
        hashToken("fedcba9876543210"),
      );

      // And the new binary takes the legacy row over cleanly: no ciphertext means
      // the credential cannot be re-sent, so it rotates -- with the ciphertext in
      // the same statement, which is what passes the fence.
      const { token } = await runInactivityGrant();
      expect((await contactRow()).claim_token_hash).toBe(hashToken(token));

      // The old binary's owner-return revocation is never blocked either: it
      // clears the hash, which is not a rotation. Verbatim from current main's
      // revokeAfterReturn query-builder update.
      const revoked: unknown = await dataSource.query(
        `UPDATE emergency_access_contacts
            SET claim_token_hash = NULL,
                claim_token_expires_at = NULL,
                claim_token_used_at = CURRENT_TIMESTAMP,
                claim_voided_reason = 'owner_returned',
                updated_at = CURRENT_TIMESTAMP
          WHERE owner_user_id = $1
            AND claim_token_hash IS NOT NULL
            AND claim_token_used_at IS NULL`,
        [owner],
      );
      expect(affectedRowCount(revoked)).toBe(1);
      expect((await contactRow()).claim_token_hash).toBeNull();
    });
  });
});
