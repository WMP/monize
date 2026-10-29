import { ConfigService } from "@nestjs/config";

/**
 * OIDC_ALLOW_PASSWORD_LOGIN=true lets an SSO account that has a local password
 * sign in with it (a fallback when the identity provider is down). Anything
 * else keeps the default: the password of an SSO account does not sign in, and
 * the OIDC login strips the app TOTP. The password itself is never cleared.
 */
export function oidcPasswordLoginAllowed(config: ConfigService): boolean {
  return config.get<string>("OIDC_ALLOW_PASSWORD_LOGIN") === "true";
}
