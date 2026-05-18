import { SetMetadata } from "@nestjs/common";

/**
 * Marks a route as reachable by a delegate who is acting as an owner.
 *
 * The default posture is fail-closed: while a request carries a delegate
 * "acting-as" context, AccountDelegateGuard rejects any route NOT annotated
 * with @AllowDelegate(). Normal (non-delegate) requests are unaffected.
 */
export const ALLOW_DELEGATE_KEY = "allowDelegate";
export const AllowDelegate = () => SetMetadata(ALLOW_DELEGATE_KEY, true);

/**
 * Marks a route as account-scoped for delegates. The value is the request key
 * holding the account id; the guard additionally requires an active READ grant
 * for that account. Lookup order: route params, then body, then query.
 */
export const DELEGATED_ACCOUNT_PARAM_KEY = "delegatedAccountParam";
export const DelegatedAccountParam = (key = "id") =>
  SetMetadata(DELEGATED_ACCOUNT_PARAM_KEY, key);
