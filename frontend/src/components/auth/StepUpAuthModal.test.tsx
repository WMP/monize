import { describe, it, expect, vi, beforeEach } from 'vitest';
import { act, fireEvent, screen, waitFor } from '@testing-library/react';
import { render } from '@/test/render';
import { StepUpAuthModal } from './StepUpAuthModal';
import { useStepUpTokenStore } from '@/lib/stepUpToken';

vi.mock('@/lib/api', () => ({
  default: { post: vi.fn() },
}));
import apiClient from '@/lib/api';
const mockedApi = apiClient as unknown as { post: ReturnType<typeof vi.fn> };

const mockAuthState: {
  user: { authProvider: 'local' | 'oidc'; hasPassword: boolean } | null;
} = { user: { authProvider: 'local', hasPassword: true } };
vi.mock('@/store/authStore', () => ({
  useAuthStore: (selector: (s: typeof mockAuthState) => unknown) =>
    selector(mockAuthState),
}));

const mockPrefsState: { preferences: { twoFactorEnabled: boolean } | null } = {
  preferences: { twoFactorEnabled: false },
};
vi.mock('@/store/preferencesStore', () => ({
  usePreferencesStore: (selector: (s: typeof mockPrefsState) => unknown) =>
    selector(mockPrefsState),
}));

async function renderModal(props: Partial<Parameters<typeof StepUpAuthModal>[0]> = {}) {
  let result: ReturnType<typeof render> | undefined;
  await act(async () => {
    result = render(
      <StepUpAuthModal
        isOpen
        purpose="emergency-access"
        reason="Re-verify"
        onClose={vi.fn()}
        onVerified={vi.fn()}
        {...props}
      />,
    );
  });
  return result!;
}

beforeEach(() => {
  vi.clearAllMocks();
  useStepUpTokenStore.getState().clearAll();
  mockAuthState.user = { authProvider: 'local', hasPassword: true };
  mockPrefsState.preferences = { twoFactorEnabled: false };
});

describe('StepUpAuthModal — TOTP mode (2FA enabled)', () => {
  beforeEach(() => {
    mockPrefsState.preferences = { twoFactorEnabled: true };
  });

  it('renders the 6-digit input and not a password field', async () => {
    await renderModal();
    expect(screen.getByLabelText(/Authenticator code/i)).toBeInTheDocument();
    expect(screen.queryByLabelText(/^Password$/i)).not.toBeInTheDocument();
  });

  it('strips non-digit characters as the user types', async () => {
    await renderModal();
    const input = screen.getByLabelText(/Authenticator code/i) as HTMLInputElement;
    await act(async () => {
      fireEvent.change(input, { target: { value: '12a3b4c' } });
    });
    expect(input.value).toBe('1234');
  });

  it('submits the totpCode and stores the token on success', async () => {
    const onVerified = vi.fn();
    const onClose = vi.fn();
    const expiresAt = new Date(Date.now() + 5 * 60 * 1000).toISOString();
    mockedApi.post.mockResolvedValue({
      data: { stepUpToken: 'tok-totp', expiresAt },
    });
    await renderModal({ onClose, onVerified });
    const input = screen.getByLabelText(/Authenticator code/i) as HTMLInputElement;
    await act(async () => {
      fireEvent.change(input, { target: { value: '123456' } });
    });
    const form = input.closest('form');
    await act(async () => {
      fireEvent.submit(form!);
    });
    await waitFor(() => expect(mockedApi.post).toHaveBeenCalled());
    expect(mockedApi.post).toHaveBeenCalledWith('/auth/step-up', {
      purpose: 'emergency-access',
      totpCode: '123456',
    });
    expect(
      useStepUpTokenStore.getState().getValid('emergency-access'),
    ).toBe('tok-totp');
    expect(onVerified).toHaveBeenCalled();
    expect(onClose).toHaveBeenCalled();
  });

  it('shows the server error message and does NOT store a token on failure', async () => {
    mockedApi.post.mockRejectedValue({
      response: { data: { message: 'Invalid authenticator code' } },
    });
    await renderModal();
    const input = screen.getByLabelText(/Authenticator code/i) as HTMLInputElement;
    await act(async () => {
      fireEvent.change(input, { target: { value: '999999' } });
    });
    await act(async () => {
      fireEvent.submit(input.closest('form')!);
    });
    await waitFor(() =>
      expect(screen.getByText(/Invalid authenticator code/)).toBeInTheDocument(),
    );
    expect(useStepUpTokenStore.getState().getValid('emergency-access')).toBeNull();
  });
});

describe('StepUpAuthModal — password mode (local, no 2FA)', () => {
  it('renders the password input and not the TOTP input', async () => {
    await renderModal();
    expect(screen.getByLabelText(/^Password$/i)).toBeInTheDocument();
    expect(screen.queryByLabelText(/Authenticator code/i)).not.toBeInTheDocument();
  });

  it('submits the password and stores the token on success', async () => {
    const onVerified = vi.fn();
    const onClose = vi.fn();
    const expiresAt = new Date(Date.now() + 5 * 60 * 1000).toISOString();
    mockedApi.post.mockResolvedValue({
      data: { stepUpToken: 'tok-pwd', expiresAt },
    });
    await renderModal({ onClose, onVerified });
    const input = screen.getByLabelText(/^Password$/i) as HTMLInputElement;
    await act(async () => {
      fireEvent.change(input, { target: { value: 'hunter2' } });
    });
    await act(async () => {
      fireEvent.submit(input.closest('form')!);
    });
    await waitFor(() => expect(mockedApi.post).toHaveBeenCalled());
    expect(mockedApi.post).toHaveBeenCalledWith('/auth/step-up', {
      purpose: 'emergency-access',
      password: 'hunter2',
    });
    expect(useStepUpTokenStore.getState().getValid('emergency-access')).toBe(
      'tok-pwd',
    );
    expect(onVerified).toHaveBeenCalled();
    expect(onClose).toHaveBeenCalled();
  });

  it('clicking Cancel closes the modal without calling the API', async () => {
    const onClose = vi.fn();
    await renderModal({ onClose });
    await act(async () => {
      fireEvent.click(screen.getByRole('button', { name: /^Cancel$/i }));
    });
    expect(onClose).toHaveBeenCalled();
    expect(mockedApi.post).not.toHaveBeenCalled();
  });
});

describe('StepUpAuthModal — OIDC user without 2FA', () => {
  beforeEach(() => {
    mockAuthState.user = { authProvider: 'oidc', hasPassword: false };
    mockPrefsState.preferences = { twoFactorEnabled: false };
  });

  it('renders an "unavailable" notice and a Close button only', async () => {
    await renderModal();
    expect(
      screen.getByText(/Enable two-factor authentication/i),
    ).toBeInTheDocument();
    expect(screen.queryByLabelText(/^Password$/i)).not.toBeInTheDocument();
    expect(screen.queryByLabelText(/Authenticator code/i)).not.toBeInTheDocument();
    expect(screen.getByRole('button', { name: /Close/i })).toBeInTheDocument();
  });

  it('Close button invokes onClose', async () => {
    const onClose = vi.fn();
    await renderModal({ onClose });
    await act(async () => {
      fireEvent.click(screen.getByRole('button', { name: /Close/i }));
    });
    expect(onClose).toHaveBeenCalled();
  });
});

describe('StepUpAuthModal — closed state', () => {
  it('renders nothing when isOpen is false', async () => {
    await renderModal({ isOpen: false });
    expect(screen.queryByText(/Confirm it/i)).not.toBeInTheDocument();
  });
});
