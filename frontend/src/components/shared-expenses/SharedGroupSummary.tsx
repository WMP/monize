"use client";

import { useTranslations } from "next-intl";
import { Card } from "@/components/ui/Card";
import type { SharedGroupDetail } from "@/types/shared-expense";
import { SharedAmount } from "./SharedPrimitives";
import { SharedPositionValue } from "./SharedPositionValue";

export function SharedGroupSummary({ group }: { group: SharedGroupDetail }) {
  const t = useTranslations("sharedExpenses");
  const mine = group.balances.positions.find(
    (person) => person.participantId === group.myParticipantId,
  );
  return (
    <div className="flex flex-wrap gap-3 sm:grid sm:grid-cols-3">
      <Card padding="sm" className="basis-full sm:basis-auto">
        <SharedPositionValue
          personal
          prominent
          amount={mine?.balance ?? null}
          currency={group.currencyCode}
        />
      </Card>
      <Card padding="sm" className="flex-1 basis-36 min-w-fit max-w-full">
        <p className="text-sm text-gray-500 dark:text-gray-400">
          {t("yourCost")}
        </p>
        <p className="mt-1 text-lg sm:text-2xl font-semibold">
          <SharedAmount
            amount={mine?.cost ?? null}
            currency={group.currencyCode}
          />
        </p>
        <p className="mt-2 text-sm text-gray-500 dark:text-gray-400">
          {t("youPaid")} ·{" "}
          <SharedAmount
            amount={mine?.paid ?? null}
            currency={group.currencyCode}
          />
        </p>
      </Card>
      <Card padding="sm" className="flex-1 basis-36 min-w-fit max-w-full">
        <p className="text-sm text-gray-500 dark:text-gray-400">
          {t("totalExpenses")}
        </p>
        <p className="mt-1 text-lg sm:text-2xl font-semibold">
          <SharedAmount
            amount={group.balances.totalExpenses}
            currency={group.currencyCode}
          />
        </p>
      </Card>
    </div>
  );
}
