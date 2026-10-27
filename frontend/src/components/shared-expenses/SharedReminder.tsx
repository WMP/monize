"use client";
import { useState } from "react";
import { useTranslations } from "next-intl";
import { Button } from "@/components/ui/Button";
import { Modal } from "@/components/ui/Modal";
import { sharedCommand, sharedExpensesApi } from "@/lib/shared-expenses";
import type { SharedGroupDetail } from "@/types/shared-expense";
import { SharedError, SharedNotice } from "./SharedPrimitives";

export function SharedReminder({
  group,
  participantId,
}: {
  group: SharedGroupDetail;
  participantId: string;
}) {
  const t = useTranslations("sharedExpenses");
  const tn = useTranslations("notifications.shared");
  const [command, setCommand] = useState<ReturnType<
    typeof sharedCommand
  > | null>(null);
  const [sent, setSent] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<unknown>(null);
  const send = async () => {
    if (!command || busy) return;
    setBusy(true);
    setError(null);
    try {
      await sharedExpensesApi.remind(group.id, participantId, command);
      setSent(true);
      setCommand(null);
    } catch (cause) {
      setError(cause);
    } finally {
      setBusy(false);
    }
  };
  return (
    <>
      <Button
        size="sm"
        variant="ghost"
        disabled={sent}
        onClick={() => {
          setError(null);
          setCommand(sharedCommand(group.financialRevision));
        }}
      >
        {t(sent ? "reminderSent" : "remind")}
      </Button>
      {command && (
        <Modal
          isOpen
          title={t("remindPerson", {
            name:
              group.participants.find((p) => p.id === participantId)?.name ??
              "",
          })}
          padding="md"
          maxWidth="md"
          onClose={busy ? undefined : () => setCommand(null)}
          footer={
            <>
              <Button
                variant="outline"
                disabled={busy}
                onClick={() => setCommand(null)}
              >
                {t("cancel")}
              </Button>
              <Button isLoading={busy} onClick={send}>
                {t("sendReminder")}
              </Button>
            </>
          }
        >
          <SharedError error={error} />
          <SharedNotice>{t("reminderHelp")}</SharedNotice>
          <blockquote className="my-4 border-l-2 border-blue-500 pl-4">
            <p className="font-semibold">{tn("title")}</p>
            <p>{tn("message")}</p>
          </blockquote>
        </Modal>
      )}
    </>
  );
}
