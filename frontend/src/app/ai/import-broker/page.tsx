'use client';

import { ProtectedRoute } from '@/components/auth/ProtectedRoute';
import { PageLayout } from '@/components/layout/PageLayout';
import { PageHeader } from '@/components/layout/PageHeader';
import { BrokerImport } from '@/components/ai/BrokerImport';

export default function ImportBrokerPage() {
  return (
    <ProtectedRoute>
      <PageLayout>
        <main className="px-4 sm:px-6 lg:px-12 pt-6 pb-8">
          <PageHeader
            title="Import from broker"
            subtitle="Paste your brokerage order history and add the trades"
          />
          <div className="max-w-6xl mx-auto">
            <BrokerImport />
          </div>
        </main>
      </PageLayout>
    </ProtectedRoute>
  );
}
