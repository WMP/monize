import apiClient from './api';
import { AdminUser } from '@/types/auth';

export interface ResetPasswordResponse {
  temporaryPassword: string;
}

export interface CreateUserPayload {
  email: string;
  firstName?: string;
  lastName?: string;
  password?: string;
  sendInvite?: boolean;
  role?: 'admin' | 'user';
}

export interface CreateUserResponse extends AdminUser {
  temporaryPassword?: string;
  invited: boolean;
  upgraded: boolean;
}

export const adminApi = {
  getUsers: async (): Promise<AdminUser[]> => {
    const response = await apiClient.get<AdminUser[]>('/admin/users');
    return response.data;
  },

  createUser: async (
    payload: CreateUserPayload,
  ): Promise<CreateUserResponse> => {
    const response = await apiClient.post<CreateUserResponse>(
      '/admin/users',
      payload,
    );
    return response.data;
  },

  updateUserRole: async (
    userId: string,
    role: 'admin' | 'user',
  ): Promise<AdminUser> => {
    const response = await apiClient.patch<AdminUser>(
      `/admin/users/${userId}/role`,
      { role },
    );
    return response.data;
  },

  updateUserStatus: async (
    userId: string,
    isActive: boolean,
  ): Promise<AdminUser> => {
    const response = await apiClient.patch<AdminUser>(
      `/admin/users/${userId}/status`,
      { isActive },
    );
    return response.data;
  },

  deleteUser: async (userId: string): Promise<{ downgraded: boolean }> => {
    const response = await apiClient.delete<{ downgraded: boolean }>(
      `/admin/users/${userId}`,
    );
    return response.data;
  },

  resetUserPassword: async (
    userId: string,
  ): Promise<ResetPasswordResponse> => {
    const response = await apiClient.post<ResetPasswordResponse>(
      `/admin/users/${userId}/reset-password`,
    );
    return response.data;
  },
};
