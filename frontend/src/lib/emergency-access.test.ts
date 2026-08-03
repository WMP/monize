import { describe, it, expect, vi, beforeEach } from 'vitest';

vi.mock('./api', () => ({
  default: {
    get: vi.fn(),
    post: vi.fn(),
    put: vi.fn(),
    patch: vi.fn(),
    delete: vi.fn(),
  },
}));

import apiClient from './api';
import { emergencyAccessApi } from './emergency-access';
import { StepUpRequiredError, useStepUpTokenStore } from './stepUpToken';

type MockClient = Record<string, ReturnType<typeof vi.fn>>;
const client = apiClient as unknown as MockClient;

describe('emergencyAccessApi', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    useStepUpTokenStore.getState().clearAll();
  });

  it('get() GETs /emergency-access and returns the body', async () => {
    client.get.mockResolvedValue({ data: { enabled: true } });
    const result = await emergencyAccessApi.get();
    expect(client.get).toHaveBeenCalledWith('/emergency-access');
    expect(result).toEqual({ enabled: true });
  });

  it('getMessage() GETs /emergency-access/message without a step-up header when none is set', async () => {
    client.get.mockResolvedValue({ data: { message: 'hi' } });
    const result = await emergencyAccessApi.getMessage();
    expect(client.get).toHaveBeenCalledWith('/emergency-access/message', {
      headers: {},
    });
    expect(result).toEqual({ message: 'hi' });
  });

  it('getMessage() attaches X-Step-Up-Token when a valid token is in the store', async () => {
    useStepUpTokenStore
      .getState()
      .set(
        'emergency-access',
        'tok-123',
        new Date(Date.now() + 5 * 60 * 1000).toISOString(),
      );
    client.get.mockResolvedValue({ data: { message: 'secret' } });
    await emergencyAccessApi.getMessage();
    expect(client.get).toHaveBeenCalledWith('/emergency-access/message', {
      headers: { 'X-Step-Up-Token': 'tok-123' },
    });
  });

  it('getMessage() rethrows a STEP_UP_REQUIRED error as a typed StepUpRequiredError', async () => {
    client.get.mockRejectedValue({
      response: {
        status: 403,
        data: { code: 'STEP_UP_REQUIRED', purpose: 'emergency-access' },
      },
    });
    await expect(emergencyAccessApi.getMessage()).rejects.toBeInstanceOf(
      StepUpRequiredError,
    );
  });

  it('getMessage() rethrows STEP_UP_EXPIRED as a typed StepUpRequiredError', async () => {
    client.get.mockRejectedValue({
      response: {
        status: 403,
        data: { code: 'STEP_UP_EXPIRED', purpose: 'emergency-access' },
      },
    });
    await expect(emergencyAccessApi.getMessage()).rejects.toMatchObject({
      reason: 'expired',
    });
  });

  it('getMessage() rethrows other errors unchanged', async () => {
    const original = new Error('boom');
    client.get.mockRejectedValue(original);
    await expect(emergencyAccessApi.getMessage()).rejects.toBe(original);
  });

  it('updateMessage() PUTs the body and headers', async () => {
    useStepUpTokenStore
      .getState()
      .set(
        'emergency-access',
        'tok-abc',
        new Date(Date.now() + 60_000).toISOString(),
      );
    client.put.mockResolvedValue({
      data: { hasMessage: true, charCount: 3, updatedAt: null },
    });
    await emergencyAccessApi.updateMessage('hi!');
    expect(client.put).toHaveBeenCalledWith(
      '/emergency-access/message',
      { message: 'hi!' },
      { headers: { 'X-Step-Up-Token': 'tok-abc' } },
    );
  });

  it('updateMessage() rethrows STEP_UP_INVALID as a typed error', async () => {
    client.put.mockRejectedValue({
      response: {
        status: 403,
        data: { code: 'STEP_UP_INVALID', purpose: 'emergency-access' },
      },
    });
    await expect(emergencyAccessApi.updateMessage('hi')).rejects.toMatchObject({
      reason: 'invalid',
    });
  });

  /**
   * Who receives emergency access and after how long is the security content of
   * this feature, and it used to be changeable with nothing but a session -- while
   * the message inside it, the least sensitive part, was step-up gated. All four
   * configuration calls now carry the token and surface a step-up rejection as a
   * typed error the page turns into the prompt.
   */
  describe('configuration calls are step-up gated', () => {
    const seedToken = () =>
      useStepUpTokenStore
        .getState()
        .set(
          'emergency-access',
          'tok-cfg',
          new Date(Date.now() + 60_000).toISOString(),
        );

    it('updateSettings() PUTs the payload with the step-up header', async () => {
      seedToken();
      client.put.mockResolvedValue({ data: { enabled: false } });
      const payload = {
        enabled: false,
        grantAfterDays: 14,
        reminderAfterDays: 7,
      };
      const result = await emergencyAccessApi.updateSettings(payload);
      expect(client.put).toHaveBeenCalledWith(
        '/emergency-access/settings',
        payload,
        { headers: { 'X-Step-Up-Token': 'tok-cfg' } },
      );
      expect(result).toEqual({ enabled: false });
    });

    it('addContact() POSTs with the step-up header', async () => {
      seedToken();
      client.post.mockResolvedValue({
        data: { id: 'c1', firstName: 'Carol', email: 'c@x.com' },
      });
      const payload = { firstName: 'Carol', email: 'c@x.com' };
      await emergencyAccessApi.addContact(payload);
      expect(client.post).toHaveBeenCalledWith(
        '/emergency-access/contacts',
        payload,
        { headers: { 'X-Step-Up-Token': 'tok-cfg' } },
      );
    });

    it('updateContact() PATCHes with the step-up header', async () => {
      seedToken();
      client.patch.mockResolvedValue({ data: { id: 'c1' } });
      await emergencyAccessApi.updateContact('c1', {
        firstName: 'Carol',
        email: 'c@x.com',
      });
      expect(client.patch).toHaveBeenCalledWith(
        '/emergency-access/contacts/c1',
        { firstName: 'Carol', email: 'c@x.com' },
        { headers: { 'X-Step-Up-Token': 'tok-cfg' } },
      );
    });

    it('removeContact() DELETEs with the step-up header', async () => {
      seedToken();
      client.delete.mockResolvedValue({ data: { ok: true } });
      await emergencyAccessApi.removeContact('c1');
      expect(client.delete).toHaveBeenCalledWith(
        '/emergency-access/contacts/c1',
        { headers: { 'X-Step-Up-Token': 'tok-cfg' } },
      );
    });

    it.each([
      ['updateSettings', 'put', () =>
        emergencyAccessApi.updateSettings({
          enabled: true,
          grantAfterDays: 2,
          reminderAfterDays: 1,
        })],
      ['addContact', 'post', () =>
        emergencyAccessApi.addContact({ firstName: 'A', email: 'a@x.com' })],
      ['updateContact', 'patch', () =>
        emergencyAccessApi.updateContact('c1', {
          firstName: 'A',
          email: 'a@x.com',
        })],
      ['removeContact', 'delete', () => emergencyAccessApi.removeContact('c1')],
    ])('%s() surfaces STEP_UP_REQUIRED as a typed error', async (
      _label,
      method,
      call,
    ) => {
      client[method].mockRejectedValue({
        response: {
          status: 403,
          data: { code: 'STEP_UP_REQUIRED', purpose: 'emergency-access' },
        },
      });
      await expect(call()).rejects.toBeInstanceOf(StepUpRequiredError);
    });
  });

  it('reset() POSTs /emergency-access/reset', async () => {
    client.post.mockResolvedValue({ data: { enabled: true } });
    const result = await emergencyAccessApi.reset();
    expect(client.post).toHaveBeenCalledWith('/emergency-access/reset');
    expect(result).toEqual({ enabled: true });
  });

  it('previewClaim() POSTs /emergency-access/claim/preview with the token', async () => {
    client.post.mockResolvedValue({
      data: { contactFirstName: 'Carol', message: null },
    });
    const result = await emergencyAccessApi.previewClaim('abc');
    expect(client.post).toHaveBeenCalledWith(
      '/emergency-access/claim/preview',
      { token: 'abc' },
    );
    expect(result).toEqual({ contactFirstName: 'Carol', message: null });
  });

  it('completeClaim() POSTs /emergency-access/claim/complete with token + password', async () => {
    client.post.mockResolvedValue({ data: { ok: true } });
    await emergencyAccessApi.completeClaim('abc', 'CorrectHorse99!');
    expect(client.post).toHaveBeenCalledWith(
      '/emergency-access/claim/complete',
      { token: 'abc', newPassword: 'CorrectHorse99!' },
    );
  });
});
