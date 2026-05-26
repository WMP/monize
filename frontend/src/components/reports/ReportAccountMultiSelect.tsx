'use client';

import { MultiSelect } from '@/components/ui/MultiSelect';
import { Account } from '@/types/account';

interface ReportAccountMultiSelectProps {
  accounts: Account[];
  value: string[];
  onChange: (values: string[]) => void;
  /**
   * Which accounts to offer. Defaults to the set used by the transaction-based
   * reports (every investment account except the brokerage sub-account, whose
   * sibling cash account represents the holding). Portfolio-summary reports
   * pass a predicate that excludes the cash sub-account instead.
   */
  filter?: (account: Account) => boolean;
  className?: string;
}

const defaultFilter = (account: Account) =>
  account.accountSubType !== 'INVESTMENT_BROKERAGE';

export function ReportAccountMultiSelect({
  accounts,
  value,
  onChange,
  filter = defaultFilter,
  className = 'w-48',
}: ReportAccountMultiSelectProps) {
  const options = accounts
    .filter(filter)
    .slice()
    .sort((a, b) => a.name.localeCompare(b.name))
    .map((account) => ({
      value: account.id,
      label: account.name.replace(/ - (Brokerage|Cash)$/, ''),
    }));

  return (
    <div className={className}>
      <MultiSelect
        ariaLabel="Filter by account"
        placeholder="All Accounts"
        options={options}
        value={value}
        onChange={onChange}
      />
    </div>
  );
}
