"use client";

import { useState } from "react";
import { useParams, useRouter } from "next/navigation";
import { useTranslations } from "next-intl";
import { ProtectedRoute } from "@/components/auth/ProtectedRoute";
import { PageLayout } from "@/components/layout/PageLayout";
import { PageHeader } from "@/components/layout/PageHeader";
import { Button } from "@/components/ui/Button";
import { Card } from "@/components/ui/Card";
import { Select } from "@/components/ui/Select";
import { Input } from "@/components/ui/Input";
import { LoadingSpinner } from "@/components/ui/LoadingSpinner";
import { useAuthStore } from "@/store/authStore";
import { useReportData } from "@/hooks/useReportData";
import { transactionsApi } from "@/lib/transactions";
import { sharedExpensesApi } from "@/lib/shared-expenses";
import { canShareBankTransaction } from "@/lib/shared-bank-eligibility";
import { afterModalHistoryPop } from "@/lib/after-modal-history-pop";
import type {
  SharedEntry,
  SharedFinanceOverview,
  SharedGroupDetail,
} from "@/types/shared-expense";
import type { Transaction } from "@/types/transaction";
import {
  SharedAmount,
  SharedError,
  SharedNotice,
} from "@/components/shared-expenses/SharedPrimitives";
import { SharedGroupForm } from "@/components/shared-expenses/SharedGroupForm";
import { SharedEntryEditor } from "@/components/shared-expenses/SharedEntryEditor";
import { SharedBooking } from "@/components/shared-expenses/SharedBooking";
import { SharedFinances } from "@/components/shared-expenses/SharedFinances";

export default function ShareBankPage() {
  return (
    <ProtectedRoute>
      <BankContent />
    </ProtectedRoute>
  );
}
function BankContent() {
  const t = useTranslations("sharedExpenses");
  const { transactionId } = useParams<{ transactionId: string }>();
  const userId = useAuthStore((s) => s.user?.id);
  const actingAs = useAuthStore((s) => s.actingAsUserId);
  const source = useReportData(
    () => transactionsApi.getById(transactionId),
    [transactionId],
    { requestKey: transactionId },
  );
  const groups = useReportData(sharedExpensesApi.groups, []);
  const [groupId, setGroupId] = useState("");
  const [createGroup, setCreateGroup] = useState(false);
  const [error, setError] = useState<unknown>(null);
  const group = useReportData(
    () => (groupId ? sharedExpensesApi.group(groupId) : Promise.resolve(null)),
    [groupId],
    { requestKey: groupId },
  );
  const bank =
    !source.isLoading && !source.error && source.dataKey === transactionId
      ? source.data
      : null;
  const selected =
    !group.isLoading && !group.error && group.dataKey === groupId
      ? group.data
      : null;
  return (
    <PageLayout>
      <main className="mx-auto max-w-6xl px-4 py-6 sm:px-6 lg:px-8 space-y-5">
        <PageHeader
          title={t("splitWithPeople")}
          subtitle={t("bankStartHelp")}
        />
        <SharedError
          error={error || source.error || groups.error || group.error}
          retry={() => {
            source.reload();
            groups.reload();
            group.reload();
          }}
        />
        {(source.isLoading || groups.isLoading) && <LoadingSpinner />}
        {bank && !canShareBankTransaction(bank, userId, actingAs) ? (
          <SharedNotice>{t("bankNotEligible")}</SharedNotice>
        ) : (
          bank && (
            <>
              <Card padding="md">
                <p className="font-medium break-words">
                  {bank.payee?.name ||
                    bank.payeeName ||
                    bank.description ||
                    t("bankTransaction")}
                </p>
                <SharedAmount
                  amount={String(bank.amount)}
                  currency={bank.currencyCode}
                  relativeTo={selected?.currencyCode}
                />
                <p className="mt-2 text-sm">{t("bankPrivacyHelp")}</p>
              </Card>
              <div className="flex flex-wrap items-end gap-3">
                <Select
                  label={t("group")}
                  value={groupId}
                  disabled={groups.isLoading || !!groups.error}
                  options={[
                    { value: "", label: t("choose") },
                    ...(groups.data ?? [])
                      .filter((g) => !g.archivedAt && g.role !== "VIEWER")
                      .map((g) => ({ value: g.id, label: g.name })),
                  ]}
                  onChange={(event) => setGroupId(event.target.value)}
                />
                <Button variant="outline" onClick={() => setCreateGroup(true)}>
                  {t("newGroup")}
                </Button>
              </div>
              {group.isLoading && groupId && <LoadingSpinner />}
              {selected && (
                <BankGroup key={selected.id} group={selected} bank={bank} />
              )}
            </>
          )
        )}
        {createGroup && (
          <SharedGroupForm
            onClose={() => setCreateGroup(false)}
            onCreated={async (id) => {
              setCreateGroup(false);
              setGroupId(id);
              groups.reload();
              try {
                group.adoptAs(await sharedExpensesApi.group(id), id);
              } catch (cause) {
                setError(cause);
              }
            }}
          />
        )}
      </main>
    </PageLayout>
  );
}
function BankGroup({
  group,
  bank,
}: {
  group: SharedGroupDetail;
  bank: Transaction;
}) {
  const t = useTranslations("sharedExpenses");
  const router = useRouter();
  const [create, setCreate] = useState(false);
  const [search, setSearch] = useState("");
  const [matching, setMatching] = useState(false);
  const [offset, setOffset] = useState(0);
  const [selected, setSelected] = useState<
    SharedFinanceOverview["entries"][number] | null
  >(null);
  const resultKey = JSON.stringify([group.id, offset, search, matching]);
  const result = useReportData(
    () =>
      matching
        ? sharedExpensesApi.group(group.id, offset, { search })
        : Promise.resolve(null),
    [group.id, offset, search, matching],
    { requestKey: resultKey },
  );
  const finances = useReportData(
    () =>
      matching ? sharedExpensesApi.finances(group.id) : Promise.resolve(null),
    [group.id, matching],
    { requestKey: `${group.id}:${matching}` },
  );
  const matchReady =
    matching &&
    !result.isLoading &&
    !result.error &&
    !finances.isLoading &&
    !finances.error &&
    result.dataKey === resultKey &&
    finances.dataKey === `${group.id}:${matching}`;
  const initialFinance = {
    bankTransactionId: bank.id,
    categoryId: bank.categoryId ?? undefined,
    payeeId: bank.payeeId ?? undefined,
  };
  const done = () => {
    setCreate(false);
    setSelected(null);
    afterModalHistoryPop(() => router.push(`/shared-expenses/${group.id}`));
  };
  const choose = (entry: SharedEntry) =>
    setSelected({
      entryId: entry.id,
      title: entry.title,
      date: entry.date,
      type: entry.type,
      state: entry.state,
      revision: entry.revision,
      effect: entry.ownEffect ?? null,
      needsReview: true,
      posting:
        finances.data?.entries.find((row) => row.entryId === entry.id)
          ?.posting ?? null,
    });
  return (
    <div className="space-y-4">
      <Button onClick={() => setCreate(true)} disabled={!group.myParticipantId}>
        {t("createSharedExpense")}
      </Button>
      <details
        onToggle={(event) => setMatching(event.currentTarget.open)}
        className="space-y-4"
      >
        <summary className="min-h-11 cursor-pointer text-sm font-medium">
          {t("matchExistingExpense")}
        </summary>
        <p className="text-sm">{t("matchHelp")}</p>
        <Input
          label={t("search")}
          value={search}
          onChange={(event) => {
            setSearch(event.target.value);
            setOffset(0);
          }}
        />
        <SharedError
          error={result.error || finances.error}
          retry={() => {
            result.reload();
            finances.reload();
          }}
        />
        {matchReady && finances.data && !finances.data.integration && (
          <SharedFinances group={group} onEnabled={finances.reload} />
        )}
        {(result.data?.entries ?? [])
          .filter((entry) => entry.state === "POSTED")
          .map((entry) => (
            <Card padding="sm" key={entry.id}>
              <div className="flex flex-wrap items-center justify-between gap-3">
                <span className="break-words">{entry.title}</span>
                <SharedAmount
                  amount={entry.originalAmount}
                  currency={entry.currencyCode}
                  relativeTo={group.currencyCode}
                />
                <Button
                  variant="outline"
                  disabled={
                    !matchReady ||
                    !finances.data?.integration ||
                    !entry.ownEffect ||
                    !!finances.data.entries.find(
                      (row) => row.entryId === entry.id,
                    )?.posting
                  }
                  onClick={() => choose(entry)}
                >
                  {t("matchThisExpense")}
                </Button>
              </div>
            </Card>
          ))}
        <div className="flex gap-3">
          {offset > 0 && (
            <Button
              variant="outline"
              onClick={() => setOffset(Math.max(0, offset - 100))}
            >
              {t("previous")}
            </Button>
          )}
          {result.data?.nextOffset != null && (
            <Button
              variant="outline"
              onClick={() => setOffset(result.data!.nextOffset!)}
            >
              {t("next")}
            </Button>
          )}
        </div>
      </details>
      {create && (
        <SharedEntryEditor
          group={group}
          kind={Number(bank.amount) < 0 ? "EXPENSE" : "INCOME"}
          initialFinance={initialFinance}
          initialValues={{
            title: (
              bank.payee?.name ||
              bank.payeeName ||
              bank.description ||
              ""
            ).slice(0, 120),
            amount: String(Math.abs(Number(bank.amount))),
            currencyCode: bank.currencyCode,
            date: bank.transactionDate,
            contributions: [
              {
                participantId: group.myParticipantId!,
                value: String(Math.abs(Number(bank.amount))),
              },
            ],
          }}
          onClose={done}
          onSaved={() => {}}
        />
      )}
      {selected && (
        <SharedBooking
          group={group}
          row={selected}
          initialInput={initialFinance}
          onClose={() => setSelected(null)}
          onSaved={done}
        />
      )}
    </div>
  );
}
