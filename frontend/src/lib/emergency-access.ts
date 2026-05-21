import apiClient from './api';
import type {
  EmergencyAccessView,
  EmergencyAccessContact,
  UpsertEmergencyAccessSettings,
  UpsertEmergencyAccessContact,
  EmergencyAccessClaimPreview,
} from '@/types/emergency-access';

export const emergencyAccessApi = {
  get: async (): Promise<EmergencyAccessView> => {
    const res = await apiClient.get<EmergencyAccessView>('/emergency-access');
    return res.data;
  },

  updateSettings: async (
    payload: UpsertEmergencyAccessSettings,
  ): Promise<EmergencyAccessView> => {
    const res = await apiClient.put<EmergencyAccessView>(
      '/emergency-access/settings',
      payload,
    );
    return res.data;
  },

  addContact: async (
    payload: UpsertEmergencyAccessContact,
  ): Promise<EmergencyAccessContact> => {
    const res = await apiClient.post<EmergencyAccessContact>(
      '/emergency-access/contacts',
      payload,
    );
    return res.data;
  },

  updateContact: async (
    id: string,
    payload: UpsertEmergencyAccessContact,
  ): Promise<EmergencyAccessContact> => {
    const res = await apiClient.patch<EmergencyAccessContact>(
      `/emergency-access/contacts/${id}`,
      payload,
    );
    return res.data;
  },

  removeContact: async (id: string): Promise<void> => {
    await apiClient.delete(`/emergency-access/contacts/${id}`);
  },

  reset: async (): Promise<EmergencyAccessView> => {
    const res = await apiClient.post<EmergencyAccessView>(
      '/emergency-access/reset',
    );
    return res.data;
  },

  previewClaim: async (token: string): Promise<EmergencyAccessClaimPreview> => {
    const res = await apiClient.post<EmergencyAccessClaimPreview>(
      '/emergency-access/claim/preview',
      { token },
    );
    return res.data;
  },

  completeClaim: async (
    token: string,
    newPassword: string,
  ): Promise<void> => {
    await apiClient.post('/emergency-access/claim/complete', {
      token,
      newPassword,
    });
  },
};
