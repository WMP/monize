import { describe, it, expect, vi } from 'vitest';
import { render, screen, fireEvent } from '@/test/render';
import { ReportAccountMultiSelect } from './ReportAccountMultiSelect';
import { Account } from '@/types/account';

const accounts = [
  { id: 'a1', name: 'TFSA - Brokerage', accountSubType: 'INVESTMENT_BROKERAGE' },
  { id: 'a2', name: 'TFSA - Cash', accountSubType: 'INVESTMENT_CASH' },
  { id: 'a3', name: 'RRSP', accountSubType: 'INVESTMENT_CASH' },
] as unknown as Account[];

describe('ReportAccountMultiSelect', () => {
  it('shows the All Accounts placeholder, strips name suffixes, and excludes brokerage by default', () => {
    render(<ReportAccountMultiSelect accounts={accounts} value={[]} onChange={() => {}} />);
    const trigger = screen.getByRole('button', { name: 'Filter by account' });
    expect(trigger).toHaveTextContent('All Accounts');

    fireEvent.click(trigger);
    // Cash sub-accounts are offered with the suffix stripped; the brokerage
    // sub-account is excluded by the default filter.
    expect(screen.getByText('TFSA')).toBeInTheDocument();
    expect(screen.getByText('RRSP')).toBeInTheDocument();
    expect(screen.queryByText('TFSA - Brokerage')).not.toBeInTheDocument();
  });

  it('calls onChange when an option is toggled', () => {
    const onChange = vi.fn();
    render(<ReportAccountMultiSelect accounts={accounts} value={[]} onChange={onChange} />);
    fireEvent.click(screen.getByRole('button', { name: 'Filter by account' }));
    fireEvent.click(screen.getByText('RRSP'));
    expect(onChange).toHaveBeenCalledWith(['a3']);
  });

  it('honours a custom filter that excludes cash sub-accounts', () => {
    render(
      <ReportAccountMultiSelect
        accounts={accounts}
        value={[]}
        onChange={() => {}}
        filter={(a) => a.accountSubType !== 'INVESTMENT_CASH'}
      />,
    );
    fireEvent.click(screen.getByRole('button', { name: 'Filter by account' }));
    // Only the brokerage account remains (label suffix stripped).
    expect(screen.getByText('TFSA')).toBeInTheDocument();
    expect(screen.queryByText('RRSP')).not.toBeInTheDocument();
  });
});
