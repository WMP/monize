'use client';

import { useTranslations } from 'next-intl';
import { Card } from '@/components/ui/Card';
import { AttachmentsSection } from '@/components/transactions/AttachmentsSection';

interface WarrantyDocumentsSectionProps {
  warrantyId: string;
}

/**
 * The Documents section of a warranty's detail page: the receipt, manual and
 * photos that prove the purchase. It is `AttachmentsSection` with a warranty
 * parent, never a second uploader, so the limits, scanning and the preview
 * are the transaction's own (docs/frontend/ui-conventions.md).
 */
export function WarrantyDocumentsSection({ warrantyId }: WarrantyDocumentsSectionProps) {
  const t = useTranslations('warranties');
  return (
    <Card as="section" padding="md" aria-label={t('documents.title')}>
      <AttachmentsSection warrantyId={warrantyId} />
    </Card>
  );
}
