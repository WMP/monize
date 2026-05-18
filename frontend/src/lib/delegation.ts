import apiClient from './api';

export interface DelegateContext {
  userId: string;
  label: string;
  isSelf: boolean;
  ownerHas2FA: boolean;
}

export interface ContextsResponse {
  actingAsUserId: string | null;
  contexts: DelegateContext[];
}

export interface DelegateSummary {
  id: string;
  status: string;
  createdAt: string;
  delegate: {
    id: string;
    email: string | null;
    firstName: string | null;
    lastName: string | null;
    hasPassword: boolean;
  };
  accountIds: string[];
}

export interface CreateDelegatePayload {
  email: string;
  firstName?: string;
  lastName?: string;
  password?: string;
  sendInvite?: boolean;
}

export interface CreateDelegateResponse {
  id: string;
  delegateUserId: string;
  email: string;
  temporaryPassword?: string;
  invited: boolean;
}

export const delegationApi = {
  getContexts: async (): Promise<ContextsResponse> => {
    const res = await apiClient.get<ContextsResponse>('/auth/contexts');
    return res.data;
  },

  switchContext: async (
    targetUserId: string,
  ): Promise<{ actingAsUserId: string | null }> => {
    const res = await apiClient.post('/auth/switch-context', { targetUserId });
    return res.data;
  },

  listDelegates: async (): Promise<DelegateSummary[]> => {
    const res = await apiClient.get<DelegateSummary[]>(
      '/delegation/delegates',
    );
    return res.data;
  },

  createDelegate: async (
    payload: CreateDelegatePayload,
  ): Promise<CreateDelegateResponse> => {
    const res = await apiClient.post('/delegation/delegates', payload);
    return res.data;
  },

  revokeDelegate: async (id: string): Promise<void> => {
    await apiClient.delete(`/delegation/delegates/${id}`);
  },

  setGrants: async (id: string, accountIds: string[]): Promise<void> => {
    await apiClient.put(`/delegation/delegates/${id}/grants`, { accountIds });
  },

  resetPassword: async (
    id: string,
  ): Promise<{ temporaryPassword: string }> => {
    const res = await apiClient.post(
      `/delegation/delegates/${id}/reset-password`,
    );
    return res.data;
  },
};
