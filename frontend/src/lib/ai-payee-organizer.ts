import apiClient from './api';

export interface PayeeCategorySuggestion {
  payeeId: string;
  payeeName: string;
  categoryId: string | null;
  categoryName: string;
  isNew: boolean;
  /** Recent transaction descriptions for context when reviewing the suggestion. */
  sampleDescriptions: string[];
}

export interface PayeeMergeDuplicate {
  payeeId: string;
  name: string;
}

export interface PayeeMergeGroup {
  canonicalPayeeId: string;
  canonicalName: string;
  duplicates: PayeeMergeDuplicate[];
  reason: string;
}

/** A payee in a unified review group (a cluster member or a singleton). */
export interface PayeeGroupMember {
  payeeId: string;
  payeeName: string;
  sampleDescriptions: string[];
  /** True when the payee already has a default category. */
  hasCategory: boolean;
}

/** The AI's category suggestion for a group's surviving payee. */
export interface PayeeGroupCategory {
  categoryId: string | null;
  categoryName: string;
  isNew: boolean;
}

/** One row in the unified organizer: a single payee or a likely-duplicate cluster. */
export interface PayeeGroup {
  /** canonicalPayeeId for clusters, else the single payee's id. */
  groupId: string;
  /** True when the group has >= 2 members. */
  isCluster: boolean;
  /** Default canonical (survivor) for the group. */
  suggestedCanonicalPayeeId: string;
  /** Why the cluster's members are the same merchant (clusters only). */
  mergeReason: string | null;
  members: PayeeGroupMember[];
  /** Category suggestion for the surviving payee, or null when none. */
  category: PayeeGroupCategory | null;
}

export interface PayeeOrganizerSuggestResponse {
  /** Back-compat shape (still emitted for MCP/assistant consumers). */
  categorySuggestions: PayeeCategorySuggestion[];
  /** Back-compat shape (still emitted for MCP/assistant consumers). */
  mergeGroups: PayeeMergeGroup[];
  /** Unified cluster-and-singleton view consumed by the organizer UI. */
  groups: PayeeGroup[];
  model: string;
  /** Duplicate candidate clusters that exist beyond those analysed this run.
   * When > 0 the user can run "Analyze" again to surface the next set. */
  mergeCandidateClustersRemaining?: number;
}

export interface PayeeOrganizerSuggestRequest {
  allowNewCategories: boolean;
  /** Max uncategorized payees to analyse in this run (small = fits low-TPM providers). */
  limit?: number;
  /** 'all' (default) = categories + duplicates; 'merge' = duplicates only (cheaper). */
  mode?: 'all' | 'merge';
  /** Only suggest categories for payees with at least this many transactions (0 = no minimum). */
  minTransactions?: number;
}

export interface PayeeCategoryAssignment {
  payeeId: string;
  categoryId?: string;
  newCategoryName?: string;
}

export interface PayeeMerge {
  targetPayeeId: string;
  sourcePayeeIds: string[];
}

export interface RejectedMerge {
  canonicalPayeeId: string;
  duplicatePayeeIds: string[];
}

export interface PayeeOrganizerApplyRequest {
  categoryAssignments: PayeeCategoryAssignment[];
  merges: PayeeMerge[];
  /** Merge groups the user marked "Not a duplicate"; persisted so they are
   * never re-suggested. */
  rejectedMerges?: RejectedMerge[];
}

export interface PayeeOrganizerApplyResponse {
  categoriesCreated: number;
  payeesCategorized: number;
  payeesMerged: number;
  mergeRejectionsSaved: number;
}

export const payeeOrganizerApi = {
  suggest: async (
    body: PayeeOrganizerSuggestRequest,
  ): Promise<PayeeOrganizerSuggestResponse> => {
    // The LLM call can take many seconds, so override the default 10s timeout.
    const response = await apiClient.post<PayeeOrganizerSuggestResponse>(
      '/ai/payee-organizer/suggest',
      body,
      { timeout: 120000 },
    );
    return response.data;
  },

  apply: async (
    body: PayeeOrganizerApplyRequest,
  ): Promise<PayeeOrganizerApplyResponse> => {
    const response = await apiClient.post<PayeeOrganizerApplyResponse>(
      '/ai/payee-organizer/apply',
      body,
      { timeout: 120000 },
    );
    return response.data;
  },
};
