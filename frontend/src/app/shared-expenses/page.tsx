"use client";

import { useState } from "react";
import dynamic from "next/dynamic";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { UsersIcon, PlusIcon } from "@heroicons/react/24/outline";
import { useTranslations } from "next-intl";
import { ProtectedRoute } from "@/components/auth/ProtectedRoute";
import { PageLayout } from "@/components/layout/PageLayout";
import { PageHeader } from "@/components/layout/PageHeader";
import { Button } from "@/components/ui/Button";
import { Card, HOVER_ROW_ON_CARD } from "@/components/ui/Card";
import { Badge } from "@/components/ui/Badge";
import { EmptyState } from "@/components/ui/EmptyState";
import { Input } from "@/components/ui/Input";
import { LoadingSpinner } from "@/components/ui/LoadingSpinner";
import { useReportData } from "@/hooks/useReportData";
import { useNumberFormat } from "@/hooks/useNumberFormat";
import { SharedPositionValue } from "@/components/shared-expenses/SharedPositionValue";
import { sharedExpensesApi } from "@/lib/shared-expenses";
import {
  SharedAmount,
  SharedError,
  SharedTabs,
} from "@/components/shared-expenses/SharedPrimitives";
const SharedGroupForm = dynamic(
  () =>
    import("@/components/shared-expenses/SharedGroupForm").then(
      (m) => m.SharedGroupForm,
    ),
  { ssr: false },
);
const SharedPeople = dynamic(() =>
  import("@/components/shared-expenses/SharedPeople").then(
    (m) => m.SharedPeople,
  ),
);

const SharedPrivateFinances = dynamic(() =>
  import("@/components/shared-expenses/SharedPrivateFinances").then(
    (m) => m.SharedPrivateFinances,
  ),
);

export default function SharedExpensesPage() {
  return (
    <ProtectedRoute>
      <GroupsContent />
    </ProtectedRoute>
  );
}
function GroupsContent() {
  const t = useTranslations("sharedExpenses");
  const router = useRouter();
  const { formatNumber } = useNumberFormat();
  const groups = useReportData(sharedExpensesApi.overview, []);
  const [form, setForm] = useState(false);
  const [query, setQuery] = useState("");
  const [tab, setTab] = useState<"groups" | "people" | "retainedFinance">(
    "groups",
  );
  const [filter, setFilter] = useState<"active" | "archived">("active");
  const visible = groups.data?.groups.filter(
    (g) =>
      !!g.archivedAt === (filter === "archived") &&
      g.name.toLowerCase().includes(query.toLowerCase()),
  );
  return (
    <PageLayout>
      <main className="mx-auto max-w-6xl px-4 py-6 sm:px-6 lg:px-8 space-y-5">
        <PageHeader
          title={t("title")}
          subtitle={t("subtitle")}
          actions={
            <Button onClick={() => setForm(true)}>
              <PlusIcon className="mr-2 h-5 w-5" />
              {t("newGroup")}
            </Button>
          }
        />
        <SharedTabs
          label={t("title")}
          value={tab}
          onChange={setTab}
          options={(["groups", "people", "retainedFinance"] as const).map(
            (value) => ({
              value,
              label: t(value),
            }),
          )}
        />
        {tab === "retainedFinance" ? (
          <SharedPrivateFinances />
        ) : tab === "people" ? (
          <SharedPeople />
        ) : (
          <>
            {groups.data && groups.data.totals.length > 0 && (
              <section
                aria-label={t("totalsByCurrency")}
                className="grid gap-3 sm:grid-cols-2"
              >
                {groups.data.totals.map((total) => (
                  <Card
                    key={total.currencyCode}
                    padding="md"
                    className="space-y-2"
                  >
                    <h2 className="font-semibold">
                      {t("totalsByCurrency")} · {total.currencyCode}
                    </h2>
                    <dl className="grid grid-cols-2 gap-3">
                      <div>
                        <dt className="text-sm">{t("overallReceivable")}</dt>
                        <dd>
                          <SharedAmount
                            amount={total.receivable}
                            currency={total.currencyCode}
                          />
                        </dd>
                      </div>
                      <div>
                        <dt className="text-sm">{t("overallPayable")}</dt>
                        <dd>
                          <SharedAmount
                            amount={total.payable}
                            currency={total.currencyCode}
                          />
                        </dd>
                      </div>
                    </dl>
                    {total.unresolvedGroupIds.length > 0 && (
                      <>
                        <p className="text-sm">{t("summaryUnknown")}</p>
                        <ul>
                          {total.unresolvedGroupIds.map((id) => (
                            <li key={id}>
                              <Link
                                href={`/shared-expenses/${id}`}
                                className="text-blue-600 dark:text-blue-400 hover:underline"
                              >
                                {
                                  groups.data?.groups.find((g) => g.id === id)
                                    ?.name
                                }
                              </Link>
                            </li>
                          ))}
                        </ul>
                      </>
                    )}
                  </Card>
                ))}
              </section>
            )}
            <div className="flex flex-wrap items-end gap-3">
              <div className="w-full sm:w-80">
                <Input
                  label={t("search")}
                  value={query}
                  onChange={(e) => setQuery(e.target.value)}
                />
              </div>
              <SharedTabs
                label={t("groups")}
                value={filter}
                onChange={setFilter}
                options={(["active", "archived"] as const).map((value) => ({
                  value,
                  label: t(value),
                }))}
              />
              <Button
                variant="ghost"
                className="sm:ml-auto"
                onClick={groups.reload}
              >
                {t("refresh")}
              </Button>
            </div>
            <SharedError error={groups.error} retry={groups.reload} />
            {groups.isLoading && !groups.data ? (
              <LoadingSpinner />
            ) : groups.data && !visible?.length ? (
              <Card>
                <EmptyState
                  icon={<UsersIcon />}
                  title={t("emptyGroups")}
                  description={t("emptyGroupsHelp")}
                  action={
                    <Button onClick={() => setForm(true)}>
                      {t("newGroup")}
                    </Button>
                  }
                />
              </Card>
            ) : (
              <div className="grid gap-4 md:grid-cols-2 lg:grid-cols-3">
                {visible?.map((group) => (
                  <Card
                    key={group.id}
                    as={Link}
                    href={`/shared-expenses/${group.id}`}
                    padding="md"
                    className={`${HOVER_ROW_ON_CARD} block focus-visible:ring-2 focus-visible:ring-blue-500`}
                  >
                    <div className="flex items-start justify-between gap-3">
                      <h2 className="text-lg font-semibold break-words min-w-0">
                        {group.name}
                      </h2>
                      <Badge>{group.currencyCode}</Badge>
                    </div>
                    <p className="mt-2 text-sm text-gray-500 dark:text-gray-400">
                      {t("participants")} ·{" "}
                      {formatNumber(group.participantCount, 0)}
                    </p>
                    <div className="mt-6 border-t border-gray-100 dark:border-gray-700 pt-4">
                      <SharedPositionValue
                        personal
                        prominent
                        amount={group.myPosition?.balance ?? null}
                        currency={group.currencyCode}
                      />
                      {!group.settlementReady && (
                        <p className="text-sm mt-2">{t("missingRate")}</p>
                      )}
                    </div>
                  </Card>
                ))}
              </div>
            )}
          </>
        )}
        {form && (
          <SharedGroupForm
            onClose={() => setForm(false)}
            onCreated={(id) => router.push(`/shared-expenses/${id}`)}
          />
        )}
      </main>
    </PageLayout>
  );
}
