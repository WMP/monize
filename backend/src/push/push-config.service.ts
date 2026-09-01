/**
 * TEST DRIVE ONLY -- NOT FOR MERGE. See `push-store.ts` for what this replaces
 * and what it costs.
 *
 * The real service on `claude/notification-settings-menu-4tebh9` stores one row
 * in `push_instance_config` (migration 171) and keeps the private half encrypted
 * under `ENCRYPTION_KEY`. This one holds the pair in process memory, so the
 * permission flow can be tried against a database nobody has migrated.
 *
 * The public surface is deliberately identical -- `PublicPushConfig`,
 * `getPublicConfig`, `getVapidIdentity`, `VAPID_SUBJECT` -- so every other file
 * on the real branch is copied here byte for byte rather than adapted. A file
 * that had to be edited to fit this build would no longer be the file being
 * tested.
 */
import { Injectable, Logger } from "@nestjs/common";
import * as crypto from "crypto";
import * as webpush from "web-push";
import { isChannelEnabled, resolveInstanceConfig } from "./push-store";

/**
 * The `sub` claim on every VAPID JWT: who to contact about this deployment's
 * push traffic. A URL rather than a mailto so nothing here carries an address.
 */
export const VAPID_SUBJECT = "https://github.com/kenlasko/monize";

/** What the browser is allowed to know about this instance's push channel. */
export interface PublicPushConfig {
  /** The instance holds a usable key pair and the channel is on. */
  enabled: boolean;
  /** Handed to `pushManager.subscribe()`. Public by construction. */
  publicKey: string | null;
  /** False when the instance holds no key pair at all. */
  configured: boolean;
  /** A stored key pair this server cannot decrypt. Never true in this build. */
  keyUnreadable: boolean;
  /** Whether the server holds an encryption key. Irrelevant here; always true. */
  encryptionAvailable: boolean;
}

/** What `WebPushSender` needs and nothing else may ask for. */
export interface VapidIdentity {
  publicKey: string;
  privateKey: string;
}

/** A short, comparable name for a public key. */
export function fingerprintPublicKey(publicKey: string): string {
  return crypto
    .createHash("sha256")
    .update(publicKey)
    .digest("hex")
    .slice(0, 16);
}

@Injectable()
export class PushConfigService {
  private readonly logger = new Logger(PushConfigService.name);

  /**
   * The key pair, generated on first use rather than at bootstrap.
   *
   * The real service generates it in `onApplicationBootstrap` so the first
   * request does not pay a scrypt derivation. There is no encryption here, so
   * there is nothing to pay -- and generating lazily keeps a build that nobody
   * asks about push from logging a warning it has not earned.
   */
  private identity(): VapidIdentity {
    const config = resolveInstanceConfig(() => webpush.generateVAPIDKeys());
    return {
      publicKey: config.vapidPublicKey,
      privateKey: config.vapidPrivateKey,
    };
  }

  getPublicConfig(): Promise<PublicPushConfig> {
    const { publicKey } = this.identity();
    return Promise.resolve({
      enabled: isChannelEnabled(),
      publicKey,
      configured: true,
      keyUnreadable: false,
      encryptionAvailable: true,
    });
  }

  getVapidIdentity(): Promise<VapidIdentity | null> {
    if (!isChannelEnabled()) return Promise.resolve(null);
    return Promise.resolve(this.identity());
  }

  /** Logged once, so the container log says which pair devices registered under. */
  logFingerprint(): void {
    this.logger.log(
      `Web Push key fingerprint ${fingerprintPublicKey(this.identity().publicKey)}`,
    );
  }
}
