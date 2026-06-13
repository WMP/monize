'use client';

import { useTranslations } from 'next-intl';
import { ProtectedRoute } from '@/components/auth/ProtectedRoute';
import { PageLayout } from '@/components/layout/PageLayout';
import { PageHeader } from '@/components/layout/PageHeader';
import { PayeeSuggestionReview } from '@/components/ai/PayeeSuggestionReview';

export default function PayeeSuggestionsPage() {
  const t = useTranslations('payeeSuggestions');
  return (
    <ProtectedRoute>
      <PageLayout>
        <main className="px-4 sm:px-6 lg:px-12 pt-6 pb-8">
          <PageHeader title={t('page.title')} subtitle={t('page.subtitle')} />
          <div className="max-w-4xl mx-auto">
            <PayeeSuggestionReview />
          </div>
        </main>
      </PageLayout>
    </ProtectedRoute>
  );
}
