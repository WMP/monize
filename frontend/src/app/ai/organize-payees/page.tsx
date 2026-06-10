'use client';

import { ProtectedRoute } from '@/components/auth/ProtectedRoute';
import { PageLayout } from '@/components/layout/PageLayout';
import { PageHeader } from '@/components/layout/PageHeader';
import { PayeeOrganizer } from '@/components/ai/PayeeOrganizer';

export default function OrganizePayeesPage() {
  return (
    <ProtectedRoute>
      <PageLayout>
        <main className="px-4 sm:px-6 lg:px-12 pt-6 pb-8">
          <PageHeader
            title="Organize Payees"
            subtitle="Use AI to categorize and merge your payees"
          />
          <div className="max-w-4xl mx-auto">
            <PayeeOrganizer />
          </div>
        </main>
      </PageLayout>
    </ProtectedRoute>
  );
}
