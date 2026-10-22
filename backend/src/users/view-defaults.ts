/**
 * The account-level view defaults a user can set in Settings -> Preferences,
 * and the values each one accepts. A string array lists an enum's values; the
 * word "boolean" marks a flag.
 *
 * The browser keeps its own choice for every setting except
 * `accountOpenTarget`, and these apply only where it has saved nothing.
 *
 * The same map is declared again in `frontend/src/lib/view-defaults.ts`
 * (`VIEW_DEFAULT_FIELDS`); `view-defaults.contract.spec.ts` pins the two
 * equal. The validator refuses any other key or value on write.
 */
export const VIEW_DEFAULT_FIELDS = {
  density: ["normal", "compact", "dense"],
  hideRegisterYear: "boolean",
  widgetsCollapsed: "boolean",
  chartCollapsed: "boolean",
  accountOpenTarget: ["register", "dashboard"],
} as const;

export type ViewDefaultKey = keyof typeof VIEW_DEFAULT_FIELDS;

export function isViewDefaultKey(key: string): key is ViewDefaultKey {
  return Object.prototype.hasOwnProperty.call(VIEW_DEFAULT_FIELDS, key);
}
