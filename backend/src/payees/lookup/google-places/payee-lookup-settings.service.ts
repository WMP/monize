import { BadRequestException, Injectable, Logger } from "@nestjs/common";
import { ConfigService } from "@nestjs/config";
import { DataSource } from "typeorm";
import { withScopedDb } from "../../../common/db/scoped-db";
import { EncryptionService } from "../../../common/encryption/encryption.service";
import { tr } from "../../../i18n/translate";
import { PayeeLookupSettings } from "../entities/payee-lookup-settings.entity";
import { GOOGLE_PLACES_CAP, resolveMonthlyCap } from "./google-places-cap";
import {
  OperatorGooglePlaces,
  resolveOperatorGooglePlaces,
} from "./google-places.config";
import { GooglePlacesLookupProvider } from "./google-places-lookup.provider";
import {
  PayeeLookupQuotaService,
  QuotaScope,
} from "./payee-lookup-quota.service";

/**
 * What the Test button searches for. A real business type rather than a nonsense
 * string, so a working key answers with results: an empty answer would also be
 * what a project with the wrong API enabled returns, and the two must not look
 * alike to someone checking their configuration.
 */
export const PAYEE_LOOKUP_TEST_QUERY = "coffee shop";

/** Who owns the key a lookup would spend, and what it may spend. */
export type ResolvedLookupSource =
  | { kind: "none" }
  | ({ kind: "operator" | "user"; apiKey: string } & QuotaScope);

export interface UpdatePayeeLookupSettings {
  enabled?: boolean;
  /** New key; `""` clears the stored one; absent keeps it. */
  apiKey?: string;
  capEnabled?: boolean;
  monthlyCap?: number;
}

/** What the settings screen renders. Never the key itself. */
export interface PayeeLookupSettingsView {
  /**
   * Who configures Google Places on this deployment. `operator` means the key
   * comes from `GOOGLE_PLACES_API_KEY` and the user may only turn it off;
   * `user` means this user has stored one; `none` means neither.
   */
  mode: "operator" | "user" | "none";
  /** True when a key exists for this user to use, wherever it came from. */
  configured: boolean;
  enabled: boolean;
  capEnabled: boolean;
  monthlyCap: number;
  /** `"****"` when a key is stored for this user, else null. Never the key. */
  apiKeyMasked: string | null;
  /**
   * False when a key is stored but this server cannot decrypt it -- a backup
   * restored elsewhere, or a rotated ENCRYPTION_KEY. Distinct from "no key",
   * because the repair is different: re-enter it.
   */
  apiKeyReadable: boolean;
  /** Requests spent this billing month against whichever key applies. */
  usedThisMonth: number;
  /** False when the server holds no ENCRYPTION_KEY, so no key can be stored. */
  encryptionAvailable: boolean;
}

/** What every lookup surface asks before offering a control. */
export interface PayeeLookupStatus {
  /** True when a lookup can run at all -- Places configured, or AI configured. */
  available: boolean;
  /** Which source would answer right now, or null when nothing can. */
  source: "google-places" | "ai" | null;
  aiConfigured: boolean;
  googlePlaces: {
    mode: "operator" | "user" | "none";
    enabled: boolean;
    /** True when the month's cap is spent, so lookups have fallen back to AI. */
    capReached: boolean;
  };
}

/**
 * The Google Places half of the payee contact lookup's configuration.
 *
 * **One place decides whose key is spent** (`resolveSource`), because the
 * answer has three inputs -- the operator's environment, this user's row, and
 * whether either is switched on -- and a second copy of that decision is how a
 * user ends up configuring a key that nothing reads.
 *
 * The operator's key WINS. It is the deployment's own resource (the env-var
 * rule in `backend/CLAUDE.md`), it is already paid for, and offering a user a
 * key field beside it would invite them to pay twice for the same lookup. In
 * that mode the per-user key and cap are refused rather than ignored, so a
 * client cannot store a setting that will never apply.
 */
@Injectable()
export class PayeeLookupSettingsService {
  private readonly logger = new Logger(PayeeLookupSettingsService.name);

  constructor(
    private readonly dataSource: DataSource,
    private readonly encryption: EncryptionService,
    private readonly quota: PayeeLookupQuotaService,
    private readonly places: GooglePlacesLookupProvider,
    private readonly configService?: ConfigService,
  ) {}

  /** The operator's configuration, or null when the deployment set no key. */
  operatorConfig(): OperatorGooglePlaces | null {
    return resolveOperatorGooglePlaces(this.configService, this.logger);
  }

  async getSettings(userId: string): Promise<PayeeLookupSettingsView> {
    const row = await this.readRow(userId);
    const operator = this.operatorConfig();
    const mode = operator ? "operator" : row?.apiKeyEnc ? "user" : "none";
    const enabled = row?.googlePlacesEnabled ?? true;
    const apiKeyReadable = row?.apiKeyEnc
      ? this.encryption.canDecrypt(row.apiKeyEnc)
      : true;

    const source = this.sourceFrom(userId, row, operator);
    return {
      mode,
      configured: mode !== "none",
      enabled,
      capEnabled: operator ? true : (row?.capEnabled ?? true),
      monthlyCap: operator
        ? operator.monthlyCap
        : resolveMonthlyCap(row?.monthlyCap),
      apiKeyMasked: row?.apiKeyEnc ? "****" : null,
      apiKeyReadable,
      usedThisMonth:
        source.kind === "none" ? 0 : await this.quota.usedThisMonth(source),
      encryptionAvailable: this.encryption.isConfigured(),
    };
  }

  /**
   * Save what the user changed. Fields absent from the payload are left alone,
   * which is what lets the settings card save the switch without resending a
   * key it never had in the first place.
   */
  async updateSettings(
    userId: string,
    update: UpdatePayeeLookupSettings,
  ): Promise<PayeeLookupSettingsView> {
    const operator = this.operatorConfig();
    if (
      operator &&
      (update.apiKey !== undefined ||
        update.capEnabled !== undefined ||
        update.monthlyCap !== undefined)
    ) {
      // Refused rather than ignored: a stored setting that can never apply is
      // indistinguishable, from the screen, from one that does.
      throw new BadRequestException(
        tr(
          "errors.payeeLookup.operatorManaged",
          "Google Places is configured by this server's administrator. Only the on/off setting can be changed here.",
        ),
      );
    }
    if (update.apiKey && !this.encryption.isConfigured()) {
      throw new BadRequestException(
        tr(
          "errors.payeeLookup.encryptionKeyNotConfigured",
          "ENCRYPTION_KEY is not configured. Cannot store the Google Places API key securely.",
        ),
      );
    }

    await withScopedDb(this.dataSource, async (m) => {
      const repo = m.getRepository(PayeeLookupSettings);
      const existing = await repo.findOne({ where: { userId } });
      const row = existing ?? repo.create({ userId });
      if (update.enabled !== undefined)
        row.googlePlacesEnabled = update.enabled;
      if (update.capEnabled !== undefined) row.capEnabled = update.capEnabled;
      if (update.monthlyCap !== undefined) row.monthlyCap = update.monthlyCap;
      if (update.apiKey !== undefined) {
        // An empty string is "remove the key"; a value is a new one. Absent is
        // "keep what is stored", which is what the form sends when the user
        // edits the cap without retyping a secret they cannot see.
        row.apiKeyEnc = update.apiKey
          ? this.encryption.encrypt(update.apiKey)
          : null;
      }
      if (!existing) {
        row.googlePlacesEnabled = update.enabled ?? true;
        row.capEnabled = update.capEnabled ?? true;
        row.monthlyCap = update.monthlyCap ?? GOOGLE_PLACES_CAP.default;
      }
      await repo.save(row);
    });

    return this.getSettings(userId);
  }

  /**
   * Which key a lookup for this user would spend, and under what cap.
   *
   * `none` means Places cannot answer -- no key anywhere, the user switched it
   * off, or the stored key cannot be decrypted by this server. The last is
   * deliberately the same answer as "no key": a key we cannot read is a key we
   * cannot spend, and reporting it as configured would offer a lookup whose
   * only possible outcome is a refusal from Google.
   */
  async resolveSource(userId: string): Promise<ResolvedLookupSource> {
    const row = await this.readRow(userId);
    return this.sourceFrom(userId, row, this.operatorConfig());
  }

  private sourceFrom(
    userId: string,
    row: PayeeLookupSettings | null,
    operator: OperatorGooglePlaces | null,
  ): ResolvedLookupSource {
    const enabled = row?.googlePlacesEnabled ?? true;
    if (!enabled) return { kind: "none" };

    if (operator) {
      return {
        kind: "operator",
        apiKey: operator.apiKey,
        capEnabled: true,
        cap: operator.monthlyCap,
      };
    }
    if (!row?.apiKeyEnc) return { kind: "none" };

    let apiKey: string;
    try {
      apiKey = this.encryption.decrypt(row.apiKeyEnc);
    } catch {
      this.logger.warn(
        `Stored Google Places API key for user ${userId} cannot be decrypted by this server; ` +
          "payee lookups fall back to AI until it is re-entered.",
      );
      return { kind: "none" };
    }
    return {
      kind: "user",
      apiKey,
      userId,
      capEnabled: row.capEnabled,
      cap: resolveMonthlyCap(row.monthlyCap),
    };
  }

  /**
   * What a surface needs to decide whether to offer a lookup control at all.
   *
   * `capReached` is reported even though the lookup still works -- it falls
   * back to AI -- because it is the one state the settings screen has to
   * explain: the user is no longer spending the key they configured.
   */
  async getStatus(
    userId: string,
    aiConfigured: boolean,
  ): Promise<PayeeLookupStatus> {
    const row = await this.readRow(userId);
    const operator = this.operatorConfig();
    const source = this.sourceFrom(userId, row, operator);
    const mode = operator ? "operator" : row?.apiKeyEnc ? "user" : "none";

    let capReached = false;
    if (source.kind !== "none" && source.capEnabled) {
      capReached = (await this.quota.usedThisMonth(source)) >= source.cap;
    }
    const placesUsable = source.kind !== "none" && !capReached;

    return {
      available: placesUsable || aiConfigured,
      source: placesUsable ? "google-places" : aiConfigured ? "ai" : null,
      aiConfigured,
      googlePlaces: {
        mode,
        enabled: row?.googlePlacesEnabled ?? true,
        capReached,
      },
    };
  }

  /**
   * Ask Google whether a key works, by making exactly the request a lookup
   * makes.
   *
   * It goes through the same provider as a real lookup -- breaker, quota claim
   * and all -- rather than a private fetch of its own, for two reasons: a test
   * that skipped the quota would spend a request Google bills without counting
   * it, and a second outbound client would be a second place to keep the
   * breaker discipline correct.
   */
  async testKey(
    userId: string,
    draftKey?: string,
  ): Promise<{ available: boolean; error?: string }> {
    const operator = this.operatorConfig();
    // Refused outright in operator mode, not merely for a draft key. There is
    // nothing here for a user to test -- the key is the deployment's, and they
    // cannot change it -- while a test still spends a slot off the ONE counter
    // every user on the instance shares. Allowing it let any authenticated
    // caller drain the deployment's month at the throttle ceiling and leave
    // everyone else falling back to AI, which is the same reason
    // `updateSettings` refuses an operator-managed change rather than ignoring
    // it. Hiding the button in operator mode is not the enforcement.
    if (operator) {
      throw new BadRequestException(
        tr(
          "errors.payeeLookup.operatorManaged",
          "Google Places is configured by this server's administrator. Only the on/off setting can be changed here.",
        ),
      );
    }

    const source = await this.resolveSource(userId);
    const apiKey = draftKey || (source.kind === "none" ? null : source.apiKey);
    if (!apiKey) {
      throw new BadRequestException(
        tr(
          "errors.payeeLookup.notConfigured",
          "No Google Places API key is configured.",
        ),
      );
    }

    // A draft key belongs to this user whatever the stored row says, so its
    // test is counted against their own quota rather than against nobody's.
    const scope: QuotaScope =
      source.kind === "none"
        ? {
            kind: "user",
            userId,
            capEnabled: false,
            cap: GOOGLE_PLACES_CAP.max,
          }
        : source;
    if ((await this.quota.claim(scope)) === null) {
      return {
        available: false,
        error: tr(
          "errors.payeeLookup.capReached",
          "This month's Google Places request limit has been reached.",
        ),
      };
    }

    try {
      await this.places.lookup(apiKey, { name: PAYEE_LOOKUP_TEST_QUERY });
      return { available: true };
    } catch (error) {
      // Google's own refusal message where there is one ("API key not valid",
      // "this API is not enabled") -- that is the whole value of a test button.
      return {
        available: false,
        error:
          error instanceof Error && error.message
            ? error.message
            : tr(
                "errors.payeeLookup.testFailed",
                "The Google Places connection test failed.",
              ),
      };
    }
  }

  private async readRow(userId: string): Promise<PayeeLookupSettings | null> {
    return withScopedDb(this.dataSource, (m) =>
      m.getRepository(PayeeLookupSettings).findOne({ where: { userId } }),
    );
  }
}
