import { defaultMetadataStorage } from "class-transformer/cjs/storage";
import { User } from "./entities/user.entity";
import { PROFILE_FIELDS } from "./user-profile";

/**
 * Every `User` property carrying `@Exclude()`, read off class-transformer's
 * metadata rather than copied into a list.
 *
 * The point of reading the metadata is that adding `@Exclude() newSecret` to the
 * entity extends this set automatically, so the profile guards below start
 * asserting the new column on the commit that introduces it -- no author has to
 * remember to update a second list. (That remembering is exactly what produced
 * five divergent sanitizers and P2-003.)
 */
export function excludedUserFields(): string[] {
  const excluded = defaultMetadataStorage.getExcludedMetadatas(User);
  return excluded
    .map((meta: { propertyName?: string }) => meta.propertyName)
    .filter((name: string | undefined): name is string => !!name);
}

/**
 * A `User` row with **every** column set to a recognizable non-empty value,
 * including the secrets. A fixture that leaves the sensitive columns `null`
 * cannot detect a leak: `expect(result).not.toHaveProperty(x)` is the only
 * assertion that still fails, and `toEqual` on a partial object does not.
 */
export function fullyPopulatedUser(overrides: Partial<User> = {}): User {
  const user = new User();
  Object.assign(user, {
    id: "owner-1",
    email: "owner@example.com",
    passwordHash: "$2b$10$LEAK-password-hash",
    firstName: "Olivia",
    lastName: "Owner",
    authProvider: "local",
    oidcSubject: "LEAK-oidc-subject",
    isActive: true,
    createdAt: new Date("2026-01-01T00:00:00Z"),
    updatedAt: new Date("2026-02-01T00:00:00Z"),
    lastLogin: new Date("2026-03-01T00:00:00Z"),
    lastActivityAt: new Date("2026-03-02T00:00:00Z"),
    resetToken: "LEAK-reset-token",
    resetTokenExpiry: new Date("2026-04-01T00:00:00Z"),
    emailVerified: true,
    emailVerificationToken: "LEAK-email-verification-token",
    emailVerificationTokenExpiry: new Date("2026-04-02T00:00:00Z"),
    role: "user",
    mustChangePassword: false,
    twoFactorSecret: "LEAK-totp-secret",
    pendingTwoFactorSecret: "LEAK-pending-totp-secret",
    failedLoginAttempts: 3,
    lockedUntil: new Date("2026-04-03T00:00:00Z"),
    backupCodes: '["LEAK-backup-code"]',
    oidcLinkPending: true,
    oidcLinkToken: "LEAK-oidc-link-token",
    oidcLinkExpiresAt: new Date("2026-04-04T00:00:00Z"),
    pendingOidcSubject: "LEAK-pending-oidc-subject",
    isDelegateOnly: false,
    backupEncryptionEnabled: true,
    backupPasswordEnc: "LEAK-encrypted-backup-password",
  });
  return Object.assign(user, overrides);
}

/**
 * Columns on a fully-populated row that the profile allowlist does not name.
 * Covers more than `excludedUserFields()`: a column with no `@Exclude()` that
 * nobody added to `PROFILE_FIELDS` is still not part of the contract, and a
 * response carrying it is a response nobody reviewed.
 */
export function nonProfileUserFields(): string[] {
  const allowed = new Set<string>(PROFILE_FIELDS);
  return Object.keys(fullyPopulatedUser()).filter(
    (field) => !allowed.has(field),
  );
}
