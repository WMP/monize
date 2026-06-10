import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, fireEvent, waitFor, act } from '@/test/render';
import { PayeeOrganizer } from './PayeeOrganizer';
import { payeeOrganizerApi } from '@/lib/ai-payee-organizer';
import type { PayeeOrganizerSuggestResponse } from '@/lib/ai-payee-organizer';
import { payeesApi } from '@/lib/payees';

vi.mock('@/lib/ai-payee-organizer', () => ({
  payeeOrganizerApi: {
    suggest: vi.fn(),
    apply: vi.fn(),
  },
}));

// The category picker fetches the user's categories; the payee dialog fetches
// and updates individual payees.
vi.mock('@/lib/categories', () => ({
  categoriesApi: {
    getAll: vi.fn().mockResolvedValue([
      { id: 'c1', name: 'Groceries', parentId: null },
      { id: 'c2', name: 'Transport', parentId: null },
    ]),
  },
}));

vi.mock('@/lib/payees', () => ({
  payeesApi: {
    getById: vi.fn(),
    update: vi.fn(),
  },
}));

const mockedApi = vi.mocked(payeeOrganizerApi);
const mockedPayees = vi.mocked(payeesApi);

// One cluster (Lidl) and one singleton (Biedronka).
const SUGGEST_RESPONSE: PayeeOrganizerSuggestResponse = {
  model: 'test-model',
  categorySuggestions: [],
  mergeGroups: [],
  groups: [
    {
      groupId: 'p-lidl',
      isCluster: true,
      suggestedCanonicalPayeeId: 'p-lidl',
      mergeReason: 'Same merchant, different spellings',
      members: [
        {
          payeeId: 'p-lidl',
          payeeName: 'Lidl',
          sampleDescriptions: [],
          hasCategory: false,
        },
        {
          payeeId: 'p-lidl-caps',
          payeeName: 'LIDL Warszawa',
          sampleDescriptions: [],
          hasCategory: false,
        },
      ],
      category: {
        categoryId: 'c1',
        categoryName: 'Groceries',
        isNew: false,
      },
    },
    {
      groupId: 'p-biedronka',
      isCluster: false,
      suggestedCanonicalPayeeId: 'p-biedronka',
      mergeReason: null,
      members: [
        {
          payeeId: 'p-biedronka',
          payeeName: 'Biedronka',
          sampleDescriptions: ['BIEDRONKA 123'],
          hasCategory: false,
        },
      ],
      category: { categoryId: 'c1', categoryName: 'Groceries', isNew: false },
    },
  ],
  mergeCandidateClustersRemaining: 3,
};

async function analyze() {
  await act(async () => {
    fireEvent.click(screen.getByRole('button', { name: 'Analyze' }));
  });
  await waitFor(() => expect(screen.getByText('Biedronka')).toBeInTheDocument());
}

describe('PayeeOrganizer', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockedApi.suggest.mockResolvedValue(SUGGEST_RESPONSE);
    mockedApi.apply.mockResolvedValue({
      categoriesCreated: 0,
      payeesCategorized: 2,
      payeesMerged: 1,
      mergeRejectionsSaved: 0,
    });
  });

  it('sends a single mode=all Analyze request with the controls', async () => {
    render(<PayeeOrganizer />);
    await analyze();
    expect(mockedApi.suggest).toHaveBeenCalledWith({
      allowNewCategories: false,
      limit: 50,
      mode: 'all',
      minTransactions: 0,
    });
  });

  it('sends allowNewCategories=true when the toggle is on', async () => {
    render(<PayeeOrganizer />);
    await act(async () => {
      fireEvent.click(
        screen.getByRole('switch', {
          name: 'Allow AI to propose new categories',
        }),
      );
    });
    await analyze();
    expect(mockedApi.suggest).toHaveBeenCalledWith({
      allowNewCategories: true,
      limit: 50,
      mode: 'all',
      minTransactions: 0,
    });
  });

  it('shows how many more duplicate groups remain to analyse', async () => {
    render(<PayeeOrganizer />);
    await analyze();
    const note = screen.getByText(
      (_content, element) =>
        element?.tagName === 'P' &&
        /3\s*more duplicate group/i.test(element.textContent ?? '') &&
        /Analyze again/i.test(element.textContent ?? ''),
    );
    expect(note).toBeInTheDocument();
  });

  it('renders a cluster with members, a canonical radio, and a category picker', async () => {
    render(<PayeeOrganizer />);
    await analyze();

    // Cluster header and member names ("Lidl" appears in the header and as the
    // canonical member button).
    expect(screen.getAllByText('Lidl').length).toBeGreaterThan(0);
    expect(screen.getByText('LIDL Warszawa')).toBeInTheDocument();
    expect(
      screen.getByText('Same merchant, different spellings'),
    ).toBeInTheDocument();

    // A radio per member; the suggested canonical is selected by default.
    expect(screen.getByRole('radio', { name: 'Keep Lidl' })).toBeChecked();
    expect(
      screen.getByRole('radio', { name: 'Keep LIDL Warszawa' }),
    ).not.toBeChecked();

    // The category picker defaults to the AI suggestion.
    await waitFor(() =>
      expect(screen.getAllByDisplayValue('Groceries').length).toBeGreaterThan(
        0,
      ),
    );
  });

  it('renders a singleton with a category picker', async () => {
    render(<PayeeOrganizer />);
    await analyze();

    expect(screen.getByText('Biedronka')).toBeInTheDocument();
    expect(
      screen.getByLabelText('Apply category for Biedronka'),
    ).toBeInTheDocument();
  });

  it('opens the PayeeForm dialog when a payee name is clicked', async () => {
    mockedPayees.getById.mockResolvedValue({
      id: 'p-biedronka',
      userId: 'u1',
      name: 'Biedronka',
      defaultCategoryId: null,
      defaultCategory: null,
      notes: null,
      isActive: true,
      createdAt: '2024-01-01',
    });

    render(<PayeeOrganizer />);
    await analyze();

    await act(async () => {
      fireEvent.click(screen.getByText('Biedronka'));
    });

    await waitFor(() =>
      expect(mockedPayees.getById).toHaveBeenCalledWith('p-biedronka'),
    );
    await waitFor(() =>
      expect(screen.getByText('Edit payee')).toBeInTheDocument(),
    );
  });

  it('applies a checked cluster with the right merges + categoryAssignments', async () => {
    render(<PayeeOrganizer />);
    await analyze();

    // Check the cluster group's apply checkbox.
    await act(async () => {
      fireEvent.click(screen.getByLabelText('Apply group p-lidl'));
    });

    await act(async () => {
      fireEvent.click(screen.getByRole('button', { name: 'Apply selected' }));
    });

    await waitFor(() => expect(mockedApi.apply).toHaveBeenCalled());
    expect(mockedApi.apply).toHaveBeenCalledWith({
      categoryAssignments: [{ payeeId: 'p-lidl', categoryId: 'c1' }],
      merges: [{ targetPayeeId: 'p-lidl', sourcePayeeIds: ['p-lidl-caps'] }],
      rejectedMerges: [],
    });
  });

  it('merges into the chosen canonical when the radio is changed', async () => {
    render(<PayeeOrganizer />);
    await analyze();

    // Pick the other member as canonical.
    await act(async () => {
      fireEvent.click(
        screen.getByRole('radio', { name: 'Keep LIDL Warszawa' }),
      );
    });
    await act(async () => {
      fireEvent.click(screen.getByLabelText('Apply group p-lidl'));
    });
    await act(async () => {
      fireEvent.click(screen.getByRole('button', { name: 'Apply selected' }));
    });

    await waitFor(() => expect(mockedApi.apply).toHaveBeenCalled());
    expect(mockedApi.apply).toHaveBeenCalledWith({
      categoryAssignments: [{ payeeId: 'p-lidl-caps', categoryId: 'c1' }],
      merges: [{ targetPayeeId: 'p-lidl-caps', sourcePayeeIds: ['p-lidl'] }],
      rejectedMerges: [],
    });
  });

  it('marks a cluster "Not duplicates" and sends it in rejectedMerges (no merge)', async () => {
    render(<PayeeOrganizer />);
    await analyze();

    await act(async () => {
      fireEvent.click(
        screen.getByRole('button', { name: 'Not duplicates: Lidl' }),
      );
    });

    // The rejected cluster's apply checkbox is disabled.
    expect(screen.getByLabelText('Apply group p-lidl')).toBeDisabled();

    await act(async () => {
      fireEvent.click(screen.getByRole('button', { name: 'Apply selected' }));
    });

    await waitFor(() => expect(mockedApi.apply).toHaveBeenCalled());
    expect(mockedApi.apply).toHaveBeenCalledWith({
      categoryAssignments: [],
      merges: [],
      rejectedMerges: [
        { canonicalPayeeId: 'p-lidl', duplicatePayeeIds: ['p-lidl-caps'] },
      ],
    });
  });

  it('applies only the checked singleton (default is none selected)', async () => {
    render(<PayeeOrganizer />);
    await analyze();

    await act(async () => {
      fireEvent.click(screen.getByLabelText('Apply category for Biedronka'));
    });
    await act(async () => {
      fireEvent.click(screen.getByRole('button', { name: 'Apply selected' }));
    });

    await waitFor(() => expect(mockedApi.apply).toHaveBeenCalled());
    expect(mockedApi.apply).toHaveBeenCalledWith({
      categoryAssignments: [{ payeeId: 'p-biedronka', categoryId: 'c1' }],
      merges: [],
      rejectedMerges: [],
    });
  });

  it('shows an empty state when there are no groups', async () => {
    mockedApi.suggest.mockResolvedValue({
      model: 'test-model',
      categorySuggestions: [],
      mergeGroups: [],
      groups: [],
    });
    render(<PayeeOrganizer />);
    await act(async () => {
      fireEvent.click(screen.getByRole('button', { name: 'Analyze' }));
    });
    await waitFor(() =>
      expect(screen.getByText('Nothing to review')).toBeInTheDocument(),
    );
  });

  it('surfaces an error toast when analysis fails', async () => {
    const toast = (await import('react-hot-toast')).default;
    mockedApi.suggest.mockRejectedValue({
      response: { data: { message: 'No AI provider configured' } },
    });
    render(<PayeeOrganizer />);
    await act(async () => {
      fireEvent.click(screen.getByRole('button', { name: 'Analyze' }));
    });
    await act(async () => {});
    await waitFor(() =>
      expect(toast.error).toHaveBeenCalledWith('No AI provider configured'),
    );
  });
});
