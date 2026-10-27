"use client";

import { useParams } from "next/navigation";
import { useTranslations } from "next-intl";
import { ProtectedRoute } from "@/components/auth/ProtectedRoute";
import { PageLayout } from "@/components/layout/PageLayout";
import { PageHeader } from "@/components/layout/PageHeader";
import { ButtonLink } from "@/components/ui/Button";
import { SharedPeople } from "@/components/shared-expenses/SharedPeople";

export default function LinkedPeoplePage() {
  const t = useTranslations("sharedExpenses");
  const { payeeId } = useParams<{ payeeId: string }>();
  return (
    <ProtectedRoute>
      <PageLayout>
        <div className="mx-auto max-w-5xl space-y-5 px-4 py-6">
          <PageHeader
            title={t("linkedPeople")}
            actions={
              <ButtonLink href="/shared-expenses" variant="outline">
                {t("title")}
              </ButtonLink>
            }
          />
          <SharedPeople key={payeeId} linkedPayeeId={payeeId} />
        </div>
      </PageLayout>
    </ProtectedRoute>
  );
}
