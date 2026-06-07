/**
 * Deep-merge the active-locale messages onto the English base so any key that
 * has not been translated yet transparently falls back to English. Plain
 * objects are merged recursively; everything else (strings, arrays) is
 * overwritten by the override when present.
 */
export function deepMerge<T>(base: T, override: unknown): T {
  const isPlainObject = (v: unknown): v is Record<string, unknown> =>
    typeof v === 'object' && v !== null && !Array.isArray(v);

  if (!isPlainObject(base) || !isPlainObject(override)) {
    return (override ?? base) as T;
  }

  const result: Record<string, unknown> = { ...base };
  for (const key of Object.keys(override)) {
    const baseVal = (base as Record<string, unknown>)[key];
    const overrideVal = (override as Record<string, unknown>)[key];
    result[key] =
      isPlainObject(baseVal) && isPlainObject(overrideVal)
        ? deepMerge(baseVal, overrideVal)
        : overrideVal;
  }
  return result as T;
}
