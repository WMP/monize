"use client";
import { usePreferencesStore } from "@/store/preferencesStore";
import { useTranslations } from "next-intl";
export function CashReportingNotice({
  balances = false,
}: {
  balances?: boolean;
}) {
  const t = useTranslations("common.reportingBasis");
  const ts = useTranslations("settings.preferences");
  const tb = useTranslations("transactions");
  const enabled = usePreferencesStore(state => state.preferences?.accrualEnabled ?? false);
  if (!enabled) return null;
  return (
    <p className="mb-4 text-sm text-gray-600 dark:text-gray-300">
      {balances
        ? `${tb("charts.balanceHistory.title")} · ${ts("reportingCash")}`
        : t("cashOnly")}
    </p>
  );
}
