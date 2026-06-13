import apiClient from './api';

/**
 * AI suggestion sessions: drafts an external LLM saved via the Monize MCP
 * tools (e.g. payee category suggestions) for the user to review and apply.
 */

export type SuggestionSessionKind = 'payee_categorization';
export type SuggestionSessionStatus = 'draft' | 'review' | 'applied';

export interface SuggestionSessionSummary {
  id: string;
  kind: SuggestionSessionKind;
  status: SuggestionSessionStatus;
  title: string | null;
  itemCount: number;
  createdAt: string;
  updatedAt: string;
}

export interface SuggestionSessionItem {
  payeeId: string;
  payeeName: string;
  suggestedCategoryId: string | null;
  suggestedCategoryName: string | null;
  newCategoryName: string | null;
  reason: string | null;
  confidence: number | null;
  sampleDescriptions: string[];
}

export interface SuggestionSession {
  id: string;
  kind: SuggestionSessionKind;
  status: SuggestionSessionStatus;
  title: string | null;
  createdAt: string;
  updatedAt: string;
  items: SuggestionSessionItem[];
}

export interface ApplySuggestionItem {
  payeeId: string;
  categoryId?: string;
  newCategoryName?: string;
}

export interface ApplySuggestionResult {
  categoriesCreated: number;
  payeesCategorized: number;
}

interface ListSuggestionSessionsParams {
  kind?: SuggestionSessionKind;
  status?: SuggestionSessionStatus;
}

export const aiSuggestionSessionsApi = {
  // List suggestion sessions, optionally filtered by kind and status.
  list: async (
    params: ListSuggestionSessionsParams = {},
  ): Promise<SuggestionSessionSummary[]> => {
    const response = await apiClient.get<SuggestionSessionSummary[]>(
      '/ai/suggestion-sessions',
      { params },
    );
    return response.data;
  },

  // Get a single suggestion session with its items.
  getById: async (id: string): Promise<SuggestionSession> => {
    const response = await apiClient.get<SuggestionSession>(
      `/ai/suggestion-sessions/${id}`,
    );
    return response.data;
  },

  // Apply the chosen items: each resolves to an existing category or a new one.
  apply: async (
    id: string,
    items: ApplySuggestionItem[],
  ): Promise<ApplySuggestionResult> => {
    const response = await apiClient.post<ApplySuggestionResult>(
      `/ai/suggestion-sessions/${id}/apply`,
      { items },
    );
    return response.data;
  },

  // Discard a suggestion session.
  remove: async (id: string): Promise<void> => {
    await apiClient.delete(`/ai/suggestion-sessions/${id}`);
  },
};
