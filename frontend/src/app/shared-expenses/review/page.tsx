"use client";

import Link from "next/link";
import { useTranslations } from "next-intl";
import { ProtectedRoute } from "@/components/auth/ProtectedRoute";
import { PageLayout } from "@/components/layout/PageLayout";
import { PageHeader } from "@/components/layout/PageHeader";
import { Card } from "@/components/ui/Card";
import { EmptyState } from "@/components/ui/EmptyState";
import { LoadingSpinner } from "@/components/ui/LoadingSpinner";
import { useNumberFormat } from "@/hooks/useNumberFormat";
import { useReportData } from "@/hooks/useReportData";
import { sharedExpensesApi } from "@/lib/shared-expenses";
import {
  SharedError,
  SharedNotice,
} from "@/components/shared-expenses/SharedPrimitives";

export default function SharedReviewPage() {
  const t = useTranslations("sharedExpenses");
  const { formatNumber } = useNumberFormat();
  const review = useReportData(sharedExpensesApi.review, []);
  return (
    <ProtectedRoute>
      <PageLayout>
        <main className="mx-auto max-w-6xl px-4 py-6 sm:px-6 lg:px-8 space-y-5">
          <PageHeader title={t("reviewTitle")} />
          <div className="space-y-4">
            <SharedNotice>{t("reviewLedgerBasis")}</SharedNotice>
            <SharedError error={review.error} retry={review.reload} />
            {review.isLoading ? (
              <LoadingSpinner />
            ) : (
              !review.error &&
              review.data && (
                <>
                  {review.data.groups.length === 0 && (
                    <EmptyState title={t("reviewEmpty")} />
                  )}
                  {review.data.groups.map((group) => (
                    <Card key={group.groupId} padding="md">
                      <div className="flex flex-wrap items-center justify-between gap-3">
                        <div>
                          <h2 className="font-semibold break-words">
                            {group.accountName}
                          </h2>
                          <p className="mt-1 text-sm">
                            {group.accessRevoked
                              ? t("accessRevoked")
                              : group.pendingCount > 0
                                ? t("reviewPending", {
                                    count: formatNumber(group.pendingCount, 0),
                                  })
                                : t("reviewCurrent")}
                          </p>
                        </div>
                        <Link
                          className="text-blue-600 dark:text-blue-400 hover:underline focus-visible:ring-2 focus-visible:ring-blue-500"
                          href={
                            group.accessRevoked
                              ? `/shared-expenses/private-finances/${group.groupId}`
                              : `/shared-expenses/${group.groupId}?view=myFinances`
                          }
                        >
                          {t(
                            group.accessRevoked ? "retainedFinance" : "review",
                          )}
                        </Link>
                      </div>
                    </Card>
                  ))}
                </>
              )
            )}
          </div>
        </main>
      </PageLayout>
    </ProtectedRoute>
  );
}
