'use client';

import { useTranslations } from 'next-intl';
import { ProtectedRoute } from '@/components/auth/ProtectedRoute';
import { PageLayout } from '@/components/layout/PageLayout';
import { PageHeader } from '@/components/layout/PageHeader';
import { ChatInterface } from '@/components/ai/ChatInterface';

export default function AiPage() {
  const t = useTranslations('ai');
  return (
    <ProtectedRoute>
      <PageLayout>
        <main className="px-4 sm:px-6 lg:px-12 pt-6 pb-8">
          <PageHeader
            title={t('page.title')}
            subtitle={t('page.subtitle')}
            helpUrl="https://github.com/kenlasko/monize/wiki/AI"
          />
          <div className="max-w-4xl mx-auto">
            <ChatInterface />
          </div>
        </main>
      </PageLayout>
    </ProtectedRoute>
  );
}
