import { describe, it, expect, vi, beforeEach } from 'vitest';
import { act, fireEvent, screen, waitFor } from '@testing-library/react';
import { render } from '@/test/render';
import EmergencyAccessPage from './page';
import type { EmergencyAccessView } from '@/types/emergency-access';

vi.mock('@/components/auth/ProtectedRoute', () => ({
  ProtectedRoute: ({ children }: { children: React.ReactNode }) => (
    <div>{children}</div>
  ),
}));
vi.mock('@/components/layout/PageLayout', () => ({
  PageLayout: ({ children }: { children: React.ReactNode }) => (
    <div>{children}</div>
  ),
}));
vi.mock('@/components/layout/PageHeader', () => ({
  PageHeader: ({ title, subtitle }: { title: string; subtitle?: string }) => (
    <div>
      <h1>{title}</h1>
      {subtitle && <p>{subtitle}</p>}
    </div>
  ),
}));

const mockUseDemoMode = vi.fn();
vi.mock('@/hooks/useDemoMode', () => ({
  useDemoMode: () => mockUseDemoMode(),
}));

const mockActingAs = vi.fn();
vi.mock('@/store/authStore', () => ({
  useAuthStore: (
    selector: (s: { actingAsUserId: string | null }) => unknown,
  ) => selector({ actingAsUserId: mockActingAs() }),
}));

vi.mock('@/store/preferencesStore', () => ({
  usePreferencesStore: (
    selector: (s: {
      preferences: {
        timezone: string;
        dateFormat: string;
        timeFormat: '24h' | '12h';
      };
    }) => unknown,
  ) =>
    selector({
      preferences: {
        timezone: 'browser',
        dateFormat: 'browser',
        timeFormat: '24h',
      },
    }),
}));

// Stub the step-up modal -- exercised separately in its own test file. The
// stub exposes a synthetic "Verify" button that simulates a successful
// re-auth by stamping a token into the store and calling onVerified.
vi.mock('@/components/auth/StepUpAuthModal', () => ({
  StepUpAuthModal: ({
    isOpen,
    onClose,
    onVerified,
  }: {
    isOpen: boolean;
    onClose: () => void;
    onVerified?: () => void;
  }) =>
    isOpen ? (
      <div data-testid="step-up-modal">
        <button
          onClick={async () => {
            const { useStepUpTokenStore } = await import('@/lib/stepUpToken');
            useStepUpTokenStore
              .getState()
              .set(
                'emergency-access',
                'mock-token',
                new Date(Date.now() + 5 * 60 * 1000).toISOString(),
              );
            onVerified?.();
            onClose();
          }}
        >
          Mock Verify
        </button>
        <button onClick={onClose}>Mock Close</button>
      </div>
    ) : null,
}));

vi.mock('@/lib/emergency-access', () => ({
  emergencyAccessApi: {
    get: vi.fn(),
    getMessage: vi.fn(),
    updateMessage: vi.fn(),
    updateSettings: vi.fn(),
    addContact: vi.fn(),
    updateContact: vi.fn(),
    removeContact: vi.fn(),
    reset: vi.fn(),
    previewClaim: vi.fn(),
    completeClaim: vi.fn(),
  },
}));

import { emergencyAccessApi } from '@/lib/emergency-access';
import { useStepUpTokenStore, StepUpRequiredError } from '@/lib/stepUpToken';
const api = emergencyAccessApi as unknown as Record<
  string,
  ReturnType<typeof vi.fn>
>;

function makeView(
  overrides: Partial<EmergencyAccessView> = {},
): EmergencyAccessView {
  return {
    emailConfigured: true,
    enabled: false,
    grantAfterDays: 14,
    reminderAfterDays: 7,
    messageMetadata: { hasMessage: false, charCount: 0, updatedAt: null },
    lastReminderSentAt: null,
    grantedAt: null,
    lastActivityAt: new Date().toISOString(),
    contacts: [],
    ...overrides,
  };
}

async function renderPage() {
  let result: ReturnType<typeof render> | undefined;
  await act(async () => {
    result = render(<EmergencyAccessPage />);
  });
  return result!;
}

describe('EmergencyAccessPage', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockUseDemoMode.mockReturnValue(false);
    mockActingAs.mockReturnValue(null);
    useStepUpTokenStore.getState().clearAll();
  });

  it('blocks access for delegate sessions', async () => {
    mockActingAs.mockReturnValue('other-user');
    api.get.mockResolvedValue(makeView());
    await renderPage();
    expect(
      screen.getByText(
        /Emergency access can only be configured by the account owner/,
      ),
    ).toBeInTheDocument();
    expect(api.get).not.toHaveBeenCalled();
  });

  it('blocks access in demo mode', async () => {
    mockUseDemoMode.mockReturnValue(true);
    await renderPage();
    expect(
      screen.getByText(/Emergency access is disabled in demo mode/),
    ).toBeInTheDocument();
  });

  it('shows the SMTP-not-configured notice when emailConfigured is false', async () => {
    api.get.mockResolvedValue(makeView({ emailConfigured: false }));
    await renderPage();
    await waitFor(() =>
      expect(screen.getByText(/Email is not configured/)).toBeInTheDocument(),
    );
    expect(
      (screen.getByRole('button', {
        name: /Save settings/i,
      }) as HTMLButtonElement).disabled,
    ).toBe(true);
  });

  it('renders metadata for a configured message without the plaintext', async () => {
    api.get.mockResolvedValue(
      makeView({
        messageMetadata: {
          hasMessage: true,
          charCount: 12,
          updatedAt: '2026-05-01T00:00:00Z',
        },
      }),
    );
    await renderPage();
    await waitFor(() =>
      expect(screen.getByText(/Message set/)).toBeInTheDocument(),
    );
    expect(screen.getByText(/12 chars/)).toBeInTheDocument();
    // The plaintext is never on screen until the user verifies.
    expect(screen.queryByText('top-secret')).not.toBeInTheDocument();
  });

  it('renders "No message set" when nothing has been stored yet', async () => {
    api.get.mockResolvedValue(makeView());
    await renderPage();
    await waitFor(() =>
      expect(screen.getByText(/No message set/)).toBeInTheDocument(),
    );
    // Reveal is disabled when there's no message; Add message is enabled.
    const reveal = screen.getByRole('button', { name: /Reveal message/i });
    expect((reveal as HTMLButtonElement).disabled).toBe(true);
    expect(
      screen.getByRole('button', { name: /Add message/i }),
    ).toBeInTheDocument();
  });

  it('clicking Reveal opens the step-up modal when no token is present', async () => {
    api.get.mockResolvedValue(
      makeView({
        messageMetadata: { hasMessage: true, charCount: 4, updatedAt: null },
      }),
    );
    await renderPage();
    await waitFor(() =>
      expect(
        screen.getByRole('button', { name: /Reveal message/i }),
      ).toBeInTheDocument(),
    );
    await act(async () => {
      fireEvent.click(
        screen.getByRole('button', { name: /Reveal message/i }),
      );
    });
    expect(screen.getByTestId('step-up-modal')).toBeInTheDocument();
    expect(api.getMessage).not.toHaveBeenCalled();
  });

  it('after verifying via the modal, the message is fetched and shown', async () => {
    api.get.mockResolvedValue(
      makeView({
        messageMetadata: { hasMessage: true, charCount: 10, updatedAt: null },
      }),
    );
    api.getMessage.mockResolvedValue({ message: 'top-secret' });
    await renderPage();
    await waitFor(() =>
      screen.getByRole('button', { name: /Reveal message/i }),
    );
    await act(async () => {
      fireEvent.click(
        screen.getByRole('button', { name: /Reveal message/i }),
      );
    });
    await act(async () => {
      fireEvent.click(
        screen.getByRole('button', { name: /Mock Verify/i }),
      );
    });
    await act(async () => {});
    await waitFor(() => expect(api.getMessage).toHaveBeenCalled());
    expect(screen.getByText('top-secret')).toBeInTheDocument();
    // After unlock the countdown card should appear.
    expect(screen.getByText(/Unlocked for/)).toBeInTheDocument();
  });

  it('skips the modal when a valid token is already cached', async () => {
    useStepUpTokenStore
      .getState()
      .set(
        'emergency-access',
        'cached',
        new Date(Date.now() + 5 * 60 * 1000).toISOString(),
      );
    api.get.mockResolvedValue(
      makeView({
        messageMetadata: { hasMessage: true, charCount: 5, updatedAt: null },
      }),
    );
    api.getMessage.mockResolvedValue({ message: 'cached msg' });
    await renderPage();
    await waitFor(() =>
      screen.getByRole('button', { name: /Reveal message/i }),
    );
    await act(async () => {
      fireEvent.click(
        screen.getByRole('button', { name: /Reveal message/i }),
      );
    });
    await act(async () => {});
    await waitFor(() => expect(api.getMessage).toHaveBeenCalled());
    expect(screen.queryByTestId('step-up-modal')).not.toBeInTheDocument();
    expect(screen.getByText('cached msg')).toBeInTheDocument();
  });

  it('Edit message with a cached token skips the modal and opens the editor', async () => {
    useStepUpTokenStore
      .getState()
      .set(
        'emergency-access',
        'cached',
        new Date(Date.now() + 5 * 60 * 1000).toISOString(),
      );
    api.get.mockResolvedValue(
      makeView({
        messageMetadata: { hasMessage: true, charCount: 4, updatedAt: null },
      }),
    );
    api.getMessage.mockResolvedValue({ message: 'old' });
    await renderPage();
    await waitFor(() =>
      screen.getByRole('button', { name: /Edit message/i }),
    );
    await act(async () => {
      fireEvent.click(
        screen.getByRole('button', { name: /Edit message/i }),
      );
    });
    await act(async () => {});
    await waitFor(() =>
      expect(screen.getByPlaceholderText(/Notes, instructions/i)).toBeInTheDocument(),
    );
    expect(screen.queryByTestId('step-up-modal')).not.toBeInTheDocument();
  });

  it('Cancel inside the editor returns to view mode without clearing the token', async () => {
    useStepUpTokenStore
      .getState()
      .set(
        'emergency-access',
        'cached',
        new Date(Date.now() + 5 * 60 * 1000).toISOString(),
      );
    api.get.mockResolvedValue(
      makeView({
        messageMetadata: { hasMessage: true, charCount: 4, updatedAt: null },
      }),
    );
    api.getMessage.mockResolvedValue({ message: 'msg' });
    await renderPage();
    await waitFor(() =>
      screen.getByRole('button', { name: /Edit message/i }),
    );
    await act(async () => {
      fireEvent.click(
        screen.getByRole('button', { name: /Edit message/i }),
      );
    });
    await act(async () => {});
    await waitFor(() =>
      screen.getByPlaceholderText(/Notes, instructions/i),
    );
    // Cancel inside the edit form
    await act(async () => {
      fireEvent.click(screen.getByRole('button', { name: /^Cancel$/i }));
    });
    await waitFor(() => expect(screen.getByText('msg')).toBeInTheDocument());
    // Token is still active.
    expect(
      useStepUpTokenStore.getState().getValid('emergency-access'),
    ).toBe('cached');
  });

  it('updateMessage failure (non step-up) leaves the editor open and toasts', async () => {
    useStepUpTokenStore
      .getState()
      .set(
        'emergency-access',
        'cached',
        new Date(Date.now() + 5 * 60 * 1000).toISOString(),
      );
    api.get.mockResolvedValue(
      makeView({
        messageMetadata: { hasMessage: true, charCount: 4, updatedAt: null },
      }),
    );
    api.getMessage.mockResolvedValue({ message: 'old' });
    api.updateMessage.mockRejectedValue(new Error('database boom'));
    await renderPage();
    await act(async () => {
      fireEvent.click(
        screen.getByRole('button', { name: /Edit message/i }),
      );
    });
    await act(async () => {});
    await waitFor(() =>
      screen.getByPlaceholderText(/Notes, instructions/i),
    );
    await act(async () => {
      fireEvent.click(
        screen.getByRole('button', { name: /Save message/i }),
      );
    });
    await act(async () => {});
    await waitFor(() => expect(api.updateMessage).toHaveBeenCalled());
    // Editor stays open because the save failed.
    expect(
      screen.getByPlaceholderText(/Notes, instructions/i),
    ).toBeInTheDocument();
  });

  it('Lock now clears the token and hides the plaintext', async () => {
    useStepUpTokenStore
      .getState()
      .set(
        'emergency-access',
        'cached',
        new Date(Date.now() + 5 * 60 * 1000).toISOString(),
      );
    api.get.mockResolvedValue(
      makeView({
        messageMetadata: { hasMessage: true, charCount: 5, updatedAt: null },
      }),
    );
    api.getMessage.mockResolvedValue({ message: 'sensitive' });
    await renderPage();
    await act(async () => {
      fireEvent.click(
        screen.getByRole('button', { name: /Reveal message/i }),
      );
    });
    await act(async () => {});
    await waitFor(() => expect(screen.getByText('sensitive')).toBeInTheDocument());
    await act(async () => {
      fireEvent.click(screen.getByRole('button', { name: /Lock now/i }));
    });
    expect(screen.queryByText('sensitive')).not.toBeInTheDocument();
    expect(
      useStepUpTokenStore.getState().getValid('emergency-access'),
    ).toBeNull();
  });

  it('STEP_UP_REQUIRED from getMessage opens the modal', async () => {
    api.get.mockResolvedValue(
      makeView({
        messageMetadata: { hasMessage: true, charCount: 5, updatedAt: null },
      }),
    );
    useStepUpTokenStore
      .getState()
      .set(
        'emergency-access',
        'expired-on-server',
        new Date(Date.now() + 5 * 60 * 1000).toISOString(),
      );
    api.getMessage.mockRejectedValue(
      new StepUpRequiredError('emergency-access', 'expired'),
    );
    await renderPage();
    await act(async () => {
      fireEvent.click(
        screen.getByRole('button', { name: /Reveal message/i }),
      );
    });
    await act(async () => {});
    await waitFor(() =>
      expect(screen.getByTestId('step-up-modal')).toBeInTheDocument(),
    );
  });

  it('shows a toast and stays on the metadata card when getMessage fails for another reason', async () => {
    useStepUpTokenStore
      .getState()
      .set(
        'emergency-access',
        'cached',
        new Date(Date.now() + 5 * 60 * 1000).toISOString(),
      );
    api.get.mockResolvedValue(
      makeView({
        messageMetadata: { hasMessage: true, charCount: 5, updatedAt: null },
      }),
    );
    api.getMessage.mockRejectedValue(new Error('network'));
    await renderPage();
    await act(async () => {
      fireEvent.click(
        screen.getByRole('button', { name: /Reveal message/i }),
      );
    });
    await act(async () => {});
    // The card stayed in its hidden mode (no plaintext, no countdown).
    expect(screen.queryByText(/Unlocked for/)).not.toBeInTheDocument();
  });

  it('opens the editor after verifying and saves a new message', async () => {
    api.get.mockResolvedValue(makeView());
    api.getMessage.mockResolvedValue({ message: '' });
    api.updateMessage.mockResolvedValue({
      hasMessage: true,
      charCount: 5,
      updatedAt: null,
    });
    await renderPage();
    await waitFor(() =>
      screen.getByRole('button', { name: /Add message/i }),
    );
    await act(async () => {
      fireEvent.click(screen.getByRole('button', { name: /Add message/i }));
    });
    await act(async () => {
      fireEvent.click(screen.getByRole('button', { name: /Mock Verify/i }));
    });
    await act(async () => {});
    await waitFor(() =>
      screen.getByPlaceholderText(/Notes, instructions/i),
    );
    await act(async () => {
      fireEvent.change(screen.getByPlaceholderText(/Notes, instructions/i), {
        target: { value: 'hello' },
      });
    });
    await act(async () => {
      fireEvent.click(
        screen.getByRole('button', { name: /Save message/i }),
      );
    });
    await act(async () => {});
    await waitFor(() => expect(api.updateMessage).toHaveBeenCalledWith('hello'));
  });

  it('updateMessage rejection with STEP_UP_EXPIRED reopens the modal', async () => {
    useStepUpTokenStore
      .getState()
      .set(
        'emergency-access',
        'cached',
        new Date(Date.now() + 5 * 60 * 1000).toISOString(),
      );
    api.get.mockResolvedValue(
      makeView({
        messageMetadata: { hasMessage: true, charCount: 4, updatedAt: null },
      }),
    );
    api.getMessage.mockResolvedValue({ message: 'old' });
    api.updateMessage.mockRejectedValue(
      new StepUpRequiredError('emergency-access', 'expired'),
    );
    await renderPage();
    await act(async () => {
      fireEvent.click(
        screen.getByRole('button', { name: /Reveal message/i }),
      );
    });
    await act(async () => {});
    await waitFor(() =>
      screen.getByRole('button', { name: /^Edit$/i }),
    );
    await act(async () => {
      fireEvent.click(screen.getByRole('button', { name: /^Edit$/i }));
    });
    await waitFor(() =>
      screen.getByPlaceholderText(/Notes, instructions/i),
    );
    await act(async () => {
      fireEvent.click(
        screen.getByRole('button', { name: /Save message/i }),
      );
    });
    await act(async () => {});
    await waitFor(() =>
      expect(screen.getByTestId('step-up-modal')).toBeInTheDocument(),
    );
  });

  it('saves the (non-message) settings via the API', async () => {
    const initial = makeView();
    const updated = makeView({ enabled: true });
    api.get.mockResolvedValue(initial);
    api.updateSettings.mockResolvedValue(updated);
    await renderPage();
    await waitFor(() =>
      screen.getByRole('button', { name: /Save settings/i }),
    );
    await act(async () => {
      fireEvent.click(
        screen.getByRole('button', { name: /Save settings/i }),
      );
    });
    await waitFor(() => expect(api.updateSettings).toHaveBeenCalled());
    const payload = api.updateSettings.mock.calls[0][0];
    expect(payload).toEqual({
      enabled: false,
      grantAfterDays: 14,
      reminderAfterDays: 7,
    });
    expect(payload).not.toHaveProperty('message');
  });

  it('toggles the enable switch via setValue', async () => {
    api.get.mockResolvedValue(makeView());
    api.updateSettings.mockResolvedValue(makeView({ enabled: true }));
    await renderPage();
    await waitFor(() =>
      screen.getByRole('button', { name: /Save settings/i }),
    );
    const toggle = screen.getByRole('switch', {
      name: /Enable emergency access/i,
    });
    await act(async () => {
      fireEvent.click(toggle);
    });
    await act(async () => {
      fireEvent.click(
        screen.getByRole('button', { name: /Save settings/i }),
      );
    });
    await waitFor(() => expect(api.updateSettings).toHaveBeenCalled());
    expect(api.updateSettings.mock.calls[0][0].enabled).toBe(true);
  });

  it('renders a warning when access has already been granted', async () => {
    api.get.mockResolvedValue(
      makeView({ grantedAt: new Date().toISOString() }),
    );
    await renderPage();
    await waitFor(() =>
      expect(
        screen.getByText('Emergency access already granted'),
      ).toBeInTheDocument(),
    );
  });

  it('renders an unable-to-load message when the initial fetch fails', async () => {
    api.get.mockRejectedValue(new Error('network down'));
    await renderPage();
    await waitFor(() =>
      expect(
        screen.getByText(/Unable to load emergency access/),
      ).toBeInTheDocument(),
    );
  });

  it('adds a contact via the API', async () => {
    api.get.mockResolvedValue(makeView());
    api.addContact.mockResolvedValue({
      id: 'new',
      firstName: 'Carol',
      email: 'carol@example.com',
      createdAt: new Date().toISOString(),
    });
    await renderPage();
    await waitFor(() =>
      screen.getByRole('button', { name: /Add contact/i }),
    );
    await act(async () => {
      fireEvent.click(screen.getByRole('button', { name: /Add contact/i }));
    });

    const firstName = screen.getByLabelText(/First name/i);
    const email = screen.getByLabelText(/^Email$/i);
    await act(async () => {
      fireEvent.input(firstName, { target: { value: 'Carol' } });
      fireEvent.input(email, { target: { value: 'carol@example.com' } });
    });
    const form = firstName.closest('form');
    expect(form).not.toBeNull();
    await act(async () => {
      fireEvent.submit(form!);
    });
    await act(async () => {});

    await waitFor(() => expect(api.addContact).toHaveBeenCalled());
    expect(api.addContact.mock.calls[0][0]).toEqual({
      firstName: 'Carol',
      email: 'carol@example.com',
    });
  });

  it('opens the contact form pre-populated when editing an existing contact', async () => {
    api.get.mockResolvedValue(
      makeView({
        contacts: [
          {
            id: 'c1',
            firstName: 'Carol',
            email: 'carol@example.com',
            createdAt: new Date().toISOString(),
          },
        ],
      }),
    );
    api.updateContact.mockResolvedValue({
      id: 'c1',
      firstName: 'Carrie',
      email: 'carrie@example.com',
      createdAt: new Date().toISOString(),
    });
    await renderPage();
    await waitFor(() => expect(screen.getByText('Carol')).toBeInTheDocument());
    await act(async () => {
      fireEvent.click(screen.getByRole('button', { name: /^Edit$/i }));
    });

    const firstName = screen.getByLabelText(/First name/i);
    expect((firstName as HTMLInputElement).value).toBe('Carol');

    await act(async () => {
      fireEvent.input(firstName, { target: { value: 'Carrie' } });
      fireEvent.input(screen.getByLabelText(/^Email$/i), {
        target: { value: 'carrie@example.com' },
      });
    });
    const form = firstName.closest('form');
    await act(async () => {
      fireEvent.submit(form!);
    });
    await act(async () => {});

    await waitFor(() => expect(api.updateContact).toHaveBeenCalled());
    expect(api.updateContact.mock.calls[0][0]).toBe('c1');
    expect(api.updateContact.mock.calls[0][1]).toEqual({
      firstName: 'Carrie',
      email: 'carrie@example.com',
    });
  });

  it('removes a contact via the confirm dialog', async () => {
    api.get.mockResolvedValue(
      makeView({
        contacts: [
          {
            id: 'c1',
            firstName: 'Carol',
            email: 'carol@example.com',
            createdAt: new Date().toISOString(),
          },
        ],
      }),
    );
    api.removeContact.mockResolvedValue(undefined);
    await renderPage();
    await waitFor(() => expect(screen.getByText('Carol')).toBeInTheDocument());
    await act(async () => {
      fireEvent.click(screen.getByRole('button', { name: /^Remove$/i }));
    });
    await waitFor(() =>
      expect(screen.getByText('Remove contact')).toBeInTheDocument(),
    );
    const removeButtons = screen.getAllByRole('button', {
      name: /^Remove$/i,
    });
    await act(async () => {
      fireEvent.click(removeButtons[removeButtons.length - 1]);
    });
    await waitFor(() => expect(api.removeContact).toHaveBeenCalledWith('c1'));
  });

  it('shows a toast when settings save fails', async () => {
    api.get.mockResolvedValue(makeView());
    api.updateSettings.mockRejectedValue(new Error('validation failed'));
    await renderPage();
    await waitFor(() =>
      screen.getByRole('button', { name: /Save settings/i }),
    );
    await act(async () => {
      fireEvent.click(
        screen.getByRole('button', { name: /Save settings/i }),
      );
    });
    await act(async () => {});
    await waitFor(() => expect(api.updateSettings).toHaveBeenCalled());
  });

  it('shows a toast and keeps the contact when removeContact() fails', async () => {
    api.get.mockResolvedValue(
      makeView({
        contacts: [
          {
            id: 'c1',
            firstName: 'Carol',
            email: 'carol@example.com',
            createdAt: new Date().toISOString(),
          },
        ],
      }),
    );
    api.removeContact.mockRejectedValue(new Error('still has pending grant'));
    await renderPage();
    await waitFor(() => screen.getByText('Carol'));
    await act(async () => {
      fireEvent.click(screen.getByRole('button', { name: /^Remove$/i }));
    });
    await waitFor(() => screen.getByText('Remove contact'));
    const removeButtons = screen.getAllByRole('button', {
      name: /^Remove$/i,
    });
    await act(async () => {
      fireEvent.click(removeButtons[removeButtons.length - 1]);
    });
    await act(async () => {});
    await waitFor(() => expect(api.removeContact).toHaveBeenCalled());
    expect(screen.getByText('Carol')).toBeInTheDocument();
  });

  it('shows a toast when adding a contact fails', async () => {
    api.get.mockResolvedValue(makeView());
    api.addContact.mockRejectedValue(new Error('duplicate'));
    await renderPage();
    await waitFor(() =>
      screen.getByRole('button', { name: /Add contact/i }),
    );
    await act(async () => {
      fireEvent.click(screen.getByRole('button', { name: /Add contact/i }));
    });
    const firstName = screen.getByLabelText(/First name/i);
    await act(async () => {
      fireEvent.input(firstName, { target: { value: 'Carol' } });
      fireEvent.input(screen.getByLabelText(/^Email$/i), {
        target: { value: 'carol@example.com' },
      });
    });
    const form = firstName.closest('form');
    await act(async () => {
      fireEvent.submit(form!);
    });
    await act(async () => {});
    await waitFor(() => expect(api.addContact).toHaveBeenCalled());
    // Modal stays open because the API rejected.
    expect(screen.getByText('Add emergency contact')).toBeInTheDocument();
  });

  it('cancels the remove-contact confirm dialog without calling the API', async () => {
    api.get.mockResolvedValue(
      makeView({
        contacts: [
          {
            id: 'c1',
            firstName: 'Carol',
            email: 'carol@example.com',
            createdAt: new Date().toISOString(),
          },
        ],
      }),
    );
    await renderPage();
    await waitFor(() => screen.getByText('Carol'));
    await act(async () => {
      fireEvent.click(screen.getByRole('button', { name: /^Remove$/i }));
    });
    await waitFor(() => screen.getByText('Remove contact'));
    await act(async () => {
      fireEvent.click(screen.getByRole('button', { name: /^Cancel$/i }));
    });
    await waitFor(() =>
      expect(screen.queryByText('Remove contact')).not.toBeInTheDocument(),
    );
    expect(api.removeContact).not.toHaveBeenCalled();
  });

  it('cancels the clear-granted confirm dialog without calling the API', async () => {
    api.get.mockResolvedValue(
      makeView({ grantedAt: new Date().toISOString() }),
    );
    await renderPage();
    await waitFor(() =>
      expect(
        screen.getByText('Emergency access already granted'),
      ).toBeInTheDocument(),
    );
    await act(async () => {
      fireEvent.click(
        screen.getByRole('button', { name: /Clear granted state/i }),
      );
    });
    await waitFor(() =>
      expect(
        screen.getByRole('button', { name: /^Cancel$/i }),
      ).toBeInTheDocument(),
    );
    await act(async () => {
      fireEvent.click(screen.getByRole('button', { name: /^Cancel$/i }));
    });
    expect(api.reset).not.toHaveBeenCalled();
  });

  it('clears the granted state via the confirm dialog', async () => {
    api.get.mockResolvedValue(
      makeView({ grantedAt: new Date().toISOString() }),
    );
    api.reset.mockResolvedValue(makeView());
    await renderPage();
    await waitFor(() =>
      expect(
        screen.getByText('Emergency access already granted'),
      ).toBeInTheDocument(),
    );
    await act(async () => {
      fireEvent.click(
        screen.getByRole('button', { name: /Clear granted state/i }),
      );
    });
    await waitFor(() =>
      expect(
        screen.getByRole('button', { name: 'Clear' }),
      ).toBeInTheDocument(),
    );
    await act(async () => {
      fireEvent.click(screen.getByRole('button', { name: 'Clear' }));
    });
    await waitFor(() => expect(api.reset).toHaveBeenCalled());
  });

  it('shows a toast and stays on the page when reset() fails', async () => {
    api.get.mockResolvedValue(
      makeView({ grantedAt: new Date().toISOString() }),
    );
    api.reset.mockRejectedValue(new Error('server down'));
    await renderPage();
    await waitFor(() =>
      expect(
        screen.getByText('Emergency access already granted'),
      ).toBeInTheDocument(),
    );
    await act(async () => {
      fireEvent.click(
        screen.getByRole('button', { name: /Clear granted state/i }),
      );
    });
    await waitFor(() =>
      expect(
        screen.getByRole('button', { name: 'Clear' }),
      ).toBeInTheDocument(),
    );
    await act(async () => {
      fireEvent.click(screen.getByRole('button', { name: 'Clear' }));
    });
    await act(async () => {});
    await waitFor(() => expect(api.reset).toHaveBeenCalled());
    expect(
      screen.getByText('Emergency access already granted'),
    ).toBeInTheDocument();
  });

  it('closes the contact modal via Cancel', async () => {
    api.get.mockResolvedValue(makeView());
    await renderPage();
    await waitFor(() =>
      screen.getByRole('button', { name: /Add contact/i }),
    );
    await act(async () => {
      fireEvent.click(screen.getByRole('button', { name: /Add contact/i }));
    });
    await waitFor(() => screen.getByText('Add emergency contact'));
    await act(async () => {
      fireEvent.click(screen.getByRole('button', { name: /Cancel/i }));
    });
    await waitFor(() =>
      expect(
        screen.queryByText('Add emergency contact'),
      ).not.toBeInTheDocument(),
    );
  });
});
