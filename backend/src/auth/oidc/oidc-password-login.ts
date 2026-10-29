import { ConfigService } from "@nestjs/config";
import type { User } from "../../users/entities/user.entity";

/**
 * OIDC_ALLOW_PASSWORD_LOGIN=true lets an SSO account that has a local password
 * sign in with it (a fallback when the identity provider is down). Anything
 * else keeps the default: the password of an SSO account does not sign in, and
 * the OIDC login strips the app TOTP. The password itself is never cleared.
 * Local auth must be on too, or no password sign-in exists at all.
 */
export function oidcPasswordLoginAllowed(config: ConfigService): boolean {
  const localAuthEnabled =
    config.get<string>("LOCAL_AUTH_ENABLED", "true").toLowerCase() !== "false";
  return (
    localAuthEnabled &&
    config.get<string>("OIDC_ALLOW_PASSWORD_LOGIN") === "true"
  );
}

/**
 * Whether the local password may be the single factor for this account: an SSO
 * account's password counts only while password sign-in is allowed for it.
 */
export function localPasswordUsable(
  user: Pick<User, "passwordHash" | "authProvider">,
  allowed: boolean,
): boolean {
  return !!user.passwordHash && (user.authProvider !== "oidc" || allowed);
}
