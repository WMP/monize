import { Suspense } from 'react';
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, fireEvent, waitFor, act } from '@/test/render';
import EditInvestmentReportPage from './page';

const mockPush = vi.fn();
vi.mock('next/navigation', () => ({ useRouter: () => ({ push: mockPush }) }));
vi.mock('@/components/auth/ProtectedRoute', () => ({
  ProtectedRoute: ({ children }: { children: React.ReactNode }) => <>{children}</>,
}));
vi.mock('@/components/layout/PageLayout', () => ({
  PageLayout: ({ children }: { children: React.ReactNode }) => <>{children}</>,
}));
vi.mock('@/components/layout/PageHeader', () => ({
  PageHeader: ({ title, actions }: { title: string; actions?: React.ReactNode }) => (
    <div>
      <h1>{title}</h1>
      {actions}
    </div>
  ),
}));
vi.mock('@/components/ui/LoadingSpinner', () => ({ LoadingSpinner: () => <div>spinner</div> }));
vi.mock('@/components/ui/Modal', () => ({
  Modal: ({ isOpen, children }: { isOpen: boolean; children: React.ReactNode }) =>
    isOpen ? <div data-testid="modal">{children}</div> : null,
}));

const mockGetById = vi.fn();
const mockUpdate = vi.fn();
const mockDelete = vi.fn();
vi.mock('@/lib/investment-reports', () => ({
  investmentReportsApi: {
    getById: (...a: unknown[]) => mockGetById(...a),
    update: (...a: unknown[]) => mockUpdate(...a),
    delete: (...a: unknown[]) => mockDelete(...a),
  },
}));

vi.mock('@/components/reports/InvestmentReportForm', () => ({
  InvestmentReportForm: ({ onSubmit }: { onSubmit: (d: unknown) => Promise<void> }) => (
    <button onClick={() => onSubmit({ name: 'Updated', config: { columns: ['symbol'] } })}>
      do-submit
    </button>
  ),
}));

async function renderEdit(id = 'r1') {
  await act(async () => {
    render(
      <Suspense fallback={<div>suspense</div>}>
        <EditInvestmentReportPage params={Promise.resolve({ id })} />
      </Suspense>,
    );
  });
}

const report = {
  id: 'r1',
  name: 'My Report',
  config: { columns: ['symbol'] },
};

describe('EditInvestmentReportPage', () => {
  beforeEach(() => vi.clearAllMocks());

  it('loads the report and updates it', async () => {
    mockGetById.mockResolvedValue(report);
    mockUpdate.mockResolvedValue(report);
    await renderEdit();
    expect(await screen.findByText('Edit Investment Report')).toBeInTheDocument();
    await act(async () => {
      fireEvent.click(screen.getByText('do-submit'));
    });
    await waitFor(() => expect(mockUpdate).toHaveBeenCalledWith('r1', expect.any(Object)));
    expect(mockPush).toHaveBeenCalledWith('/reports/investment/r1');
  });

  it('deletes the report through the confirmation modal', async () => {
    mockGetById.mockResolvedValue(report);
    mockDelete.mockResolvedValue(undefined);
    await renderEdit();
    await screen.findByText('Edit Investment Report');
    await act(async () => {
      fireEvent.click(screen.getByRole('button', { name: 'Delete Report' }));
    });
    expect(screen.getByTestId('modal')).toBeInTheDocument();
    await act(async () => {
      fireEvent.click(screen.getByRole('button', { name: 'Delete' }));
    });
    await waitFor(() => expect(mockDelete).toHaveBeenCalledWith('r1'));
    expect(mockPush).toHaveBeenCalledWith('/reports');
  });

  it('redirects to reports when the report fails to load', async () => {
    mockGetById.mockRejectedValue(new Error('boom'));
    await renderEdit();
    await waitFor(() => expect(mockPush).toHaveBeenCalledWith('/reports'));
  });
});
