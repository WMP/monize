"use client";

import { useState } from "react";
import Link from "next/link";
import dynamic from "next/dynamic";
import { useTranslations } from "next-intl";
import { Badge } from "@/components/ui/Badge";
import { Button } from "@/components/ui/Button";
import { Card } from "@/components/ui/Card";
import { Input } from "@/components/ui/Input";
import { useReportData } from "@/hooks/useReportData";
import { useNumberFormat } from "@/hooks/useNumberFormat";
import { sharedCommand, sharedExpensesApi } from "@/lib/shared-expenses";
import type {
  SharedFinanceOverview,
  SharedGroupDetail,
} from "@/types/shared-expense";
import { SharedAmount, SharedError, SharedNotice } from "./SharedPrimitives";
const SharedBooking = dynamic(
  () => import("./SharedBooking").then((m) => m.SharedBooking),
  { ssr: false },
);

export function SharedFinances({
  group,
  onEnabled,
  onOpenEntry,
}: {
  group: SharedGroupDetail;
  onEnabled?: () => void;
  onOpenEntry?: (entryId: string) => void;
}) {
  const t = useTranslations("sharedExpenses");
  const { formatNumber } = useNumberFormat();
  const finances = useReportData(
    () => sharedExpensesApi.finances(group.id),
    [group.id, group.revision],
    { requestKey: group.id },
  );
  const [accountName, setAccountName] = useState(group.name);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<unknown>(null);
  const [command] = useState(() => sharedCommand(group.revision));
  const [selected, setSelected] = useState<
    SharedFinanceOverview["entries"][number] | null
  >(null);
  const enable = async () => {
    setBusy(true);
    setError(null);
    try {
      await sharedExpensesApi.enableFinance(group.id, {
        ...command,
        accountName,
      });
      finances.reload();
      onEnabled?.();
    } catch (cause) {
      setError(cause);
    } finally {
      setBusy(false);
    }
  };
  const data = finances.dataKey === group.id ? finances.data : null;
  return (
    <div className="space-y-4">
      <Badge variant="blue">{t("privateOnly")}</Badge>
      <SharedNotice>{t("financialPrivacy")}</SharedNotice>
      <SharedError
        error={error || finances.error}
        retry={finances.error ? finances.reload : undefined}
      />
      {data && !data.integration ? (
        <Card padding="md">
          <h2 className="text-lg font-semibold">{t("enableFinance")}</h2>
          <p className="mt-2 text-sm text-gray-500 dark:text-gray-400">
            {t("financeHelp")}
          </p>
          <div className="mt-5 max-w-md space-y-3">
            <Input
              label={t("settlementAccount")}
              value={accountName}
              maxLength={120}
              onChange={(e) => setAccountName(e.target.value)}
            />
            <Button
              disabled={!accountName.trim()}
              isLoading={busy}
              onClick={enable}
            >
              {t("enableFinance")}
            </Button>
            <p className="text-xs text-gray-500 dark:text-gray-400">
              {t("managedHelp")}
            </p>
          </div>
        </Card>
      ) : (
        data?.integration && (
          <>
            <div className="flex flex-wrap items-center justify-between gap-3">
              <p>
                {t("needsReview")}{" "}
                <Badge variant={data.pendingCount ? "amber" : "gray"}>
                  {formatNumber(data.pendingCount, 0)}
                </Badge>
              </p>
              <Link
                className="text-blue-600 dark:text-blue-400 hover:underline"
                href={`/accounts/${data.integration.accountId}`}
              >
                {t("openAccount")}
              </Link>
            </div>
            <div className="space-y-3">
              {data.entries.map((row) => (
                <Card key={row.entryId} padding="sm">
                  <div className="flex flex-wrap justify-between items-center gap-3">
                    <div className="min-w-0">
                      <h3 className="font-medium break-words">{row.title}</h3>
                      <Badge variant={row.needsReview ? "amber" : "gray"}>
                        {t(
                          row.needsReview
                            ? "needsReview"
                            : row.posting
                              ? "accepted"
                              : "notBooked",
                        )}
                      </Badge>
                    </div>
                    <div className="text-right">
                      <p className="text-xs text-gray-500 dark:text-gray-400">
                        {t("settlementChange")}
                      </p>
                      <SharedAmount
                        amount={row.effect?.position ?? null}
                        currency={group.currencyCode}
                      />
                    </div>
                    <Button
                      variant="outline"
                      size="sm"
                      onClick={() =>
                        row.reviewReason === "MISSING_RATE" && onOpenEntry
                          ? onOpenEntry(row.entryId)
                          : setSelected(row)
                      }
                      disabled={
                        row.state === "DRAFT" && !row.posting && !onOpenEntry
                      }
                    >
                      {t("review")}
                    </Button>
                  </div>
                </Card>
              ))}
            </div>
          </>
        )
      )}
      {selected && (
        <SharedBooking
          group={group}
          row={selected}
          onClose={() => setSelected(null)}
          onSaved={() => {
            setSelected(null);
            finances.reload();
          }}
        />
      )}
    </div>
  );
}
