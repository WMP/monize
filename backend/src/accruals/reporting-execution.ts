import type { EntityManager } from "typeorm";
import type { ReportingBasis } from "./reporting-basis";

/** Interactive recognition reads can cost more to JIT-compile than to execute.
 * Change only the existing scoped transaction and restore successful callers.
 * Failed SQL aborts the transaction: rollback restores LOCAL settings without
 * issuing a restoration query that would mask the original database failure.
 */
export async function executeReportingRead<T>(
  manager: EntityManager,
  basis: ReportingBasis,
  read: () => Promise<T>,
): Promise<T> {
  if (basis === "cash") return read();
  const [setting] = await manager.query(
    "SELECT current_setting('jit') AS jit, (SELECT setting FROM pg_settings WHERE name='statement_timeout') AS \"timeoutMs\"",
  );
  const previousTimeout = Number(setting.timeoutMs ?? 0);
  const timeout =
    previousTimeout > 0 && previousTimeout < 8000 ? previousTimeout : 8000;
  const previousJit = setting.jit ?? "off";
  const jit = previousJit === "on" ? "off" : previousJit;
  if (jit === previousJit && timeout === previousTimeout) return read();
  await manager.query(
    "SELECT set_config('jit',$1,true),set_config('statement_timeout',$2,true)",
    [jit, `${timeout}ms`],
  );
  let succeeded = false;
  try {
    const result = await read();
    succeeded = true;
    return result;
  } finally {
    if (succeeded)
      await manager.query(
        "SELECT set_config('jit',$1,true),set_config('statement_timeout',$2,true)",
        [previousJit, `${previousTimeout}ms`],
      );
  }
}
