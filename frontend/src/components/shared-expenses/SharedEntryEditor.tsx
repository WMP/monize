"use client";

import { useState } from "react";
import dynamic from "next/dynamic";
import { useTranslations } from "next-intl";
import { Modal } from "@/components/ui/Modal";
import { Button } from "@/components/ui/Button";
import { Input } from "@/components/ui/Input";
import { Select } from "@/components/ui/Select";
import { DateInput } from "@/components/ui/DateInput";
import { NumericInput } from "@/components/ui/NumericInput";
import { ConfirmDialog } from "@/components/ui/ConfirmDialog";
import { Card } from "@/components/ui/Card";
import { useFinancialToday } from "@/hooks/useFinancialToday";
import {
  sharedDocumentsApi,
  type SharedDocument,
} from "@/lib/shared-documents";
import { sharedExpensesApi } from "@/lib/shared-expenses";
import {
  initialSharedEntry,
  usableSharedTemplate,
} from "@/lib/shared-split-draft";
import type {
  SharedEntry,
  SharedEntryInput,
  SharedEntryType,
  SharedFinanceInput,
  SharedGroupDetail,
  SharedSuggestion,
} from "@/types/shared-expense";
import {
  SharedAmount,
  SharedCurrencySelect,
  SharedError,
  SharedMoneyInput,
  SharedNotice,
} from "./SharedPrimitives";
import { SharedNavigationGuard } from "./SharedNavigationGuard";
import { SharedCombinedBooking } from "./SharedCombinedBooking";
import { SharedSplitEditor } from "./SharedSplitEditor";
import { useSharedEntryPreview } from "./useSharedEntryPreview";
import { SharedEntryPreview } from "./SharedEntryPreview";
const SharedDocuments = dynamic(
  () => import("./SharedDocuments").then((m) => m.SharedDocuments),
  { ssr: false },
);

export function SharedEntryEditor({
  group,
  entry,
  kind = "EXPENSE",
  suggestion,
  refundSource,
  sourceDocument,
  initialValues,
  initialFinance,
  onClose,
  onSaved,
}: {
  group: SharedGroupDetail;
  entry?: SharedEntry;
  kind?: SharedEntryType;
  suggestion?: SharedSuggestion;
  refundSource?: SharedEntry;
  sourceDocument?: SharedDocument;
  onClose: () => void;
  onSaved: (entry: SharedEntry) => void;
  initialValues?: Partial<SharedEntryInput>;
  initialFinance?: Partial<SharedFinanceInput>;
}) {
  const t = useTranslations("sharedExpenses");
  const common = useTranslations("common");
  const today = useFinancialToday();
  const [initial] = useState<SharedEntryInput>(() => {
    const base = initialSharedEntry(group, today, entry);
    if (entry) return base;
    if (kind === "REPAYMENT")
      return {
        ...base,
        type: kind,
        title: t("REPAYMENT"),
        amount: suggestion?.amount ?? "",
        shares: [],
        contributions: [],
        fromParticipantId:
          suggestion?.fromParticipantId ?? group.myParticipantId ?? "",
        toParticipantId: suggestion?.toParticipantId ?? "",
        expectedGroupRevision: group.financialRevision,
      };
    if (refundSource)
      return {
        ...base,
        type: "REFUND",
        title: refundSource.title,
        amount: "",
        currencyCode: refundSource.currencyCode,
        sourceEntryId: refundSource.id,
        splitMode: "WEIGHT",
        shares: refundSource.allocations
          .filter((a) => a.kind === "SHARE" && Number(a.originalAmount) > 0)
          .map((a) => ({
            participantId: a.participantId,
            value: a.originalAmount,
          })),
      };
    return {
      ...base,
      type: kind,
      ...initialValues,
      ...(sourceDocument
        ? { title: sourceDocument.filename.replace(/\.[^.]+$/, "") }
        : {}),
    };
  });
  const [input, setInput] = useState(initial);
  const [places, setPlaces] = useState(
    initial.currencyCode === group.currencyCode
      ? group.decimalPlaces
      : undefined,
  );
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<unknown>(null);
  const [includeOwn, setIncludeOwn] = useState(!!initialFinance);
  const [booking, setBooking] = useState(false);
  const [split, setSplit] = useState(false);
  const [discard, setDiscard] = useState(false);
  const [pendingFiles, setPendingFiles] = useState(false);
  const [documentError, setDocumentError] = useState<unknown>(null);
  const [documentLinked, setDocumentLinked] = useState(false);
  const [saved, setSaved] = useState<SharedEntry | null>(null);
  const [multiple, setMultiple] = useState(input.contributions.length > 1);
  const inputKey = JSON.stringify(input);
  const preview = useSharedEntryPreview(
    group.id,
    input,
    places,
    entry?.id,
    !!saved,
  );
  const shownPreview = preview.preview;
  const dirty = JSON.stringify(initial) !== inputKey;
  const participants = group.participants.filter(
    (p) =>
      p.isActive ||
      input.shares.some((s) => s.participantId === p.id) ||
      input.contributions.some((s) => s.participantId === p.id),
  );
  const options = [
    { value: "", label: t("choose") },
    ...participants.map((p) => ({ value: p.id, label: p.name })),
  ];
  const change = (patch: Partial<SharedEntryInput>) => {
    setInput({ ...input, ...patch });
    setError(null);
  };
  const close = () => {
    if (busy) return;
    if ((dirty && !saved) || pendingFiles) setDiscard(true);
    else onClose();
  };
  const linkSourceDocument = async (targetId: string) => {
    if (!sourceDocument) return;
    setDocumentError(null);
    try {
      await sharedDocumentsApi.update(
        group.id,
        sourceDocument,
        sourceDocument.filename,
        sourceDocument.documentKind,
        targetId,
      );
      setDocumentLinked(true);
    } catch (cause) {
      setDocumentError(cause);
    }
  };
  const acceptResult = async (result: SharedEntry) => {
    setSaved(result);
    setBooking(false);
    await linkSourceDocument(result.id);
    onSaved(result);
  };
  const save = async () => {
    if (!shownPreview) return;
    if (
      includeOwn &&
      shownPreview.state === "POSTED" &&
      shownPreview.ownEffect
    ) {
      setBooking(true);
      return;
    }
    setBusy(true);
    setError(null);
    try {
      const result = await sharedExpensesApi.saveEntry(
        group.id,
        { ...input, previewFingerprint: shownPreview.previewFingerprint },
        entry?.id,
      );
      await acceptResult(result);
    } catch (cause) {
      setError(cause);
    } finally {
      setBusy(false);
    }
  };
  const label =
    input.type === "REPAYMENT"
      ? t("addRepayment")
      : input.type === "REFUND"
        ? t("refund")
        : entry
          ? t("edit")
          : t(input.type === "INCOME" ? "addIncome" : "addExpense");
  return (
    <>
      <SharedNavigationGuard
        when={dirty && !saved}
        message={common("unsavedChanges.message")}
      />
      <Modal
        pushHistory
        onBeforeClose={() => {
          if (busy) return false;
          if ((dirty && !saved) || pendingFiles) {
            setDiscard(true);
            return false;
          }
        }}
        isOpen
        fixedHeight
        fullScreenOnPhone
        title={saved ? t("saved") : label}
        description={
          saved ? (
            t("sharedWithGroup")
          ) : input.type === "REPAYMENT" ? (
            t("repaymentHelp")
          ) : input.title.trim() && Number(input.amount) > 0 ? (
            <span className="flex flex-wrap justify-between gap-x-3">
              <span className="break-words">{input.title}</span>
              <SharedAmount
                amount={input.amount}
                currency={input.currencyCode}
                relativeTo={group.currencyCode}
              />
            </span>
          ) : undefined
        }
        onClose={close}
        padding="md"
        maxWidth="2xl"
        footer={
          saved ? (
            <Button onClick={close}>{t("close")}</Button>
          ) : (
            <>
              <Button variant="outline" disabled={busy} onClick={close}>
                {t("cancel")}
              </Button>
              <Button isLoading={busy} disabled={!shownPreview} onClick={save}>
                {includeOwn &&
                shownPreview?.state === "POSTED" &&
                shownPreview.ownEffect
                  ? t("reviewOwnFinances")
                  : input.type === "REPAYMENT"
                    ? t("confirmRepayment")
                    : input.type === "EXPENSE" && !entry
                      ? t("confirmSave")
                      : t("save")}
              </Button>
            </>
          )
        }
      >
        <div className="space-y-4">
          <SharedError error={error} />
          {saved ? (
            <>
              <SharedNotice>
                {saved.state === "DRAFT"
                  ? t("draftSaved")
                  : t("financialPrivacy")}
              </SharedNotice>
              {!!documentError && (
                <>
                  <SharedNotice>{t("fileLinkFailed")}</SharedNotice>
                  <SharedError error={documentError} />
                  <Button
                    disabled={busy}
                    onClick={async () => {
                      if (busy) return;
                      setBusy(true);
                      try {
                        await linkSourceDocument(saved.id);
                      } finally {
                        setBusy(false);
                      }
                    }}
                  >
                    {t("retry")}
                  </Button>
                </>
              )}
              <SharedDocuments
                key={`${saved.id}:${documentLinked}`}
                group={group}
                entryId={saved.id}
                onPendingChange={setPendingFiles}
              />
            </>
          ) : (
            <>
              <Input
                label={t("entryTitle")}
                value={input.title}
                maxLength={120}
                autoFocus
                onChange={(e) => change({ title: e.target.value })}
              />
              <div className="grid grid-cols-2 gap-3">
                <SharedMoneyInput
                  label={t("amount")}
                  value={input.amount}
                  currency={input.currencyCode}
                  places={places ?? 4}
                  disabled={places === undefined}
                  onChange={(amount) =>
                    change({
                      amount,
                      ...(!multiple && input.contributions.length === 1
                        ? {
                            contributions: [
                              { ...input.contributions[0], value: amount },
                            ],
                          }
                        : {}),
                    })
                  }
                />
                <SharedCurrencySelect
                  onResolved={setPlaces}
                  value={input.currencyCode}
                  disabled={input.type === "REFUND"}
                  onChange={(currencyCode, decimals) => {
                    setPlaces(decimals);
                    change({
                      currencyCode,
                      fxRate: undefined,
                      amount: "",
                      contributions: input.contributions.map((part) => ({
                        ...part,
                        value: "",
                      })),
                      ...(input.splitMode === "EXACT"
                        ? {
                            shares: input.shares.map((part) => ({
                              ...part,
                              value: "",
                            })),
                          }
                        : {}),
                    });
                  }}
                />
              </div>
              {input.type === "REPAYMENT" ? (
                <>
                  <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
                    <Select
                      label={t("from")}
                      value={input.fromParticipantId}
                      options={options}
                      onChange={(e) =>
                        change({ fromParticipantId: e.target.value })
                      }
                    />
                    <Select
                      label={t("to")}
                      value={input.toParticipantId}
                      options={options}
                      onChange={(e) =>
                        change({ toParticipantId: e.target.value })
                      }
                    />
                  </div>
                  <label className="flex gap-3 items-start text-sm">
                    <input
                      className="mt-1"
                      type="checkbox"
                      checked={input.acknowledgeOverpayment ?? false}
                      onChange={(e) =>
                        change({ acknowledgeOverpayment: e.target.checked })
                      }
                    />
                    {t("overpayment")}
                  </label>
                </>
              ) : (
                <>
                  <div className="space-y-1">
                    {!multiple ? (
                      <div className="grid grid-cols-1 min-[360px]:grid-cols-2 gap-3">
                        <Select
                          label={t(
                            input.type === "EXPENSE" ? "paidBy" : "receivedBy",
                          )}
                          value={input.contributions[0]?.participantId ?? ""}
                          options={options}
                          onChange={(e) =>
                            change({
                              contributions: e.target.value
                                ? [
                                    {
                                      participantId: e.target.value,
                                      value: input.amount,
                                    },
                                  ]
                                : [],
                            })
                          }
                        />
                        <DateInput
                          label={t("date")}
                          value={input.date}
                          onDateChange={(date) => change({ date })}
                        />
                      </div>
                    ) : (
                      <fieldset className="space-y-3">
                        <legend className="text-sm font-medium">
                          {t(
                            input.type === "EXPENSE" ? "paidBy" : "receivedBy",
                          )}
                        </legend>
                        {participants.map((person) => (
                          <SharedMoneyInput
                            key={person.id}
                            label={t("contribution", { name: person.name })}
                            value={
                              input.contributions.find(
                                (c) => c.participantId === person.id,
                              )?.value ?? ""
                            }
                            currency={input.currencyCode}
                            places={places ?? 4}
                            disabled={places === undefined}
                            onChange={(value) =>
                              change({
                                contributions: [
                                  ...input.contributions.filter(
                                    (c) => c.participantId !== person.id,
                                  ),
                                  ...(value && Number(value) > 0
                                    ? [{ participantId: person.id, value }]
                                    : []),
                                ],
                              })
                            }
                          />
                        ))}
                      </fieldset>
                    )}
                    <Button
                      variant="ghost"
                      size="sm"
                      onClick={() => {
                        setMultiple(!multiple);
                        if (multiple)
                          change({
                            contributions: [
                              {
                                participantId:
                                  input.contributions[0]?.participantId ??
                                  group.myParticipantId ??
                                  "",
                                value: input.amount,
                              },
                            ],
                          });
                      }}
                    >
                      {t(
                        multiple
                          ? "singleContributor"
                          : input.type === "EXPENSE"
                            ? "multiplePayers"
                            : "multipleReceivers",
                      )}
                    </Button>
                  </div>
                  <Card padding="sm">
                    <div className="flex flex-wrap justify-between items-center gap-3">
                      <div className="min-w-0 flex-1">
                        <p className="font-medium">{t("splitBetween")}</p>
                        <p className="text-sm text-gray-500 dark:text-gray-400">
                          {input.splitMode === "EQUAL"
                            ? t("equalSummary", { count: input.shares.length })
                            : t(input.splitMode)}
                        </p>
                        <p className="text-sm break-words mt-1">
                          {participants
                            .filter((p) =>
                              input.shares.some(
                                (s) => s.participantId === p.id,
                              ),
                            )
                            .map((p) => p.name)
                            .join(", ")}
                        </p>
                      </div>
                      <Button variant="outline" onClick={() => setSplit(true)}>
                        {t("split")}
                      </Button>
                    </div>
                  </Card>
                  {input.type === "REFUND" && (
                    <SharedNotice>{t("refundHelp")}</SharedNotice>
                  )}
                </>
              )}
              {!entry && input.type === "EXPENSE" && group.splitTemplate && (
                <SharedNotice>
                  {t(
                    usableSharedTemplate(group)
                      ? "templateApplied"
                      : "templateUnavailable",
                  )}
                </SharedNotice>
              )}
              {(input.type === "REPAYMENT" || multiple) && (
                <DateInput
                  label={t("date")}
                  value={input.date}
                  onDateChange={(date) => change({ date })}
                />
              )}
              <details
                className="space-y-3"
                open={!!shownPreview?.draftReason || undefined}
              >
                <summary className="cursor-pointer min-h-10 text-sm font-medium">
                  {t("advanced")}
                </summary>
                <Input
                  label={t("note")}
                  value={input.note ?? ""}
                  maxLength={750}
                  onChange={(e) => change({ note: e.target.value })}
                />
                <Input
                  label={t("categoryLabel")}
                  value={input.categoryLabel ?? ""}
                  maxLength={60}
                  onChange={(e) => change({ categoryLabel: e.target.value })}
                />
                {input.currencyCode !== group.currencyCode &&
                  input.type !== "REFUND" && (
                    <>
                      <NumericInput
                        label={t("fxRate")}
                        decimalPlaces={10}
                        value={input.fxRate ? Number(input.fxRate) : undefined}
                        onChange={(rate) =>
                          change({
                            fxRate:
                              rate === undefined ? undefined : String(rate),
                          })
                        }
                      />
                      <p className="text-sm text-gray-500 dark:text-gray-400">
                        {t("fxHelp", {
                          from: input.currencyCode,
                          to: group.currencyCode,
                        })}
                      </p>
                    </>
                  )}
              </details>
              {shownPreview && (
                <SharedEntryPreview
                  entry={shownPreview}
                  group={group}
                  compact
                />
              )}
              {preview.pending && (
                <p
                  role="status"
                  className="text-sm text-gray-500 dark:text-gray-400"
                >
                  {t("checkingSplit")}
                </p>
              )}
              {preview.validation && (
                <SharedNotice>{t(preview.validation)}</SharedNotice>
              )}
              <SharedError error={preview.error} retry={preview.retry} />
              {group.myParticipantId && (
                <label className="flex items-start gap-3 text-sm">
                  <input
                    type="checkbox"
                    className="mt-1 h-4 w-4"
                    checked={includeOwn}
                    onChange={(event) => setIncludeOwn(event.target.checked)}
                  />
                  <span>
                    {t("includeOwnFinances")}
                    {includeOwn && (
                      <span className="block mt-1 text-gray-500 dark:text-gray-400">
                        {t("combinedBookingHelp")}
                      </span>
                    )}
                  </span>
                </label>
              )}
            </>
          )}
        </div>
      </Modal>
      {booking && shownPreview && (
        <SharedCombinedBooking
          group={group}
          entry={shownPreview}
          entryInput={input}
          entryId={entry?.id}
          initialInput={initialFinance}
          onClose={() => setBooking(false)}
          onSaved={acceptResult}
        />
      )}
      {split && (
        <SharedSplitEditor
          input={input}
          participants={participants}
          places={places ?? 4}
          onClose={() => setSplit(false)}
          onApply={(value) => {
            change(value);
            setSplit(false);
          }}
        />
      )}
      <ConfirmDialog
        isOpen={discard}
        title={t("discardTitle")}
        message={
          pendingFiles
            ? t("pendingFilesLeave")
            : common("unsavedChanges.message")
        }
        confirmLabel={t("discard")}
        cancelLabel={t("keepEditing")}
        onCancel={() => setDiscard(false)}
        onConfirm={onClose}
      />
    </>
  );
}
