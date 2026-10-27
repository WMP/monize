"use client";

import { useState } from "react";
import { useTranslations } from "next-intl";
import { Modal } from "@/components/ui/Modal";
import { Button } from "@/components/ui/Button";
import { Select } from "@/components/ui/Select";
import { useReportData } from "@/hooks/useReportData";
import { Input } from "@/components/ui/Input";
import { ConfirmDialog } from "@/components/ui/ConfirmDialog";
import { usePreferencesStore } from "@/store/preferencesStore";
import { preferredCurrency } from "@/lib/default-currency";
import { sharedExpensesApi } from "@/lib/shared-expenses";
import {
  SharedCurrencySelect,
  SharedError,
  SharedNotice,
} from "./SharedPrimitives";

export function SharedGroupForm({
  onClose,
  onCreated,
}: {
  onClose: () => void;
  onCreated: (id: string) => void;
}) {
  const t = useTranslations("sharedExpenses");
  const common = useTranslations("common");
  const preferences = usePreferencesStore((s) => s.preferences);
  const [operationId] = useState(() => crypto.randomUUID());
  const [name, setName] = useState("");
  const [myName, setMyName] = useState("");
  const [currencyCode, setCurrency] = useState(() =>
    preferredCurrency(preferences?.defaultCurrency),
  );
  const contacts = useReportData(sharedExpensesApi.people, []);
  const [people, setPeople] = useState<
    { id: string; name: string; personId?: string }[]
  >([{ id: crypto.randomUUID(), name: "" }]);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<unknown>(null);
  const [discard, setDiscard] = useState(false);
  const dirty = !!(name || myName || people.some((p) => p.name));
  const close = () => {
    if (busy) return;
    if (dirty) setDiscard(true);
    else onClose();
  };
  const save = async () => {
    if (busy) return;
    setBusy(true);
    setError(null);
    try {
      const result = await sharedExpensesApi.createGroup({
        operationId,
        name: name.trim(),
        myName: myName.trim(),
        currencyCode,
        participants: people
          .filter((p) => p.name.trim())
          .map((p) => ({
            name: p.name.trim(),
            ...(p.personId ? { personId: p.personId } : {}),
          })),
      });
      onCreated(result.id);
    } catch (cause) {
      setError(cause);
    } finally {
      setBusy(false);
    }
  };
  return (
    <>
      <Modal
        isOpen
        title={t("newGroup")}
        description={t("soloHelp")}
        padding="md"
        maxWidth="lg"
        onClose={close}
        footer={
          <>
            <Button variant="outline" disabled={busy} onClick={close}>
              {t("cancel")}
            </Button>
            <Button
              isLoading={busy}
              disabled={!name.trim() || !myName.trim()}
              onClick={save}
            >
              {t("create")}
            </Button>
          </>
        }
      >
        <div className="space-y-4">
          <SharedError error={error} />
          <Input
            label={t("groupName")}
            value={name}
            onChange={(e) => setName(e.target.value)}
            maxLength={120}
            autoFocus
          />
          <Input
            label={t("myName")}
            value={myName}
            onChange={(e) => setMyName(e.target.value)}
            maxLength={80}
          />
          <SharedCurrencySelect value={currencyCode} onChange={setCurrency} />
          <fieldset className="space-y-3">
            <legend className="mb-2 text-sm font-medium">
              {t("participants")}
            </legend>
            <SharedError error={contacts.error} retry={contacts.reload} />
            {!!contacts.data?.length && (
              <Select
                label={t("addSavedPerson")}
                value=""
                disabled={people.length >= 49}
                options={[
                  { value: "", label: t("choose") },
                  ...contacts.data
                    .filter(
                      (contact) =>
                        !people.some(
                          (person) => person.personId === contact.id,
                        ),
                    )
                    .map((contact) => ({
                      value: contact.id,
                      label: contact.name,
                    })),
                ]}
                onChange={(event) => {
                  const contact = contacts.data?.find(
                    (item) => item.id === event.target.value,
                  );
                  if (contact)
                    setPeople([
                      ...people.filter((person) => person.name.trim()),
                      {
                        id: crypto.randomUUID(),
                        name: contact.name,
                        personId: contact.id,
                      },
                    ]);
                }}
              />
            )}
            {people.map((person) => (
              <div className="flex flex-wrap items-end gap-2" key={person.id}>
                <div className="min-w-0 flex-1">
                  <Input
                    aria-label={t("participantName")}
                    value={person.name}
                    maxLength={80}
                    onChange={(e) =>
                      setPeople(
                        people.map((p) =>
                          p.id === person.id
                            ? { ...p, name: e.target.value }
                            : p,
                        ),
                      )
                    }
                  />
                </div>
                <Button
                  variant="ghost"
                  onClick={() =>
                    setPeople(people.filter((p) => p.id !== person.id))
                  }
                >
                  {t("removePerson")}
                </Button>
              </div>
            ))}
            <Button
              variant="outline"
              disabled={people.length >= 49}
              onClick={() =>
                setPeople([...people, { id: crypto.randomUUID(), name: "" }])
              }
            >
              {t("addPerson")}
            </Button>
          </fieldset>
          <SharedNotice>{t("financialPrivacy")}</SharedNotice>
        </div>
      </Modal>
      <ConfirmDialog
        isOpen={discard}
        title={t("discardTitle")}
        message={common("unsavedChanges.message")}
        confirmLabel={t("discard")}
        cancelLabel={t("keepEditing")}
        onCancel={() => setDiscard(false)}
        onConfirm={onClose}
      />
    </>
  );
}
