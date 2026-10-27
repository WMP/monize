"use client";

import { useState } from "react";
import { useTranslations } from "next-intl";
import { Modal } from "@/components/ui/Modal";
import { Button } from "@/components/ui/Button";
import { NumericInput } from "@/components/ui/NumericInput";
import type {
  SharedEntryInput,
  SharedParticipant,
  SharedSplitMode,
} from "@/types/shared-expense";
import {
  assignRemainder,
  extrasThenEqual,
  splitDraftStatus,
} from "@/lib/shared-split-draft";
import { useNumberFormat } from "@/hooks/useNumberFormat";
import {
  SharedError,
  SharedMoneyInput,
  SharedNotice,
  SharedTabs,
} from "./SharedPrimitives";

export function SharedSplitEditor({
  input,
  participants,
  places,
  onApply,
  onClose,
  template = false,
  saveError,
  isSaving = false,
}: {
  template?: boolean;
  saveError?: unknown;
  isSaving?: boolean;
  input: SharedEntryInput;
  participants: SharedParticipant[];
  places: number;
  onApply: (split: Pick<SharedEntryInput, "shares" | "splitMode">) => void;
  onClose: () => void;
}) {
  const t = useTranslations("sharedExpenses");
  const { formatCurrency, formatPercent } = useNumberFormat();
  const [mode, setMode] = useState(input.splitMode);
  const [selected, setSelected] = useState(
    input.shares.map((s) => s.participantId),
  );
  const [drafts, setDrafts] = useState<
    Partial<Record<SharedSplitMode, Record<string, string>>>
  >({
    [input.splitMode]: Object.fromEntries(
      input.shares.map((s) => [s.participantId, s.value ?? ""]),
    ),
  });
  const [error, setError] = useState(false);
  const values = drafts[mode] ?? {};
  const shares = selected.map((participantId) => ({
    participantId,
    ...(mode === "EQUAL"
      ? {}
      : { value: values[participantId] ?? (mode === "WEIGHT" ? "1" : "") }),
  }));
  const change = (id: string, value: string) => {
    setError(false);
    setDrafts({ ...drafts, [mode]: { ...values, [id]: value } });
  };
  const status = splitDraftStatus(input.amount, mode, shares, places);
  const remaining =
    status.remaining === null
      ? null
      : mode === "PERCENT"
        ? formatPercent(Math.abs(Number(status.remaining)), 2)
        : formatCurrency(
            Math.abs(Number(status.remaining)),
            input.currencyCode,
          );
  const helper = (personId?: string) => {
    try {
      const rows = personId
        ? assignRemainder(input.amount, shares, personId, places)
        : extrasThenEqual(input.amount, shares, places);
      setDrafts({
        ...drafts,
        EXACT: Object.fromEntries(rows.map((r) => [r.participantId, r.value!])),
      });
      setMode("EXACT");
      setError(false);
    } catch {
      setError(true);
    }
  };
  return (
    <Modal
      pushHistory
      isOpen
      title={t("splitMode")}
      description={t("splitHelp")}
      padding="md"
      maxWidth="lg"
      onClose={onClose}
      footer={
        <>
          <Button variant="outline" onClick={onClose}>
            {t("cancel")}
          </Button>
          <Button
            disabled={!status.valid || isSaving}
            onClick={() => onApply({ splitMode: mode, shares })}
          >
            {t("apply")}
          </Button>
        </>
      }
    >
      <div className="space-y-4">
        <SharedError error={saveError} />
        {remaining !== null && (
          <p role="status" className="text-sm font-medium">
            {t(Number(status.remaining) < 0 ? "splitOver" : "splitRemaining", {
              amount: remaining,
            })}
          </p>
        )}
        {mode === "WEIGHT" && <SharedNotice>{t("weightsHelp")}</SharedNotice>}
        <SharedTabs
          label={t("splitMode")}
          value={mode}
          onChange={setMode}
          options={(["EQUAL", "EXACT", "PERCENT", "WEIGHT"] as const)
            .filter((value) => !template || value !== "EXACT")
            .map((value) => ({ value, label: t(value) }))}
        />
        {error && (
          <p role="alert" className="text-sm text-red-600 dark:text-red-400">
            {t("splitInvalid")}
          </p>
        )}
        <div className="scrollbar-slim max-h-96 overflow-y-auto space-y-3">
          {participants
            .filter((p) => p.isActive || selected.includes(p.id))
            .map((p) => (
              <div
                key={p.id}
                className="grid grid-cols-[minmax(0,1fr)_minmax(0,1fr)] items-center gap-3 border-b border-gray-100 dark:border-gray-700 pb-3"
              >
                <label className="flex items-center gap-3 min-h-11 min-w-0 break-words">
                  <input
                    type="checkbox"
                    checked={selected.includes(p.id)}
                    onChange={(e) =>
                      setSelected(
                        e.target.checked
                          ? [...selected, p.id]
                          : selected.filter((id) => id !== p.id),
                      )
                    }
                    className="h-4 w-4 shrink-0"
                  />
                  {p.name}
                </label>
                {mode !== "EQUAL" && selected.includes(p.id) && (
                  <div>
                    {mode === "EXACT" ? (
                      <SharedMoneyInput
                        label={t("share", { name: p.name })}
                        value={values[p.id] ?? ""}
                        onChange={(value) => change(p.id, value)}
                        currency={input.currencyCode}
                        places={places}
                      />
                    ) : (
                      <NumericInput
                        label={t("share", { name: p.name })}
                        value={
                          values[p.id]
                            ? Number(values[p.id])
                            : mode === "WEIGHT"
                              ? 1
                              : undefined
                        }
                        decimalPlaces={mode === "PERCENT" ? 2 : 4}
                        onChange={(v) =>
                          change(p.id, v === undefined ? "" : String(v))
                        }
                      />
                    )}
                    {mode === "EXACT" && (
                      <Button
                        variant="ghost"
                        size="sm"
                        className="mt-1 text-left"
                        onClick={() => helper(p.id)}
                      >
                        {t("remainder", { name: p.name })}
                      </Button>
                    )}
                  </div>
                )}
              </div>
            ))}
        </div>
        {mode === "EXACT" && (
          <>
            <SharedNotice>{t("extrasHelp")}</SharedNotice>
            <Button variant="outline" onClick={() => helper()}>
              {t("extras")}
            </Button>
          </>
        )}
      </div>
    </Modal>
  );
}
