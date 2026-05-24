'use client';

import { useState, useEffect, use } from 'react';
import { useRouter } from 'next/navigation';
import toast from 'react-hot-toast';
import Link from 'next/link';
import { ProtectedRoute } from '@/components/auth/ProtectedRoute';
import { PageLayout } from '@/components/layout/PageLayout';
import { PageHeader } from '@/components/layout/PageHeader';
import { LoadingSpinner } from '@/components/ui/LoadingSpinner';
import { Button } from '@/components/ui/Button';
import { Modal } from '@/components/ui/Modal';
import { InvestmentReportForm } from '@/components/reports/InvestmentReportForm';
import { investmentReportsApi } from '@/lib/investment-reports';
import { InvestmentReport, CreateInvestmentReportData } from '@/types/investment-report';
import { createLogger } from '@/lib/logger';
import { getErrorMessage } from '@/lib/errors';

const logger = createLogger('InvestmentReportEdit');

interface PageProps {
  params: Promise<{ id: string }>;
}

export default function EditInvestmentReportPage({ params }: PageProps) {
  const { id } = use(params);

  return (
    <ProtectedRoute>
      <EditInvestmentReportContent reportId={id} />
    </ProtectedRoute>
  );
}

function EditInvestmentReportContent({ reportId }: { reportId: string }) {
  const router = useRouter();
  const [report, setReport] = useState<InvestmentReport | null>(null);
  const [isLoading, setIsLoading] = useState(true);
  const [isDeleting, setIsDeleting] = useState(false);
  const [showDeleteConfirm, setShowDeleteConfirm] = useState(false);

  useEffect(() => {
    const loadReport = async () => {
      try {
        const data = await investmentReportsApi.getById(reportId);
        setReport(data);
      } catch (error) {
        toast.error(getErrorMessage(error, 'Failed to load report'));
        router.push('/reports');
      } finally {
        setIsLoading(false);
      }
    };
    loadReport();
  }, [reportId, router]);

  const handleSubmit = async (data: CreateInvestmentReportData) => {
    try {
      await investmentReportsApi.update(reportId, data);
      toast.success('Report updated');
      router.push(`/reports/investment/${reportId}`);
    } catch (error) {
      toast.error(getErrorMessage(error, 'Failed to update report'));
      throw error;
    }
  };

  const handleDelete = async () => {
    setIsDeleting(true);
    try {
      await investmentReportsApi.delete(reportId);
      toast.success('Report deleted successfully');
      router.push('/reports');
    } catch (error) {
      toast.error(getErrorMessage(error, 'Failed to delete report'));
      logger.error(error);
    } finally {
      setIsDeleting(false);
      setShowDeleteConfirm(false);
    }
  };

  if (isLoading) {
    return (
      <PageLayout>
        <main className="max-w-4xl mx-auto px-4 sm:px-6 lg:px-12 pt-6 pb-8">
          <div className="flex items-center justify-center py-12">
            <LoadingSpinner />
          </div>
        </main>
      </PageLayout>
    );
  }

  if (!report) {
    return null;
  }

  return (
    <PageLayout>
      <main className="max-w-4xl mx-auto px-4 sm:px-6 lg:px-12 pt-6 pb-8">
        <PageHeader
          title="Edit Investment Report"
          subtitle="Modify your investment report configuration"
          actions={
            <>
              <Button
                variant="outline"
                onClick={() => setShowDeleteConfirm(true)}
                className="text-red-600 hover:text-red-700 hover:bg-red-50 dark:text-red-400 dark:hover:text-red-300 dark:hover:bg-red-900/20"
              >
                Delete Report
              </Button>
              <Link href="/reports">
                <Button variant="outline">Back to Reports</Button>
              </Link>
            </>
          }
        />

        <InvestmentReportForm
          report={report}
          onSubmit={handleSubmit}
          onCancel={() => router.push(`/reports/investment/${reportId}`)}
        />
      </main>

      <Modal
        isOpen={showDeleteConfirm}
        onClose={() => setShowDeleteConfirm(false)}
        maxWidth="md"
        className="p-6"
      >
        <h3 className="text-lg font-medium text-gray-900 dark:text-gray-100 mb-2">
          Delete Report
        </h3>
        <p className="text-gray-500 dark:text-gray-400 mb-6">
          Are you sure you want to delete &quot;{report?.name}&quot;? This action cannot be undone.
        </p>
        <div className="flex justify-end gap-3">
          <Button variant="outline" onClick={() => setShowDeleteConfirm(false)} disabled={isDeleting}>
            Cancel
          </Button>
          <Button
            onClick={handleDelete}
            disabled={isDeleting}
            className="bg-red-600 hover:bg-red-700 text-white"
          >
            {isDeleting ? 'Deleting...' : 'Delete'}
          </Button>
        </div>
      </Modal>
    </PageLayout>
  );
}
