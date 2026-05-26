'use client';

import { useState } from 'react';
import toast from 'react-hot-toast';
import { Button } from '@/components/ui/Button';
import { Select } from '@/components/ui/Select';
import { NumericInput } from '@/components/ui/NumericInput';
import { DateInput } from '@/components/ui/DateInput';
import { Input } from '@/components/ui/Input';
import { investmentsApi } from '@/lib/investments';
import { getLocalDateString } from '@/lib/utils';
import { getErrorMessage } from '@/lib/errors';
import type { InvestmentAction, SecurityHistoryAccount } from '@/types/investment';

interface SecurityShareAdjustmentFormProps {
  securityId: string;
  /** Accounts the security has been used in (including closed ones). */
  accounts: SecurityHistoryAccount[];
  defaultAccountId?: string;
  onSubmitted: () => void;
  onCancel: () => void;
}

// Quantity-only adjustments that change the share count without any cash
// impact -- exactly what's needed to clean up errant/residual share balances.
const ADJUSTMENT_ACTIONS: { value: InvestmentAction; label: string }[] = [
  { value: 'REMOVE_SHARES', label: 'Remove Shares' },
  { value: 'ADD_SHARES', label: 'Add Shares' },
];

/**
 * Compact form for posting an ADD_SHARES / REMOVE_SHARES adjustment against a
 * security in a chosen account. Works for closed accounts and inactive
 * securities (the backend looks them up by id, not by active status), so it
 * can be used to zero out residual share balances anywhere they linger.
 */
export function SecurityShareAdjustmentForm({
  securityId,
  accounts,
  defaultAccountId,
  onSubmitted,
  onCancel,
}: SecurityShareAdjustmentFormProps) {
  const [accountId, setAccountId] = useState(
    defaultAccountId || accounts[0]?.accountId || '',
  );
  const [action, setAction] = useState<InvestmentAction>('REMOVE_SHARES');
  const [quantity, setQuantity] = useState<number | undefined>(undefined);
  const [transactionDate, setTransactionDate] = useState(getLocalDateString());
  const [description, setDescription] = useState('');
  const [isSaving, setIsSaving] = useState(false);

  const handleSubmit = async () => {
    if (!accountId) {
      toast.error('Select an account');
      return;
    }
    if (!quantity || quantity <= 0) {
      toast.error('Quantity must be greater than zero');
      return;
    }
    setIsSaving(true);
    try {
      await investmentsApi.createTransaction({
        accountId,
        securityId,
        action,
        transactionDate,
        quantity,
        description: description || undefined,
      });
      toast.success('Adjustment recorded');
      onSubmitted();
    } catch (error) {
      toast.error(getErrorMessage(error, 'Failed to record adjustment'));
    } finally {
      setIsSaving(false);
    }
  };

  return (
    <div className="space-y-3 rounded-lg border border-gray-200 bg-gray-50 p-4 dark:border-gray-700 dark:bg-gray-800/40">
      <div className="text-sm font-medium text-gray-700 dark:text-gray-300">
        Adjust shares
      </div>
      <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
        <Select
          label="Account"
          value={accountId}
          onChange={(e) => setAccountId(e.target.value)}
          options={[
            { value: '', label: 'Select account...' },
            ...accounts.map((a) => ({
              value: a.accountId,
              label: a.isClosed ? `${a.accountName} (closed)` : a.accountName,
            })),
          ]}
        />
        <Select
          label="Action"
          value={action}
          onChange={(e) => setAction(e.target.value as InvestmentAction)}
          options={ADJUSTMENT_ACTIONS}
        />
        <NumericInput
          label="Quantity (Shares)"
          value={quantity}
          onChange={setQuantity}
          decimalPlaces={8}
          min={0}
        />
        <DateInput
          label="Date"
          value={transactionDate}
          onDateChange={setTransactionDate}
        />
      </div>
      <Input
        label="Description (optional)"
        placeholder="e.g. Clean up residual shares"
        value={description}
        onChange={(e) => setDescription(e.target.value)}
      />
      <div className="flex justify-end gap-2">
        <Button variant="ghost" size="sm" onClick={onCancel} disabled={isSaving}>
          Cancel
        </Button>
        <Button size="sm" onClick={handleSubmit} disabled={isSaving}>
          {isSaving ? 'Saving...' : 'Record adjustment'}
        </Button>
      </div>
    </div>
  );
}
