import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, fireEvent, waitFor, act } from '@/test/render';
import { AutoMergePayeesDialog } from './AutoMergePayeesDialog';
import { payeesApi } from '@/lib/payees';
import { AutoMergeGroup } from '@/types/payee';

vi.mock('@/lib/payees', () => ({
  payeesApi: {
    getAutoMergePreview: vi.fn().mockResolvedValue([]),
    applyAutoMerge: vi.fn().mockResolvedValue({
      groupsMerged: 0,
      payeesMerged: 0,
      transactionsMigrated: 0,
      aliasesCreated: 0,
      skippedAliases: 0,
    }),
  },
}));

vi.mock('@/lib/logger', () => ({
  createLogger: () => ({ error: vi.fn(), info: vi.fn(), warn: vi.fn(), debug: vi.fn() }),
}));

vi.mock('@/lib/errors', () => ({
  getErrorMessage: (_error: unknown, fallback: string) => fallback,
}));

const mockPreview = vi.mocked(payeesApi.getAutoMergePreview);
const mockApply = vi.mocked(payeesApi.applyAutoMerge);

const lidlGroup: AutoMergeGroup = {
  groupKey: 'LIDL',
  suggestedCanonicalPayeeId: 'p1',
  suggestedName: 'Lidl',
  suggestedAlias: '*LIDL*',
  totalTransactions: 17,
  members: [
    { payeeId: 'p1', name: 'Lidl', transactionCount: 10, isCanonical: true },
    { payeeId: 'p2', name: 'LIDL sp. z o.o.', transactionCount: 2, isCanonical: false },
    { payeeId: 'p3', name: 'LIDL WARSZAWA 0421', transactionCount: 5, isCanonical: false },
  ],
};

describe('AutoMergePayeesDialog', () => {
  const onClose = vi.fn();
  const onSuccess = vi.fn();

  beforeEach(() => {
    vi.clearAllMocks();
    mockPreview.mockResolvedValue([]);
  });

  it('renders the title, description and knobs when open', () => {
    render(<AutoMergePayeesDialog isOpen onClose={onClose} onSuccess={onSuccess} />);
    expect(screen.getByText('Auto-Merge Payees')).toBeInTheDocument();
    expect(screen.getByText('How it works')).toBeInTheDocument();
    expect(screen.getByText(/Minimum Group Size/)).toBeInTheDocument();
    expect(screen.getByText(/Similarity Threshold/)).toBeInTheDocument();
    expect(screen.getByText('Preview Groups')).toBeInTheDocument();
  });

  it('does not render when closed', () => {
    render(<AutoMergePayeesDialog isOpen={false} onClose={onClose} onSuccess={onSuccess} />);
    expect(screen.queryByText('Auto-Merge Payees')).not.toBeInTheDocument();
  });

  it('loads and displays a merge group with its members', async () => {
    mockPreview.mockResolvedValue([lidlGroup]);
    render(<AutoMergePayeesDialog isOpen onClose={onClose} onSuccess={onSuccess} />);

    await act(async () => {
      fireEvent.click(screen.getByText('Preview Groups'));
    });

    await waitFor(() => {
      expect(screen.getByDisplayValue('Lidl')).toBeInTheDocument();
      expect(screen.getByDisplayValue('*LIDL*')).toBeInTheDocument();
      expect(screen.getByText('LIDL sp. z o.o.')).toBeInTheDocument();
      expect(screen.getByText('LIDL WARSZAWA 0421')).toBeInTheDocument();
    });
    expect(mockPreview).toHaveBeenCalledWith({
      minGroupSize: 2,
      similarityThreshold: 0.85,
      minTokenLength: 3,
      includeInactive: false,
    });
  });

  it('applies the merge with the canonical and sources derived from selection', async () => {
    mockPreview.mockResolvedValue([lidlGroup]);
    mockApply.mockResolvedValue({
      groupsMerged: 1,
      payeesMerged: 2,
      transactionsMigrated: 7,
      aliasesCreated: 1,
      skippedAliases: 0,
    });
    render(<AutoMergePayeesDialog isOpen onClose={onClose} onSuccess={onSuccess} />);

    await act(async () => {
      fireEvent.click(screen.getByText('Preview Groups'));
    });
    await waitFor(() => expect(screen.getByDisplayValue('Lidl')).toBeInTheDocument());

    await act(async () => {
      fireEvent.click(screen.getByText(/Merge 1 Group/));
    });

    await waitFor(() => expect(mockApply).toHaveBeenCalled());
    expect(mockApply).toHaveBeenCalledWith([
      {
        canonicalPayeeId: 'p1',
        canonicalName: 'Lidl',
        sourcePayeeIds: ['p2', 'p3'],
        alias: '*LIDL*',
      },
    ]);
    expect(onSuccess).toHaveBeenCalled();
    expect(onClose).toHaveBeenCalled();
  });

  it('shows the empty state when no groups are found', async () => {
    mockPreview.mockResolvedValue([]);
    render(<AutoMergePayeesDialog isOpen onClose={onClose} onSuccess={onSuccess} />);

    await act(async () => {
      fireEvent.click(screen.getByText('Preview Groups'));
    });

    await waitFor(() =>
      expect(
        screen.getByText('No merge groups match the current criteria.'),
      ).toBeInTheDocument(),
    );
  });

  it('excludes a member from the merge when its checkbox is unchecked', async () => {
    mockPreview.mockResolvedValue([lidlGroup]);
    mockApply.mockResolvedValue({
      groupsMerged: 1,
      payeesMerged: 1,
      transactionsMigrated: 5,
      aliasesCreated: 1,
      skippedAliases: 0,
    });
    render(<AutoMergePayeesDialog isOpen onClose={onClose} onSuccess={onSuccess} />);

    await act(async () => {
      fireEvent.click(screen.getByText('Preview Groups'));
    });
    await waitFor(() => expect(screen.getByDisplayValue('Lidl')).toBeInTheDocument());

    // Uncheck the "include in merge" checkbox for p2 (LIDL sp. z o.o.).
    // Index 0 is the canonical (p1, disabled); index 1 is p2.
    const includeCheckboxes = screen.getAllByLabelText('Include in merge');
    await act(async () => {
      fireEvent.click(includeCheckboxes[1]);
    });

    await act(async () => {
      fireEvent.click(screen.getByText(/Merge 1 Group/));
    });

    await waitFor(() => expect(mockApply).toHaveBeenCalled());
    expect(mockApply).toHaveBeenCalledWith([
      {
        canonicalPayeeId: 'p1',
        canonicalName: 'Lidl',
        sourcePayeeIds: ['p3'],
        alias: '*LIDL*',
      },
    ]);
  });
});
