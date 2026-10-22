import { addDaysYMD } from "../common/date-utils";
import { SYNC_OVERLAP_DAYS } from "./bank-sync.constants";
import type { BankSyncAccount } from "./entities/bank-sync-account.entity";

export function syncWindow(
  link: Pick<BankSyncAccount, "syncFromDate" | "lastSuccessAt">,
  today: string,
): { dateFrom: string; dateTo: string } {
  let dateFrom = link.syncFromDate ?? today;
  if (link.lastSuccessAt) {
    const overlapStart = addDaysYMD(
      link.lastSuccessAt.toISOString().slice(0, 10),
      -SYNC_OVERLAP_DAYS,
    );
    if (overlapStart > dateFrom) dateFrom = overlapStart;
  }
  if (dateFrom > today) dateFrom = today;
  return { dateFrom, dateTo: today };
}
