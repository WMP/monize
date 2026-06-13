import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, fireEvent, waitFor, act } from '@/test/render';
import { PayeeSuggestionReview } from './PayeeSuggestionReview';
import { aiSuggestionSessionsApi } from '@/lib/ai-suggestion-sessions';
import { categoriesApi } from '@/lib/categories';
import { Category } from '@/types/category';
import toast from 'react-hot-toast';

vi.mock('@/lib/ai-suggestion-sessions', () => ({
  aiSuggestionSessionsApi: {
    list: vi.fn(),
    getById: vi.fn(),
    apply: vi.fn(),
    remove: vi.fn(),
  },
}));

vi.mock('@/lib/categories', () => ({
  categoriesApi: {
    getAll: vi.fn(),
  },
}));

const mockedList = vi.mocked(aiSuggestionSessionsApi.list);
const mockedGetById = vi.mocked(aiSuggestionSessionsApi.getById);
const mockedApply = vi.mocked(aiSuggestionSessionsApi.apply);
const mockedRemove = vi.mocked(aiSuggestionSessionsApi.remove);
const mockedGetCategories = vi.mocked(categoriesApi.getAll);

const categories: Category[] = [
  {
    id: 'cat-groceries',
    userId: 'u1',
    parentId: null,
    parent: null,
    children: [],
    name: 'Groceries',
    description: null,
    icon: null,
    color: null,
    effectiveColor: null,
    isIncome: false,
    isSystem: false,
    createdAt: '2024-01-01',
  },
];

const session = {
  id: 'sess-1',
  kind: 'payee_categorization' as const,
  status: 'draft' as const,
  title: 'Draft set',
  createdAt: '2024-01-01',
  updatedAt: '2024-01-02',
  items: [
    {
      payeeId: 'payee-1',
      payeeName: 'Whole Foods',
      suggestedCategoryId: 'cat-groceries',
      suggestedCategoryName: 'Groceries',
      newCategoryName: null,
      reason: 'Grocery store',
      confidence: 0.92,
      sampleDescriptions: ['WHOLEFDS #123', 'WHOLE FOODS MKT'],
    },
    {
      payeeId: 'payee-2',
      payeeName: 'Acme Streaming',
      suggestedCategoryId: null,
      suggestedCategoryName: null,
      newCategoryName: 'Streaming',
      reason: null,
      confidence: null,
      sampleDescriptions: [],
    },
  ],
};

async function renderReview() {
  let result: ReturnType<typeof render>;
  await act(async () => {
    result = render(<PayeeSuggestionReview />);
  });
  return result!;
}

describe('PayeeSuggestionReview', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockedGetCategories.mockResolvedValue(categories);
  });

  it('shows the empty state when there are no draft sessions', async () => {
    mockedList.mockResolvedValue([]);

    await renderReview();

    expect(screen.getByText('No suggestions to review')).toBeInTheDocument();
    expect(screen.getByText(/Use the Monize MCP tools/)).toBeInTheDocument();
    expect(mockedGetById).not.toHaveBeenCalled();
  });

  it('auto-opens the most recent session and pre-selects the suggested category', async () => {
    mockedList.mockResolvedValue([
      {
        id: 'sess-1',
        kind: 'payee_categorization',
        status: 'draft',
        title: 'Draft set',
        itemCount: 2,
        createdAt: '2024-01-01',
        updatedAt: '2024-01-02',
      },
    ]);
    mockedGetById.mockResolvedValue(session);

    await renderReview();

    expect(mockedGetById).toHaveBeenCalledWith('sess-1');
    expect(screen.getByText('Whole Foods')).toBeInTheDocument();
    expect(screen.getByText('Acme Streaming')).toBeInTheDocument();
    // Existing suggestion pre-selected in the Combobox input
    expect(screen.getByDisplayValue('Groceries')).toBeInTheDocument();
    // New-category suggestion pre-fills the sentinel name
    expect(screen.getByDisplayValue('Streaming')).toBeInTheDocument();
    // Checkboxes default to unselected
    const checkboxes = screen.getAllByRole('checkbox');
    expect(checkboxes.every((cb) => !(cb as HTMLInputElement).checked)).toBe(
      true,
    );
  });

  it('applies only the ticked rows with the resolved payload', async () => {
    mockedList.mockResolvedValue([
      {
        id: 'sess-1',
        kind: 'payee_categorization',
        status: 'draft',
        title: 'Draft set',
        itemCount: 2,
        createdAt: '2024-01-01',
        updatedAt: '2024-01-02',
      },
    ]);
    mockedGetById.mockResolvedValue(session);
    mockedApply.mockResolvedValue({ categoriesCreated: 1, payeesCategorized: 1 });

    await renderReview();

    const checkboxes = screen.getAllByRole('checkbox');
    await act(async () => {
      fireEvent.click(checkboxes[0]); // Whole Foods -> existing category
      fireEvent.click(checkboxes[1]); // Acme Streaming -> new category
    });

    await act(async () => {
      fireEvent.click(screen.getByText('Apply selected'));
    });

    await waitFor(() =>
      expect(mockedApply).toHaveBeenCalledWith('sess-1', [
        { payeeId: 'payee-1', categoryId: 'cat-groceries' },
        { payeeId: 'payee-2', newCategoryName: 'Streaming' },
      ]),
    );
    expect(toast.success).toHaveBeenCalled();
  });

  it('discards the session after confirming', async () => {
    mockedList.mockResolvedValue([
      {
        id: 'sess-1',
        kind: 'payee_categorization',
        status: 'draft',
        title: 'Draft set',
        itemCount: 2,
        createdAt: '2024-01-01',
        updatedAt: '2024-01-02',
      },
    ]);
    mockedGetById.mockResolvedValue(session);
    mockedRemove.mockResolvedValue(undefined);

    await renderReview();

    await act(async () => {
      fireEvent.click(screen.getByText('Discard'));
    });

    // Confirm in the dialog (second "Discard" is the confirm button)
    const discardButtons = screen.getAllByText('Discard');
    await act(async () => {
      fireEvent.click(discardButtons[discardButtons.length - 1]);
    });

    await waitFor(() =>
      expect(mockedRemove).toHaveBeenCalledWith('sess-1'),
    );
  });
});
