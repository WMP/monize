"use client";

import { useEffect } from "react";
import Link from "next/link";
import { usePathname } from "next/navigation";
import { useTranslations } from "next-intl";
import { useAuthStore } from "@/store/authStore";
import { useNumberFormat } from "@/hooks/useNumberFormat";
import { useReportData } from "@/hooks/useReportData";
import { sharedExpensesApi } from "@/lib/shared-expenses";
import { Button } from "@/components/ui/Button";

const FINANCIAL_PAGES = [
  "/dashboard",
  "/accounts",
  "/transactions",
  "/budgets",
  "/reports",
  "/net-worth",
];

export function SharedReviewBanner() {
  const pathname = usePathname();
  const userId = useAuthStore((state) => state.user?.id);
  const authenticated = useAuthStore((state) => state.isAuthenticated);
  const actingAs = useAuthStore((state) => state.actingAsUserId);
  if (
    !authenticated ||
    !userId ||
    actingAs ||
    !FINANCIAL_PAGES.some(
      (path) => pathname === path || pathname.startsWith(`${path}/`),
    )
  )
    return null;
  return <SharedReviewBannerContent key={`${userId}:${pathname}`} />;
}

function SharedReviewBannerContent() {
  const t = useTranslations("sharedExpenses");
  const { formatNumber } = useNumberFormat();
  const review = useReportData(sharedExpensesApi.review, []);
  useEffect(() => {
    window.addEventListener("focus", review.reload);
    return () => window.removeEventListener("focus", review.reload);
  }, [review.reload]);
  if (
    !review.error &&
    (!review.data ||
      (review.data.pendingCount === 0 &&
        review.data.unavailableGroupCount === 0))
  )
    return null;
  return (
    <aside
      aria-label={t("title")}
      aria-busy={review.isLoading}
      className="border-b border-blue-200 bg-blue-50 px-4 py-3 text-sm text-blue-950 dark:border-blue-800 dark:bg-blue-950 dark:text-blue-100"
    >
      <div className="mx-auto flex max-w-7xl flex-wrap items-center justify-between gap-3">
        <div role={review.error ? "alert" : "status"}>
          {review.error ? (
            t("reviewLoadFailed")
          ) : review.isLoading ? (
            t("reviewChecking")
          ) : (
            <>
              {review.data && review.data.pendingCount > 0 && (
                <p>
                  {t("reviewPending", {
                    count: formatNumber(review.data.pendingCount, 0),
                  })}
                </p>
              )}
              {review.data && review.data.unavailableGroupCount > 0 && (
                <p>
                  {t("reviewUnavailable", {
                    count: formatNumber(review.data.unavailableGroupCount, 0),
                  })}
                </p>
              )}
            </>
          )}
        </div>
        {review.error ? (
          <Button variant="outline" size="sm" onClick={review.reload}>
            {t("retry")}
          </Button>
        ) : (
          !review.isLoading && (
            <Link
              className="font-medium underline focus-visible:ring-2 focus-visible:ring-blue-500"
              href="/shared-expenses/review"
            >
              {t("review")}
            </Link>
          )
        )}
      </div>
    </aside>
  );
}
