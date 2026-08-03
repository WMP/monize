import { User } from "./entities/user.entity";

/**
 * The one audited serializer for a `users` row leaving the API.
 *
 * Every profile response used to build itself by destructuring the entity and
 * removing the fields it happened to remember -- five call sites, five different
 * removal lists, and not one of them dropped `backupPasswordEnc`. A removal list
 * is the wrong shape for this: a column added to the entity is included by
 * default, and only an author who thinks to revisit five spread expressions
 * excludes it. So this is an **allowlist**: a new column is absent from every
 * response until someone names it here.
 *
 * `PROFILE_FIELDS` is the whole contract, and `user-profile.spec.ts` proves it
 * against class-transformer's `@Exclude()` metadata, so a newly excluded column
 * that leaks through here fails the suite rather than shipping.
 *
 * Never add a field whose value is a credential, a token, a pending
 * verification/linking secret, or ciphertext -- those exist so the server can
 * finish a workflow, and no client needs them. `hasPassword` is the sanctioned
 * shape for that kind of fact: a boolean derived from the secret, never the
 * secret.
 */
export const PROFILE_FIELDS = [
  "id",
  "email",
  "firstName",
  "lastName",
  "authProvider",
  "isActive",
  "createdAt",
  "updatedAt",
  "lastLogin",
  "lastActivityAt",
  "emailVerified",
  "role",
  "mustChangePassword",
  "isDelegateOnly",
  "backupEncryptionEnabled",
] as const satisfies readonly (keyof User)[];

export type UserProfile = Pick<User, (typeof PROFILE_FIELDS)[number]> & {
  hasPassword: boolean;
};

/**
 * Facts about how the *account holder* authenticates. They are not secrets, but
 * they describe the login itself, and delegation shares finances rather than
 * credentials -- so a delegate acting in the owner's context does not receive
 * them. The delegate's own copies live behind `GET /auth/me-self`, which
 * resolves the real authenticated user; a UI that drives a credential control
 * from the acting-context profile is reading the wrong row, and their absence
 * here is what makes that visible.
 */
export const SELF_ONLY_PROFILE_FIELDS = [
  "hasPassword",
  "mustChangePassword",
  "isDelegateOnly",
  "backupEncryptionEnabled",
] as const;

/**
 * Serialize `user` for the account holder or an administrator managing the row.
 *
 * Takes a `Partial<User>` because several callers pass a narrowed `select`
 * result: an absent column stays absent rather than becoming an explicit
 * `undefined` the client has to tell apart from "not set".
 */
export function toUserProfile(user: Partial<User>): UserProfile {
  const profile: Record<string, unknown> = {};
  for (const field of PROFILE_FIELDS) {
    if (field in user) {
      profile[field] = user[field];
    }
  }
  profile.hasPassword = !!user.passwordHash;
  return profile as UserProfile;
}

/**
 * Serialize `user` for a delegate acting in that user's context: the profile
 * the UI needs to show whose finances are on screen, without the owner's
 * credential state.
 */
export function toDelegatedUserProfile(
  user: Partial<User>,
): Omit<UserProfile, (typeof SELF_ONLY_PROFILE_FIELDS)[number]> {
  const delegated: Record<string, unknown> = { ...toUserProfile(user) };
  for (const field of SELF_ONLY_PROFILE_FIELDS) {
    delete delegated[field];
  }
  return delegated as Omit<
    UserProfile,
    (typeof SELF_ONLY_PROFILE_FIELDS)[number]
  >;
}
