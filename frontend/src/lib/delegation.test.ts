import { describe, it, expect, vi, beforeEach } from 'vitest';
import apiClient from './api';
import { delegationApi } from './delegation';

vi.mock('./api', () => ({
  default: { get: vi.fn(), post: vi.fn(), put: vi.fn(), delete: vi.fn() },
}));

describe('delegationApi', () => {
  beforeEach(() => vi.clearAllMocks());

  it('getContexts fetches /auth/contexts', async () => {
    vi.mocked(apiClient.get).mockResolvedValue({
      data: { actingAsUserId: null, contexts: [] },
    });
    const res = await delegationApi.getContexts();
    expect(apiClient.get).toHaveBeenCalledWith('/auth/contexts');
    expect(res.actingAsUserId).toBeNull();
  });

  it('switchContext posts the target user id', async () => {
    vi.mocked(apiClient.post).mockResolvedValue({
      data: { actingAsUserId: 'owner-1' },
    });
    const res = await delegationApi.switchContext('owner-1');
    expect(apiClient.post).toHaveBeenCalledWith('/auth/switch-context', {
      targetUserId: 'owner-1',
    });
    expect(res.actingAsUserId).toBe('owner-1');
  });

  it('listDelegates fetches the delegate list', async () => {
    vi.mocked(apiClient.get).mockResolvedValue({ data: [{ id: 'd-1' }] });
    const res = await delegationApi.listDelegates();
    expect(apiClient.get).toHaveBeenCalledWith('/delegation/delegates');
    expect(res).toHaveLength(1);
  });

  it('createDelegate posts the payload', async () => {
    vi.mocked(apiClient.post).mockResolvedValue({
      data: { id: 'd-1', delegateUserId: 'u-2', email: 'a@b.c', invited: false },
    });
    await delegationApi.createDelegate({ email: 'a@b.c' });
    expect(apiClient.post).toHaveBeenCalledWith('/delegation/delegates', {
      email: 'a@b.c',
    });
  });

  it('setGrants PUTs the account ids', async () => {
    vi.mocked(apiClient.put).mockResolvedValue({ data: {} });
    await delegationApi.setGrants('d-1', ['a-1', 'a-2']);
    expect(apiClient.put).toHaveBeenCalledWith(
      '/delegation/delegates/d-1/grants',
      { accountIds: ['a-1', 'a-2'] },
    );
  });

  it('revokeDelegate calls DELETE', async () => {
    vi.mocked(apiClient.delete).mockResolvedValue({});
    await delegationApi.revokeDelegate('d-1');
    expect(apiClient.delete).toHaveBeenCalledWith('/delegation/delegates/d-1');
  });

  it('resetPassword posts to the reset endpoint', async () => {
    vi.mocked(apiClient.post).mockResolvedValue({
      data: { temporaryPassword: 'Tiger!River42' },
    });
    const res = await delegationApi.resetPassword('d-1');
    expect(apiClient.post).toHaveBeenCalledWith(
      '/delegation/delegates/d-1/reset-password',
    );
    expect(res.temporaryPassword).toBe('Tiger!River42');
  });
});
