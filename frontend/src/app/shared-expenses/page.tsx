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
import { Card } from "@/components/ui/Card";
import { EmptyState } from "@/components/ui/EmptyState";
import { Input } from "@/components/ui/Input";
import { LoadingSpinner } from "@/components/ui/LoadingSpinner";
import { useReportData } from "@/hooks/useReportData";
import { SharedGroupTable } from "@/components/shared-expenses/SharedGroupTable";
import { SharedFilters } from "@/components/shared-expenses/SharedFilters";
import { ListBottomPager } from "@/components/ui/ListBottomPager";
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
  const groups = useReportData(sharedExpensesApi.overview, []);
  const privateGroups = useReportData(sharedExpensesApi.privateGroups, []);
  const [form, setForm] = useState(false);
  const [query, setQuery] = useState("");
  const [page, setPage] = useState(1);
  const [tab, setTab] = useState<"groups" | "people" | "retainedFinance">(
    "groups",
  );
  const [filter, setFilter] = useState<"active" | "archived">("active");
  const visible = groups.data?.groups.filter(
    (g) =>
      !!g.archivedAt === (filter === "archived") &&
      g.name.toLowerCase().includes(query.toLowerCase()),
  );
  const totalPages = Math.max(1, Math.ceil((visible?.length ?? 0) / 25));
  const currentPage = Math.min(page, totalPages);
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
          options={(
            [
              "groups",
              "people",
              ...(privateGroups.data?.length
                ? ["retainedFinance" as const]
                : []),
            ] as const
          ).map((value) => ({
            value,
            label: t(value),
          }))}
        />
        <SharedError error={privateGroups.error} retry={privateGroups.reload} />
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
            <SharedFilters
              onClear={() => {
                setQuery("");
                setFilter("active");
                setPage(1);
              }}
              chips={[
                ...(query
                  ? [
                      {
                        key: "search",
                        label: query,
                        removeLabel: t("removeFilter", { filter: t("search") }),
                        remove: () => {
                          setQuery("");
                          setPage(1);
                        },
                      },
                    ]
                  : []),
                ...(filter === "archived"
                  ? [
                      {
                        key: "archive",
                        label: t("archived"),
                        removeLabel: t("removeFilter", {
                          filter: t("archived"),
                        }),
                        remove: () => {
                          setFilter("active");
                          setPage(1);
                        },
                      },
                    ]
                  : []),
              ]}
            >
              <div className="flex flex-wrap items-end gap-3">
                <div className="w-full sm:w-80">
                  <Input
                    label={t("search")}
                    value={query}
                    onChange={(e) => {
                      setQuery(e.target.value);
                      setPage(1);
                    }}
                  />
                </div>
                <SharedTabs
                  label={t("groups")}
                  value={filter}
                  onChange={(value) => {
                    setFilter(value);
                    setPage(1);
                  }}
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
            </SharedFilters>
            <SharedError error={groups.error} retry={groups.reload} />
            {groups.isLoading && !groups.data ? (
              <LoadingSpinner />
            ) : groups.data &&
              !groups.error &&
              !groups.isLoading &&
              !visible?.length ? (
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
            ) : groups.data ? (
              <>
                <SharedGroupTable
                  groups={(visible ?? []).slice((currentPage - 1) * 25, currentPage * 25)}
                  fresh={!groups.isLoading && !groups.error}
                  onOpen={(id) => router.push(`/shared-expenses/${id}`)}
                />
                <ListBottomPager
                  currentPage={currentPage}
                  totalPages={totalPages}
                  totalItems={visible?.length ?? 0}
                  pageSize={25}
                  onPageChange={setPage}
                  itemName={t("groups")}
                  totalLabel={t("pageCount", {
                    from: visible?.length ? (currentPage - 1) * 25 + 1 : 0,
                    to: Math.min(currentPage * 25, visible?.length ?? 0),
                    count: visible?.length ?? 0,
                  })}
                />
              </>
            ) : null}
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
