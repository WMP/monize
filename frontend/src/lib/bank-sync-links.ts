/**
 * Where the reader goes to create and manage an Enable Banking application.
 *
 * The control panel path could not be verified from the development
 * environment (no outbound access to the provider), so it is checked against
 * the live site in task BS10 (docs/future-plans/bank-sync-tasks.md). If the
 * provider has moved it, this constant is the one place to correct.
 */
export const ENABLE_BANKING_CONTROL_PANEL_URL =
  'https://enablebanking.com/cp/applications';

/** The provider's public site. */
export const ENABLE_BANKING_SITE_URL = 'https://enablebanking.com';

/**
 * The privacy notice and terms of use templates that ship with Monize. Enable
 * Banking requires a URL for each when a Production application is registered;
 * a person running Monize only for themselves can enter these two. They are
 * templates, so anyone else's instance publishes its own version instead.
 */
export const BANK_SYNC_PRIVACY_TEMPLATE_URL =
  'https://github.com/kenlasko/monize/blob/main/docs/legal/bank-sync-privacy.md';
export const BANK_SYNC_TERMS_TEMPLATE_URL =
  'https://github.com/kenlasko/monize/blob/main/docs/legal/bank-sync-terms.md';
