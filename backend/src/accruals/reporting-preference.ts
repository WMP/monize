import { getRequestContext } from "../common/request-context";
import type { UserPreference } from "../users/entities/user-preference.entity";
const preferenceKey = Symbol("reportingPreference");

/** Share one immutable preference snapshot among sibling reads in this identity scope, never across requests. */
export function reportingPreference(
  userId: string,
  load: () => Promise<UserPreference | null>,
): Promise<UserPreference | null> {
  const context = getRequestContext();
  if (!context) return load();
  context.memo ??= new Map();
  let values = context.memo.get(preferenceKey) as
    Map<string, Promise<UserPreference | null>> | undefined;
  if (!values) {
    values = new Map();
    context.memo.set(preferenceKey, values);
  }
  const cached = values.get(userId);
  if (cached) return cached;
  const entries = values;
  const pending = Promise.resolve()
    .then(load)
    .then((value) => (value ? { ...value } : null))
    .catch((error) => {
      if (entries.get(userId) === pending) entries.delete(userId);
      throw error;
    });
  entries.set(userId, pending);
  return pending;
}
