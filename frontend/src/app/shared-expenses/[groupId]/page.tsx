"use client";

import { Suspense, useState } from "react";
import dynamic from "next/dynamic";
import Link from "next/link";
import { useParams, useRouter, useSearchParams } from "next/navigation";
import {
  ChevronLeftIcon,
  PlusIcon,
  UsersIcon,
} from "@heroicons/react/24/outline";
import { useTranslations } from "next-intl";
import { ProtectedRoute } from "@/components/auth/ProtectedRoute";
import { PageLayout } from "@/components/layout/PageLayout";
import { PageHeader } from "@/components/layout/PageHeader";
import { ConfirmDialog } from "@/components/ui/ConfirmDialog";
import { Button } from "@/components/ui/Button";
import { Card, HOVER_ROW_ON_CARD } from "@/components/ui/Card";
import { Badge } from "@/components/ui/Badge";
import { EmptyState } from "@/components/ui/EmptyState";
import { EntitySwitcher } from "@/components/ui/EntitySwitcher";
import { Input } from "@/components/ui/Input";
import { DateInput } from "@/components/ui/DateInput";
import { Select } from "@/components/ui/Select";
import { LoadingSpinner } from "@/components/ui/LoadingSpinner";
import { useReportData } from "@/hooks/useReportData";
import { useDateFormat } from "@/hooks/useDateFormat";
import { useNumberFormat } from "@/hooks/useNumberFormat";
import { sharedExpensesApi } from "@/lib/shared-expenses";
import { exportCsvSections } from "@/lib/csv-export";
import type {
  SharedEntry,
  SharedEntryType,
  SharedSuggestion,
} from "@/types/shared-expense";
import {
  SharedAmount,
  SharedError,
  SharedNotice,
  SharedTabs,
} from "@/components/shared-expenses/SharedPrimitives";
const SharedEntryEditor = dynamic(
  () =>
    import("@/components/shared-expenses/SharedEntryEditor").then(
      (m) => m.SharedEntryEditor,
    ),
  { ssr: false },
);
const SharedEntryDetail = dynamic(
  () =>
    import("@/components/shared-expenses/SharedEntryDetail").then(
      (m) => m.SharedEntryDetail,
    ),
  { ssr: false },
);
const SharedBalances = dynamic(() =>
  import("@/components/shared-expenses/SharedBalances").then(
    (m) => m.SharedBalances,
  ),
);
const SharedDocuments = dynamic(
  () =>
    import("@/components/shared-expenses/SharedDocuments").then(
      (m) => m.SharedDocuments,
    ),
  { ssr: false },
);
const SharedSettings = dynamic(() =>
  import("@/components/shared-expenses/SharedSettings").then(
    (m) => m.SharedSettings,
  ),
);
const SharedFinances = dynamic(() =>
  import("@/components/shared-expenses/SharedFinances").then(
    (m) => m.SharedFinances,
  ),
);
const SharedActivity = dynamic(() =>
  import("@/components/shared-expenses/SharedActivity").then(
    (m) => m.SharedActivity,
  ),
);
import { SharedGroupSummary } from "@/components/shared-expenses/SharedGroupSummary";
import { SharedEntryContext } from "@/components/shared-expenses/SharedEntryContext";
import type { SharedDocument } from "@/lib/shared-documents";

const TABS = [
  "expenses",
  "balances",
  "files",
  "activity",
  "myFinances",
  "settings",
] as const;

export default function SharedGroupPage() {
  const { groupId } = useParams<{ groupId: string }>();
  return (
    <ProtectedRoute>
      <Suspense fallback={<LoadingSpinner />}>
        <GroupContent key={groupId} groupId={groupId} />
      </Suspense>
    </ProtectedRoute>
  );
}
function GroupContent({ groupId }: { groupId: string }) {
  const searchParams = useSearchParams();
  const t = useTranslations("sharedExpenses");
  const router = useRouter();
  const { formatDate } = useDateFormat();
  const { formatCurrency } = useNumberFormat();
  const [pendingFiles, setPendingFiles] = useState(false);
  const [nextTab, setNextTab] = useState<(typeof TABS)[number] | null>(null);
  const [tab, setTab] = useState<(typeof TABS)[number]>(() =>
    searchParams.get("view") === "myFinances" ? "myFinances" : "expenses",
  );
  const [searchDraft, setSearchDraft] = useState("");
  const [search, setSearch] = useState("");
  const [type, setType] = useState("");
  const [offset, setOffset] = useState(0);
  const [filters, setFilters] = useState({
    participantId: "",
    startDate: "",
    endDate: "",
  });
  const key = JSON.stringify({ groupId, offset, search, type, filters });
  const data = useReportData(
    () =>
      sharedExpensesApi.group(groupId, offset, {
        search: search || undefined,
        type: type || undefined,
        participantId: filters.participantId || undefined,
        startDate: filters.startDate || undefined,
        endDate: filters.endDate || undefined,
      }),
    [key],
    { requestKey: key },
  );
  const groups = useReportData(sharedExpensesApi.groups, []);
  const group = data.data?.id === groupId ? data.data : null;
  const fresh = data.dataKey === key && !data.error && !data.isLoading;
  const [detail, setDetail] = useState<SharedEntry | null>(null);
  const [entryLoading, setEntryLoading] = useState(false);
  const [entryError, setEntryError] = useState<unknown>(null);
  const openUnresolved = async (id: string) => {
    if (entryLoading) return;
    setEntryLoading(true);
    setEntryError(null);
    try {
      setDetail(await sharedExpensesApi.entry(groupId, id));
    } catch (cause) {
      setEntryError(cause);
    } finally {
      setEntryLoading(false);
    }
  };
  const [form, setForm] = useState<{
    kind: SharedEntryType;
    entry?: SharedEntry;
    suggestion?: SharedSuggestion;
    refundSource?: SharedEntry;
    sourceDocument?: SharedDocument;
  } | null>(null);
  const [exporting, setExporting] = useState(false);
  const [exportError, setExportError] = useState<unknown>(null);
  const changed = () => {
    data.reload();
    groups.reload();
  };
  const download = async () => {
    setExporting(true);
    setExportError(null);
    try {
      const result = await sharedExpensesApi.export(groupId);
      exportCsvSections(result.group.name, [
        {
          title: result.group.name,
          headers: [
            t("entryTitle"),
            t("date"),
            t("amount"),
            t("currency"),
            t("review"),
            t("note"),
            t("entryType"),
            t("groupAmount"),
            t("groupCurrency"),
            t("fxRate"),
            t("fxSource"),
            t("fxRateDate"),
            t("revision"),
            t("from"),
            t("to"),
          ],
          rows: result.entries.map((e) => [
            e.title,
            e.date,
            e.originalAmount,
            e.currencyCode,
            t(e.state),
            e.note,
            t(e.type),
            e.groupAmount,
            result.group.currencyCode,
            e.fxRate,
            e.fxSource ? t(e.fxSource) : "",
            e.fxRateDate,
            e.revision,
            result.participants.find((p) => p.id === e.fromParticipantId)?.name,
            result.participants.find((p) => p.id === e.toParticipantId)?.name,
          ]),
        },
        {
          title: t("exportAllocations"),
          headers: [
            t("entryTitle"),
            t("participants"),
            t("review"),
            t("amount"),
            t("currency"),
          ],
          rows: result.entries.flatMap((e) =>
            e.allocations.map((a) => [
              e.title,
              result.participants.find((p) => p.id === a.participantId)?.name,
              t(a.kind === "SHARE" ? "cost" : "paid"),
              a.originalAmount,
              e.currencyCode,
            ]),
          ),
        },
        {
          title: t("positions"),
          headers: [t("participants"), t("yourBalance"), t("currency")],
          rows: result.balances.positions.map((p) => [
            result.participants.find((person) => person.id === p.participantId)
              ?.name,
            p.balance,
            result.group.currencyCode,
          ]),
        },
      ]);
    } catch (cause) {
      setExportError(cause);
    } finally {
      setExporting(false);
    }
  };
  const myPosition = group?.balances.positions.find(
    (p) => p.participantId === group.myParticipantId,
  );
  const writable = group && !group.archivedAt && group.role !== "VIEWER";
  return (
    <PageLayout>
      <main className="mx-auto max-w-6xl px-4 py-6 sm:px-6 lg:px-8 space-y-5">
        <Link
          href="/shared-expenses"
          className="inline-flex items-center gap-1 text-sm text-gray-500 hover:text-gray-700 dark:text-gray-400 dark:hover:text-gray-200 focus-visible:ring-2 focus-visible:ring-blue-500"
        >
          <ChevronLeftIcon className="h-4 w-4" />
          {t("back")}
        </Link>
        <SharedError error={data.error} retry={data.reload} />
        <SharedError error={exportError || entryError} />
        {!group && data.isLoading && <LoadingSpinner />}
        {group && (
          <>
            <PageHeader
              title={group.name}
              subtitle={group.description ?? undefined}
              titleAdornment={
                <EntitySwitcher
                  currentId={group.id}
                  items={(groups.data ?? []).map((g) => ({
                    id: g.id,
                    primary: g.name,
                  }))}
                  onSelect={(id) => router.push(`/shared-expenses/${id}`)}
                  triggerLabel={t("groups")}
                  filterPlaceholder={t("search")}
                  noMatchesLabel={t("emptyGroups")}
                />
              }
              actions={
                <>
                  {writable && (
                    <Button
                      disabled={!fresh}
                      onClick={() => setForm({ kind: "EXPENSE" })}
                    >
                      <PlusIcon className="mr-2 h-5 w-5" />
                      {t("addExpense")}
                    </Button>
                  )}
                  <Button variant="outline" onClick={changed}>
                    {t("refresh")}
                  </Button>
                </>
              }
            />
            {group.isDetachedCopy && (
              <SharedNotice>{t("detachedCopyHelp")}</SharedNotice>
            )}
            {group.archivedAt && (
              <SharedNotice>{t("archiveHelp")}</SharedNotice>
            )}
            {group.role === "VIEWER" && (
              <SharedNotice>{t("readOnly")}</SharedNotice>
            )}
            <SharedGroupSummary group={group} />
            {!group.balances.settlementReady && (
              <div className="space-y-2">
                <SharedNotice>{t("missingRate")}</SharedNotice>
                {myPosition && (
                  <p className="text-sm">
                    {t("partialBalance", {
                      amount: formatCurrency(
                        Number(myPosition.knownBalance),
                        group.currencyCode,
                      ),
                    })}
                  </p>
                )}
                <ul className="space-y-1">
                  {group.unresolvedEntries?.map((entry) => (
                    <li key={entry.id}>
                      <Button
                        variant="ghost"
                        disabled={entryLoading}
                        onClick={() => openUnresolved(entry.id)}
                      >
                        {entry.title} · {entry.currencyCode} →{" "}
                        {group.currencyCode} · {formatDate(entry.date)}
                      </Button>
                    </li>
                  ))}
                </ul>
              </div>
            )}
            <SharedTabs
              value={tab}
              onChange={(value) => {
                if (pendingFiles && value !== tab) setNextTab(value);
                else setTab(value);
              }}
              label={t("title")}
              options={TABS.map((value) => ({ value, label: t(value) }))}
            />
            {tab === "expenses" && (
              <>
                <div className="flex flex-wrap items-end gap-3">
                  <form
                    className="flex flex-wrap gap-2 items-end w-full sm:w-auto"
                    onSubmit={(e) => {
                      e.preventDefault();
                      setSearch(searchDraft);
                      setOffset(0);
                    }}
                  >
                    <div className="w-full sm:w-64">
                      <Input
                        label={t("searchEntries")}
                        value={searchDraft}
                        maxLength={200}
                        onChange={(e) => setSearchDraft(e.target.value)}
                      />
                    </div>
                    <Button type="submit" variant="outline">
                      {t("search")}
                    </Button>
                  </form>
                  <div className="w-full sm:w-44">
                    <Select
                      label={t("entryType")}
                      value={type}
                      options={[
                        { value: "", label: t("all") },
                        ...(
                          ["EXPENSE", "REFUND", "INCOME", "REPAYMENT"] as const
                        ).map((value) => ({ value, label: t(value) })),
                      ]}
                      onChange={(e) => {
                        setType(e.target.value);
                        setOffset(0);
                      }}
                    />
                  </div>
                  <Button
                    variant="ghost"
                    className="sm:ml-auto"
                    isLoading={exporting}
                    onClick={download}
                  >
                    {t("export")}
                  </Button>
                </div>
                <details className="text-sm">
                  <summary className="cursor-pointer min-h-10">
                    {t("filterEntries")}
                  </summary>
                  <div className="grid gap-3 sm:grid-cols-3 mt-2">
                    <Select
                      label={t("participants")}
                      value={filters.participantId}
                      options={[
                        { value: "", label: t("all") },
                        ...group.participants.map((p) => ({
                          value: p.id,
                          label: p.name,
                        })),
                      ]}
                      onChange={(e) => {
                        setFilters({
                          ...filters,
                          participantId: e.target.value,
                        });
                        setOffset(0);
                      }}
                    />
                    <DateInput
                      label={t("startDate")}
                      value={filters.startDate}
                      onDateChange={(startDate) => {
                        setFilters({ ...filters, startDate });
                        setOffset(0);
                      }}
                    />
                    <DateInput
                      label={t("endDate")}
                      value={filters.endDate}
                      onDateChange={(endDate) => {
                        setFilters({ ...filters, endDate });
                        setOffset(0);
                      }}
                    />
                  </div>
                </details>
                {fresh && group.entries.length === 0 && (
                  <Card>
                    <EmptyState
                      icon={<UsersIcon />}
                      title={t("emptyEntries")}
                      description={t("emptyEntriesHelp")}
                    />
                  </Card>
                )}
                <Card className="overflow-hidden">
                  <ul className="divide-y divide-gray-100 dark:divide-gray-700">
                    {group.entries.map((entry) => (
                      <li key={entry.id}>
                        <button
                          type="button"
                          disabled={!fresh}
                          onClick={() => setDetail(entry)}
                          className={`w-full p-4 text-left focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-blue-500 ${HOVER_ROW_ON_CARD}`}
                        >
                          <div className="flex flex-wrap justify-between gap-3">
                            <div className="min-w-0 flex-1">
                              <p className="font-medium break-words">
                                {entry.title}
                              </p>
                              <p className="mt-1 text-xs text-gray-500 dark:text-gray-400">
                                {formatDate(entry.date)}
                              </p>
                              <SharedEntryContext entry={entry} group={group} />
                            </div>
                            <div className="text-right">
                              <SharedAmount
                                className="font-semibold"
                                amount={entry.originalAmount}
                                currency={entry.currencyCode}
                              />
                              <p className="mt-1">
                                <Badge
                                  variant={
                                    entry.state === "DRAFT" ? "amber" : "gray"
                                  }
                                >
                                  {t(
                                    entry.state === "POSTED"
                                      ? entry.type
                                      : entry.state,
                                  )}
                                </Badge>
                              </p>
                            </div>
                          </div>
                        </button>
                      </li>
                    ))}
                  </ul>
                </Card>
                <div className="flex flex-wrap items-center gap-3">
                  <p className="text-sm text-gray-500 dark:text-gray-400">
                    {t("pageCount", {
                      from: group.entries.length ? offset + 1 : 0,
                      to: Math.min(offset + 100, group.entryCount),
                      count: group.entryCount,
                    })}
                  </p>
                  <div className="flex flex-wrap gap-2 sm:ml-auto">
                    <Button
                      variant="outline"
                      disabled={!fresh || offset === 0}
                      onClick={() => setOffset(Math.max(0, offset - 100))}
                    >
                      {t("previousPage")}
                    </Button>
                    <Button
                      variant="outline"
                      disabled={!fresh || group.nextOffset === null}
                      onClick={() => setOffset(group.nextOffset!)}
                    >
                      {t("loadMore")}
                    </Button>
                  </div>
                </div>
                {writable && (
                  <Button
                    variant="ghost"
                    disabled={!fresh}
                    onClick={() => setForm({ kind: "INCOME" })}
                  >
                    {t("addIncome")}
                  </Button>
                )}
              </>
            )}
            {tab === "balances" && (
              <SharedBalances
                group={group}
                onRepay={(suggestion) =>
                  setForm({ kind: "REPAYMENT", suggestion })
                }
              />
            )}
            {tab === "files" && (
              <SharedDocuments
                key={group.id}
                onPendingChange={setPendingFiles}
                group={group}
                onOpenEntry={openUnresolved}
                onCreateEntry={(sourceDocument) =>
                  setForm({ kind: "EXPENSE", sourceDocument })
                }
              />
            )}
            {tab === "myFinances" && (
              <SharedFinances
                key={group.id}
                group={group}
                onOpenEntry={openUnresolved}
              />
            )}
            {tab === "settings" && (
              <SharedSettings
                key={group.id}
                group={group}
                onChanged={changed}
              />
            )}
            {tab === "activity" && (
              <SharedActivity key={group.revision} group={group} />
            )}
            {detail && (
              <SharedEntryDetail
                key={detail.id}
                entry={detail}
                group={group}
                onClose={() => setDetail(null)}
                onChanged={changed}
                onEdit={() => {
                  setForm({ kind: detail.type, entry: detail });
                  setDetail(null);
                }}
                onRefund={() => {
                  setForm({ kind: "REFUND", refundSource: detail });
                  setDetail(null);
                }}
              />
            )}
            {form && (
              <SharedEntryEditor
                key={form.entry?.id ?? `${form.kind}:new`}
                group={group}
                {...form}
                onClose={() => setForm(null)}
                onSaved={changed}
              />
            )}
          </>
        )}
        <ConfirmDialog
          isOpen={nextTab !== null}
          title={t("discardTitle")}
          message={t("pendingFilesLeave")}
          confirmLabel={t("discard")}
          onCancel={() => setNextTab(null)}
          onConfirm={() => {
            if (nextTab) setTab(nextTab);
            setNextTab(null);
            setPendingFiles(false);
          }}
        />
      </main>
    </PageLayout>
  );
}
