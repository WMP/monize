import apiClient from './api';
import {
  rethrowStepUpError,
  useStepUpTokenStore,
} from '@/lib/stepUpToken';
import type {
  EmergencyAccessView,
  EmergencyAccessContact,
  EmergencyAccessMessageMetadata,
  UpsertEmergencyAccessSettings,
  UpsertEmergencyAccessContact,
  EmergencyAccessClaimPreview,
} from '@/types/emergency-access';

const STEP_UP_PURPOSE = 'emergency-access';

function stepUpHeader(): Record<string, string> {
  const token = useStepUpTokenStore.getState().getValid(STEP_UP_PURPOSE);
  return token ? { 'X-Step-Up-Token': token } : {};
}

export const emergencyAccessApi = {
  get: async (): Promise<EmergencyAccessView> => {
    const res = await apiClient.get<EmergencyAccessView>('/emergency-access');
    return res.data;
  },

  getMessage: async (): Promise<{ message: string | null }> => {
    try {
      const res = await apiClient.get<{ message: string | null }>(
        '/emergency-access/message',
        { headers: stepUpHeader() },
      );
      return res.data;
    } catch (error) {
      rethrowStepUpError(error);
    }
  },

  updateMessage: async (
    message: string | null,
  ): Promise<EmergencyAccessMessageMetadata> => {
    try {
      const res = await apiClient.put<EmergencyAccessMessageMetadata>(
        '/emergency-access/message',
        { message },
        { headers: stepUpHeader() },
      );
      return res.data;
    } catch (error) {
      rethrowStepUpError(error);
    }
  },

  // Step-up gated, like the message calls above: who receives emergency access
  // and after how long is the security content of this feature, and it used to be
  // changeable with nothing but a session. `reset` below stays ungated on purpose
  // -- it only ever takes access away.
  updateSettings: async (
    payload: UpsertEmergencyAccessSettings,
  ): Promise<EmergencyAccessView> => {
    try {
      const res = await apiClient.put<EmergencyAccessView>(
        '/emergency-access/settings',
        payload,
        { headers: stepUpHeader() },
      );
      return res.data;
    } catch (error) {
      rethrowStepUpError(error);
    }
  },

  addContact: async (
    payload: UpsertEmergencyAccessContact,
  ): Promise<EmergencyAccessContact> => {
    try {
      const res = await apiClient.post<EmergencyAccessContact>(
        '/emergency-access/contacts',
        payload,
        { headers: stepUpHeader() },
      );
      return res.data;
    } catch (error) {
      rethrowStepUpError(error);
    }
  },

  updateContact: async (
    id: string,
    payload: UpsertEmergencyAccessContact,
  ): Promise<EmergencyAccessContact> => {
    try {
      const res = await apiClient.patch<EmergencyAccessContact>(
        `/emergency-access/contacts/${id}`,
        payload,
        { headers: stepUpHeader() },
      );
      return res.data;
    } catch (error) {
      rethrowStepUpError(error);
    }
  },

  removeContact: async (id: string): Promise<void> => {
    try {
      await apiClient.delete(`/emergency-access/contacts/${id}`, {
        headers: stepUpHeader(),
      });
    } catch (error) {
      rethrowStepUpError(error);
    }
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
