import { describe, it, expect, vi, beforeEach } from 'vitest';
import { act, fireEvent, screen, waitFor } from '@testing-library/react';
import { render } from '@/test/render';
import { OverpaymentCategoryPanel } from './OverpaymentCategoryPanel';
import { categoriesApi } from '@/lib/categories';
import { accountsApi } from '@/lib/accounts';
import type { Category } from '@/types/category';

vi.mock('@/lib/categories', () => ({
  categoriesApi: { getAll: vi.fn() },
}));
vi.mock('@/lib/accounts', () => ({
  accountsApi: { update: vi.fn() },
}));

const categories = [
  { id: 'cat-extra', name: 'Extra Principal', isIncome: false },
  { id: 'cat-salary', name: 'Salary', isIncome: true },
] as Category[];

beforeEach(() => {
  vi.clearAllMocks();
  vi.mocked(categoriesApi.getAll).mockResolvedValue(categories);
  vi.mocked(accountsApi.update).mockResolvedValue({} as never);
});

async function renderPanel(props: Partial<React.ComponentProps<typeof OverpaymentCategoryPanel>> = {}) {
  const onChange = props.onChange ?? vi.fn();
  await act(async () => {
    render(
      <OverpaymentCategoryPanel accountId="loan-1" value={null} onChange={onChange} {...props} />,
    );
  });
  return { onChange };
}

describe('OverpaymentCategoryPanel', () => {
  it('offers only expense categories', async () => {
    await renderPanel();
    await waitFor(() => expect(screen.getByText('Extra Principal')).toBeInTheDocument());
    expect(screen.queryByText('Salary')).not.toBeInTheDocument();
  });

  it('persists the selection and reports it upward', async () => {
    const { onChange } = await renderPanel();
    await waitFor(() => expect(screen.getByText('Extra Principal')).toBeInTheDocument());

    const select = screen.getByRole('combobox');
    await act(async () => {
      fireEvent.change(select, { target: { value: 'cat-extra' } });
    });

    await waitFor(() =>
      expect(accountsApi.update).toHaveBeenCalledWith('loan-1', {
        overpaymentCategoryId: 'cat-extra',
      }),
    );
    expect(onChange).toHaveBeenCalledWith('cat-extra');
  });

  it('clears the selection when None is chosen', async () => {
    const { onChange } = await renderPanel({ value: 'cat-extra' });
    await waitFor(() => expect(screen.getByText('Extra Principal')).toBeInTheDocument());

    await act(async () => {
      fireEvent.change(screen.getByRole('combobox'), { target: { value: '' } });
    });

    await waitFor(() =>
      expect(accountsApi.update).toHaveBeenCalledWith('loan-1', {
        overpaymentCategoryId: null,
      }),
    );
    expect(onChange).toHaveBeenCalledWith(null);
  });
});
