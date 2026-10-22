import type { DensityLevel } from '@/hooks/useTableDensity';

/**
 * The account-level view defaults a user can set in Settings -> Preferences,
 * stored as the cross-device `viewDefaults` preference
 * (`user_preferences.view_defaults`).
 *
 * Every one except `accountOpenTarget` is a fallback for a setting the browser
 * keeps itself (row density, the register's year display, the Transactions
 * page's widgets and chart): the browser's own saved choice wins, the account
 * default applies where the browser has saved nothing, and the built-in
 * default applies where neither exists. `accountOpenTarget` has no browser
 * copy; it is read from here alone.
 *
 * A string array lists an enum's values; `'boolean'` marks a flag. The backend
 * declares the same map and its contract spec parses this literal, so it stays
 * an `as const` object literal of quoted values.
 */
export const VIEW_DEFAULT_FIELDS = {
  density: ['normal', 'compact', 'dense'],
  hideRegisterYear: 'boolean',
  widgetsCollapsed: 'boolean',
  chartCollapsed: 'boolean',
  accountOpenTarget: ['register', 'dashboard'],
} as const satisfies Record<string, readonly string[] | 'boolean'> & {
  density: readonly DensityLevel[];
};

/** Where clicking an account opens it: its register, or its dashboard page. */
export type AccountOpenTarget = (typeof VIEW_DEFAULT_FIELDS.accountOpenTarget)[number];

export type ViewDefaultKey = keyof typeof VIEW_DEFAULT_FIELDS;

type ValueOf<K extends ViewDefaultKey> = (typeof VIEW_DEFAULT_FIELDS)[K] extends 'boolean'
  ? boolean
  : (typeof VIEW_DEFAULT_FIELDS)[K] extends readonly (infer V)[]
    ? V
    : never;

/**
 * The wire shape of the preference. Every key is optional (absent means no
 * account default, so the built-in one applies) and the values are untrusted
 * on read: `readViewDefault` drops any it does not know.
 */
export type ViewDefaults = { [K in ViewDefaultKey]?: ValueOf<K> };

/**
 * What each setting is when neither the browser nor the account says. Every
 * resolver and the Settings display read it from here, so the two cannot
 * disagree about what an unset default means.
 */
export const BUILT_IN_VIEW_DEFAULTS: { readonly [K in ViewDefaultKey]: ValueOf<K> } = {
  density: 'normal',
  hideRegisterYear: false,
  widgetsCollapsed: false,
  chartCollapsed: false,
  accountOpenTarget: 'register',
};

/**
 * One account default, or `undefined` when none is set. Tolerates a missing
 * map, a malformed one and a value this client does not know (a newer
 * client's); never throws.
 */
export function readViewDefault<K extends ViewDefaultKey>(
  map: unknown,
  key: K,
): ValueOf<K> | undefined {
  if (!map || typeof map !== 'object' || Array.isArray(map)) return undefined;
  if (!Object.prototype.hasOwnProperty.call(map, key)) return undefined;

  const value: unknown = (map as Record<string, unknown>)[key];
  const allowed: readonly string[] | 'boolean' = VIEW_DEFAULT_FIELDS[key];
  if (allowed === 'boolean') {
    return typeof value === 'boolean' ? (value as ValueOf<K>) : undefined;
  }
  return typeof value === 'string' && allowed.includes(value)
    ? (value as ValueOf<K>)
    : undefined;
}

/** Every known account default in `map`, unknown keys and values dropped. */
export function readViewDefaults(map: unknown): ViewDefaults {
  const out: Record<string, unknown> = {};
  for (const key of Object.keys(VIEW_DEFAULT_FIELDS) as ViewDefaultKey[]) {
    const value = readViewDefault(map, key);
    if (value !== undefined) out[key] = value;
  }
  return out as ViewDefaults;
}
