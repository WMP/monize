import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, fireEvent } from '@/test/render';
import { MapCategoriesStep } from './MapCategoriesStep';
import { createRef } from 'react';

vi.mock('@/components/import/CategoryMappingRow', () => ({
  CategoryMappingRow: ({ mapping }: any) => (
    <div data-testid="category-mapping-row">{mapping.originalName}</div>
  ),
}));

describe('MapCategoriesStep', () => {
  const defaultProps = {
    categoryMappings: [
      { originalName: 'Groceries', categoryId: '', isLoanCategory: false, loanAccountId: '', createNewLoan: '', newLoanAmount: undefined, newLoanInstitution: '' },
      { originalName: 'Utilities', categoryId: 'cat-1', isLoanCategory: false, loanAccountId: '', createNewLoan: '', newLoanAmount: undefined, newLoanInstitution: '' },
    ],
    setCategoryMappings: vi.fn(),
    categoryOptions: [{ value: 'cat-1', label: 'Utilities' }],
    parentCategoryOptions: [{ value: 'parent-1', label: 'Expenses' }],
    accounts: [],
    scrollContainerRef: createRef<HTMLDivElement>(),
    formatCategoryPath: vi.fn((path: string) => path),
    securityMappings: { length: 0 },
    shouldShowMapAccounts: false,
    setStep: vi.fn(),
  };

  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('renders the heading', () => {
    render(<MapCategoriesStep {...defaultProps} />);

    expect(screen.getByText('Map Categories')).toBeInTheDocument();
  });

  it('shows unmatched count', () => {
    render(<MapCategoriesStep {...defaultProps} />);

    expect(screen.getByText(/1 need/)).toBeInTheDocument();
  });

  it('renders CategoryMappingRow for unmatched categories', () => {
    render(<MapCategoriesStep {...defaultProps} />);

    expect(screen.getByText('Groceries')).toBeInTheDocument();
  });

  it('shows Back button that navigates to selectAccount', () => {
    render(<MapCategoriesStep {...defaultProps} />);

    fireEvent.click(screen.getByRole('button', { name: /Back/i }));
    expect(defaultProps.setStep).toHaveBeenCalledWith('selectAccount');
  });

  it('navigates to review when no security mappings', () => {
    render(<MapCategoriesStep {...defaultProps} />);

    fireEvent.click(screen.getByRole('button', { name: /Next/i }));
    expect(defaultProps.setStep).toHaveBeenCalledWith('review');
  });

  it('navigates to mapSecurities when security mappings exist', () => {
    render(<MapCategoriesStep {...defaultProps} securityMappings={{ length: 2 }} />);

    fireEvent.click(screen.getByRole('button', { name: /Next/i }));
    expect(defaultProps.setStep).toHaveBeenCalledWith('mapSecurities');
  });

  it('navigates to mapAccounts when shouldShowMapAccounts is true and no security mappings', () => {
    render(<MapCategoriesStep {...defaultProps} shouldShowMapAccounts={true} securityMappings={{ length: 0 }} />);
    fireEvent.click(screen.getByRole('button', { name: /Next/i }));
    expect(defaultProps.setStep).toHaveBeenCalledWith('mapAccounts');
  });

  it('shows matched loans section when there are loan category mappings', () => {
    const propsWithLoan = {
      ...defaultProps,
      categoryMappings: [
        { originalName: 'Mortgage', categoryId: '', isLoanCategory: true, loanAccountId: 'loan-1', createNewLoan: '', newLoanAmount: undefined, newLoanInstitution: '' },
      ],
    };
    render(<MapCategoriesStep {...propsWithLoan} />);
    expect(screen.getByText(/auto-matched to loan/)).toBeInTheDocument();
  });

  it('treats loan mapping with createNewLoan and newLoanAmount as fully mapped', () => {
    const propsWithNewLoan = {
      ...defaultProps,
      categoryMappings: [
        {
          originalName: 'Car Loan',
          categoryId: '',
          isLoanCategory: true,
          loanAccountId: '',
          createNewLoan: 'true',
          newLoanAmount: 20000,
          newLoanInstitution: 'Bank',
        },
      ],
    };
    render(<MapCategoriesStep {...propsWithNewLoan} />);
    expect(screen.getByText(/0 need attention/)).toBeInTheDocument();
  });

  it('shows matched categories section when there are category-matched mappings', () => {
    render(<MapCategoriesStep {...defaultProps} />);
    expect(screen.getByText(/auto-matched to categories/)).toBeInTheDocument();
  });

  it('filters accounts to show only LOAN and MORTGAGE types for loanAccounts', () => {
    const props = {
      ...defaultProps,
      accounts: [
        { id: 'a1', name: 'Checking', accountType: 'CHEQUING' } as any,
        { id: 'a2', name: 'Mortgage', accountType: 'MORTGAGE' } as any,
        { id: 'a3', name: 'Car Loan', accountType: 'LOAN' } as any,
      ],
    };
    render(<MapCategoriesStep {...props} />);
    expect(screen.getByText('Map Categories')).toBeInTheDocument();
  });
});
