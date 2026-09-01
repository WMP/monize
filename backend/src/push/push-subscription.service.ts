/**
 * TEST DRIVE ONLY -- NOT FOR MERGE. See `push-store.ts`.
 *
 * The real service on `claude/notification-settings-menu-4tebh9` reads and writes
 * `push_subscriptions` (migration 171) inside `withScopedDb`, under a row-level
 * security policy. This one keeps the same rows in process memory so the
 * permission flow can be tried on an un-migrated database.
 *
 * Everything that is NOT persistence is kept, because it is what the test drive
 * is about: the per-account device cap, the bounded fan-out, the endpoint
 * re-check on every send, the failure counting, and the refusal to take over an
 * endpoint another account registered. The bounds and the reasoning are the real
 * file's; only the storage differs.
 *
 * The one real database read that survives is the recipient's language, from
 * `user_preferences` -- that table exists on `main`, so the push body is composed
 * in the reader's own locale exactly as it will be after the migration lands.
 */
import {
  BadRequestException,
  Injectable,
  Logger,
  NotFoundException,
} from "@nestjs/common";
import { DataSource } from "typeorm";
import * as crypto from "crypto";
import { I18nService } from "nestjs-i18n";
import { withScopedDb } from "../common/db/scoped-db";
import { tr } from "../i18n/translate";
import { emailTranslator } from "../i18n/email-translator";
import { resolveUserEmailLocale } from "../i18n/resolve-user-email-locale";
import { UserPreference } from "../users/entities/user-preference.entity";
import { PushConfigService } from "./push-config.service";
import {
  EndpointClaimedError,
  PushDisabledReason,
  StoredSubscription,
  listForUser,
  liveCountForUser,
  recordExpired,
  recordFailure,
  recordSuccess,
  remove as removeFromStore,
  upsert,
} from "./push-store";
import {
  MAX_CONSECUTIVE_FAILURES,
  PUSH_ENDPOINT_RECHECK_TIMEOUT_MS,
  PUSH_REQUEST_DEADLINE_MS,
  PushPayload,
  PushSendOutcome,
  WebPushSender,
} from "./web-push-sender.service";
import { CreatePushSubscriptionDto } from "./dto/create-push-subscription.dto";

/** How many hex characters of the endpoint digest identify a device publicly. */
export const ENDPOINT_FINGERPRINT_LENGTH = 16;

/** One of the caller's own devices, as the settings page renders it. */
export interface PushDeviceDto {
  id: string;
  endpointFingerprint: string;
  deviceName: string | null;
  userAgent: string | null;
  createdAt: string;
  lastSeenAt: string;
  lastSuccessAt: string | null;
  disabledAt: string | null;
  disabledReason: PushDisabledReason | null;
}

export interface PushTestDeviceResult {
  id: string;
  deviceName: string | null;
  status: PushSendOutcome["status"];
  disabledReason?: PushDisabledReason;
}

export interface PushTestResult {
  attempted: number;
  delivered: number;
  devices: PushTestDeviceResult[];
}

export function hashEndpoint(endpoint: string): string {
  return crypto.createHash("sha256").update(endpoint).digest("hex");
}

/** Longest `User-Agent` stored; matches the real column's width. */
export const MAX_USER_AGENT_LENGTH = 255;

/** Live devices one account may hold, so one request's fan-out is bounded. */
export const MAX_LIVE_DEVICES_PER_USER = 20;

/** How many devices one test send talks to at a time. */
export const PUSH_TEST_CONCURRENCY = 4;

/** The longest `POST /push/test` can take, derived rather than restated. */
export const PUSH_TEST_WORST_CASE_MS =
  Math.ceil(MAX_LIVE_DEVICES_PER_USER / PUSH_TEST_CONCURRENCY) *
  (PUSH_ENDPOINT_RECHECK_TIMEOUT_MS + PUSH_REQUEST_DEADLINE_MS);

/** Matches `ENDPOINT_CLAIMED_CODE` the client reads to answer the 409. */
export const ENDPOINT_CLAIMED_CODE = "pushEndpointClaimed";

@Injectable()
export class PushSubscriptionService {
  private readonly logger = new Logger(PushSubscriptionService.name);

  constructor(
    private readonly dataSource: DataSource,
    private readonly pushConfig: PushConfigService,
    private readonly sender: WebPushSender,
    private readonly i18n: I18nService,
  ) {}

  /**
   * Register (or refresh) the calling user's device.
   *
   * Both refusals are decided before anything is written, and the second
   * subscriber for one endpoint is REFUSED rather than allowed to take the row
   * over -- an endpoint is a string the caller supplied, so deleting somebody
   * else's registration on the strength of it is a cross-tenant write no
   * ownership check covers. The client answers the 409 by unsubscribing and
   * subscribing again for a fresh endpoint.
   */
  async subscribe(
    userId: string,
    dto: CreatePushSubscriptionDto,
    userAgent: string | null,
  ): Promise<PushDeviceDto> {
    const config = await this.pushConfig.getPublicConfig();
    if (!config.enabled || !config.publicKey) {
      throw new BadRequestException(
        tr(
          "errors.push.channelUnavailable",
          "Push notifications are not available on this Monize instance.",
        ),
      );
    }
    if (dto.applicationServerKey !== config.publicKey) {
      throw new BadRequestException(
        tr(
          "errors.push.keyRotated",
          "This instance changed its push key while you were on this page. Reload and enable push again.",
        ),
      );
    }

    const endpointHash = hashEndpoint(dto.endpoint);
    const alreadyHeld = listForUser(userId).some(
      (row) => row.endpointHash === endpointHash && row.disabledAt === null,
    );
    if (!alreadyHeld && liveCountForUser(userId) >= MAX_LIVE_DEVICES_PER_USER) {
      throw new BadRequestException(
        tr(
          "errors.push.tooManyDevices",
          "This account already has the maximum number of push devices. Remove one before adding another.",
        ),
      );
    }

    try {
      const row = upsert({
        userId,
        endpoint: dto.endpoint,
        endpointHash,
        p256dh: dto.p256dh,
        auth: dto.auth,
        deviceName: dto.deviceName ?? null,
        userAgent: userAgent ? userAgent.slice(0, MAX_USER_AGENT_LENGTH) : null,
        vapidPublicKey: config.publicKey,
      });
      return toDeviceDto(row);
    } catch (error) {
      if (error instanceof EndpointClaimedError) {
        throw new BadRequestException({
          message:
            "This browser is already registered to another account. Sign out there, or clear this site's data, and try again.",
          errorCode: ENDPOINT_CLAIMED_CODE,
        });
      }
      throw error;
    }
  }

  listForUser(userId: string): Promise<PushDeviceDto[]> {
    return Promise.resolve(listForUser(userId).map(toDeviceDto));
  }

  remove(userId: string, id: string): Promise<void> {
    if (!removeFromStore(userId, id)) {
      throw new NotFoundException(
        tr("errors.push.deviceNotFound", "Push device not found."),
      );
    }
    return Promise.resolve();
  }

  /**
   * Send the calling user a test notification on every one of their live
   * devices, and record what each attempt did.
   *
   * The sends happen outside any transaction and the bookkeeping follows them: a
   * push is an external side effect nothing can roll back, so the order that
   * survives is "do the thing, then write down what happened".
   */
  async sendTest(userId: string): Promise<PushTestResult> {
    const config = await this.pushConfig.getPublicConfig();
    if (!config.enabled) {
      throw new BadRequestException(
        tr(
          "errors.push.channelUnavailable",
          "Push notifications are not available on this Monize instance.",
        ),
      );
    }

    const targets = listForUser(userId).filter(
      (row) => row.disabledAt === null,
    );
    if (targets.length === 0) {
      throw new BadRequestException(
        tr(
          "errors.push.noDevices",
          "No push devices are registered for this account. Enable push notifications in this browser first.",
        ),
      );
    }

    // Composed on the server, so the recipient's stored language is the only
    // locale available -- exactly the reason emails resolve theirs this way.
    const lang = await withScopedDb(this.dataSource, (manager) =>
      resolveUserEmailLocale(manager.getRepository(UserPreference), userId),
    );
    const t = emailTranslator(this.i18n, lang);
    const payload: PushPayload = {
      type: "TEST",
      title: t("push.test.title", "Monize test notification"),
      body: t(
        "push.test.body",
        "Push notifications are working on this device.",
      ),
      target: "/settings",
      // One subject: "push works here". Two taps leave one notification.
      collapseKey: null,
    };

    const devices: PushTestDeviceResult[] = [];
    for (let i = 0; i < targets.length; i += PUSH_TEST_CONCURRENCY) {
      const batch = targets.slice(i, i + PUSH_TEST_CONCURRENCY);
      const results = await Promise.all(
        batch.map(async (target) => {
          const outcome = await this.sender.send(
            {
              endpoint: target.endpoint,
              p256dh: target.p256dh,
              auth: target.auth,
              vapidPublicKey: target.vapidPublicKey,
            },
            payload,
          );
          const disabledReason = this.recordOutcome(userId, target.id, outcome);
          return {
            id: target.id,
            deviceName: target.deviceName,
            status: outcome.status,
            ...(disabledReason ? { disabledReason } : {}),
          };
        }),
      );
      devices.push(...results);
    }

    const delivered = devices.filter((d) => d.status === "sent").length;
    if (delivered < devices.length) {
      this.logger.warn(
        `Test push reached ${delivered} of ${devices.length} device(s) for user ${userId}`,
      );
    }
    return { attempted: targets.length, delivered, devices };
  }

  /** What one attempt did, and the reason it retired the device if it did. */
  private recordOutcome(
    userId: string,
    id: string,
    outcome: PushSendOutcome,
  ): PushDisabledReason | undefined {
    if (outcome.status === "unconfigured") return undefined;
    if (outcome.status === "sent") {
      recordSuccess(userId, id);
      return undefined;
    }
    if (outcome.status === "expired") {
      return recordExpired(userId, id, outcome.reason)
        ? outcome.reason
        : undefined;
    }
    // A throttle is the push service rate-limiting this INSTANCE, not this
    // device: counted, it would retire every device in the deployment over one
    // outage.
    if (outcome.throttled) return undefined;
    return recordFailure(userId, id, MAX_CONSECUTIVE_FAILURES)
      ? PushDisabledReason.FAILING
      : undefined;
  }
}

function toDeviceDto(row: StoredSubscription): PushDeviceDto {
  return {
    id: row.id,
    // A prefix of the endpoint's digest, so this browser can recognise which row
    // is itself. The endpoint is a delivery credential and never leaves here.
    endpointFingerprint: row.endpointHash.slice(0, ENDPOINT_FINGERPRINT_LENGTH),
    deviceName: row.deviceName,
    userAgent: row.userAgent,
    createdAt: row.createdAt.toISOString(),
    lastSeenAt: row.lastSeenAt.toISOString(),
    lastSuccessAt: row.lastSuccessAt ? row.lastSuccessAt.toISOString() : null,
    disabledAt: row.disabledAt ? row.disabledAt.toISOString() : null,
    disabledReason: row.disabledReason,
  };
}
