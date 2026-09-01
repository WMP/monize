/**
 * TEST DRIVE ONLY -- NOT FOR MERGE.
 *
 * On `claude/notification-settings-menu-4tebh9` this state lives in two tables
 * (`push_instance_config`, `push_subscriptions`, migration 171). This branch
 * exists to try the permission flow on a database that has NOT been migrated,
 * because the maintainer has not accepted the schema change yet -- so the same
 * state lives in process memory instead.
 *
 * What that costs, stated plainly:
 *
 *   * Everything here is gone on restart: the instance's VAPID key pair and every
 *     registered device. A restart therefore behaves exactly like a key rotation
 *     -- each device has to be enabled again.
 *   * One replica only. Two backend containers would hold two key pairs, and a
 *     device registered against one is undeliverable from the other.
 *   * No row-level security, because there are no rows. Ownership is enforced
 *     the same way the real service enforces it -- every read and write is keyed
 *     on the `userId` the controller took from the JWT -- but here that is the
 *     ONLY thing enforcing it, where the real branch also has an RLS policy
 *     behind it.
 *
 * None of that matters for answering "does turning notifications on work". All
 * of it matters for anything else, which is why this file says so.
 */
import { Logger } from "@nestjs/common";
import * as crypto from "crypto";

/** Mirrors the enum the real entity exports, so the copied files are unchanged. */
export enum PushDisabledReason {
  /** The push service says the subscription is gone (404/410). */
  GONE = "GONE",
  /** Minted under a key pair this instance has replaced. */
  KEY_ROTATED = "KEY_ROTATED",
  /** Too many consecutive transient failures. */
  FAILING = "FAILING",
}

/** One device, as the real table stores it minus the columns nothing here reads. */
export interface StoredSubscription {
  id: string;
  userId: string;
  endpoint: string;
  endpointHash: string;
  p256dh: string;
  auth: string;
  deviceName: string | null;
  userAgent: string | null;
  vapidPublicKey: string;
  createdAt: Date;
  lastSeenAt: Date;
  lastSuccessAt: Date | null;
  failureCount: number;
  disabledAt: Date | null;
  disabledReason: PushDisabledReason | null;
}

export interface StoredInstanceConfig {
  vapidPublicKey: string;
  vapidPrivateKey: string;
  vapidGeneratedAt: Date;
  webPushEnabled: boolean;
}

/**
 * The whole "database", one object.
 *
 * A module-level singleton rather than a Nest provider: the real thing is a
 * database, which is also shared across every injector in the process, and this
 * way the two behave the same when a spec builds a second testing module.
 */
const subscriptions = new Map<string, StoredSubscription>();
let instanceConfig: StoredInstanceConfig | null = null;

const logger = new Logger("PushTestDriveStore");

/**
 * The key pair, from the environment when supplied and generated once when not.
 *
 * `PUSH_VAPID_PUBLIC_KEY` / `PUSH_VAPID_PRIVATE_KEY` exist so a restart does not
 * invalidate the devices already registered during a test session -- generate a
 * pair once (`npx web-push generate-vapid-keys`), put it in `.env`, and the
 * subscriptions a browser holds keep working across restarts. Without them a
 * pair is generated at first use and logged, which is enough for one sitting.
 */
export function resolveInstanceConfig(
  generate: () => { publicKey: string; privateKey: string },
): StoredInstanceConfig {
  if (instanceConfig) return instanceConfig;

  const fromEnv = readKeyPairFromEnv();
  const pair = fromEnv ?? generate();
  instanceConfig = {
    vapidPublicKey: pair.publicKey,
    vapidPrivateKey: pair.privateKey,
    vapidGeneratedAt: new Date(),
    webPushEnabled: true,
  };

  logger.warn(
    "TEST DRIVE BUILD: the Web Push key pair and every registered device live " +
      "in process memory. A restart invalidates both, and a second replica " +
      "would hold a different key pair. Not for production.",
  );
  if (!fromEnv) {
    logger.log(
      "Generated an in-memory VAPID key pair. Set PUSH_VAPID_PUBLIC_KEY and " +
        `PUSH_VAPID_PRIVATE_KEY to keep devices across restarts. Public key: ${pair.publicKey}`,
    );
  }
  return instanceConfig;
}

function readKeyPairFromEnv(): {
  publicKey: string;
  privateKey: string;
} | null {
  const publicKey = process.env.PUSH_VAPID_PUBLIC_KEY?.trim();
  const privateKey = process.env.PUSH_VAPID_PRIVATE_KEY?.trim();
  if (!publicKey || !privateKey) return null;
  return { publicKey, privateKey };
}

/** Whether the channel is on. Always true here: there is no admin page to flip it. */
export function isChannelEnabled(): boolean {
  return instanceConfig?.webPushEnabled ?? true;
}

export function findByEndpointHash(
  endpointHash: string,
): StoredSubscription | undefined {
  return [...subscriptions.values()].find(
    (row) => row.endpointHash === endpointHash,
  );
}

/** Every device the caller owns, newest activity first, as the panel lists them. */
export function listForUser(userId: string): StoredSubscription[] {
  return [...subscriptions.values()]
    .filter((row) => row.userId === userId)
    .sort((a, b) => b.lastSeenAt.getTime() - a.lastSeenAt.getTime());
}

export function liveCountForUser(userId: string): number {
  return listForUser(userId).filter((row) => row.disabledAt === null).length;
}

export function upsert(input: {
  userId: string;
  endpoint: string;
  endpointHash: string;
  p256dh: string;
  auth: string;
  deviceName: string | null;
  userAgent: string | null;
  vapidPublicKey: string;
}): StoredSubscription {
  const existing = findByEndpointHash(input.endpointHash);
  if (existing) {
    // One endpoint has one owner, and the second subscriber is REFUSED rather
    // than allowed to take the row over -- the same rule the real unique index
    // enforces, for the same reason: an endpoint is a string the caller
    // supplied, so deleting somebody else's registration on the strength of it
    // is a cross-tenant write no ownership check covers.
    if (existing.userId !== input.userId) {
      throw new EndpointClaimedError();
    }
    existing.p256dh = input.p256dh;
    existing.auth = input.auth;
    existing.deviceName = input.deviceName ?? existing.deviceName;
    existing.userAgent = input.userAgent ?? existing.userAgent;
    existing.vapidPublicKey = input.vapidPublicKey;
    existing.lastSeenAt = new Date();
    existing.disabledAt = null;
    existing.disabledReason = null;
    existing.failureCount = 0;
    return existing;
  }

  const row: StoredSubscription = {
    id: crypto.randomUUID(),
    userId: input.userId,
    endpoint: input.endpoint,
    endpointHash: input.endpointHash,
    p256dh: input.p256dh,
    auth: input.auth,
    deviceName: input.deviceName,
    userAgent: input.userAgent,
    vapidPublicKey: input.vapidPublicKey,
    createdAt: new Date(),
    lastSeenAt: new Date(),
    lastSuccessAt: null,
    failureCount: 0,
    disabledAt: null,
    disabledReason: null,
  };
  subscriptions.set(row.id, row);
  return row;
}

/** Raised where the real service answers a 409 on the unique index. */
export class EndpointClaimedError extends Error {
  constructor() {
    super("This endpoint is registered to another account.");
    this.name = "EndpointClaimedError";
  }
}

/** Returns whether a row was removed, so the caller can answer 404 truthfully. */
export function remove(userId: string, id: string): boolean {
  const row = subscriptions.get(id);
  if (!row || row.userId !== userId) return false;
  subscriptions.delete(id);
  return true;
}

export function recordSuccess(userId: string, id: string): void {
  const row = subscriptions.get(id);
  if (!row || row.userId !== userId) return;
  row.lastSuccessAt = new Date();
  row.lastSeenAt = new Date();
  row.failureCount = 0;
}

export function recordExpired(
  userId: string,
  id: string,
  reason: PushDisabledReason,
): boolean {
  const row = subscriptions.get(id);
  if (!row || row.userId !== userId || row.disabledAt !== null) return false;
  row.disabledAt = new Date();
  row.disabledReason = reason;
  return true;
}

/** Returns whether THIS failure retired the device, as the real service does. */
export function recordFailure(
  userId: string,
  id: string,
  maxFailures: number,
): boolean {
  const row = subscriptions.get(id);
  if (!row || row.userId !== userId || row.disabledAt !== null) return false;
  row.failureCount += 1;
  if (row.failureCount < maxFailures) return false;
  row.disabledAt = new Date();
  row.disabledReason = PushDisabledReason.FAILING;
  return true;
}

/** For specs only: the store is a module singleton, so a spec has to clear it. */
export function resetPushStoreForTests(): void {
  subscriptions.clear();
  instanceConfig = null;
}
