import { describe, it, expect, vi, beforeEach, type Mock } from 'vitest';
import { act, fireEvent, screen, waitFor } from '@testing-library/react';
import { render } from '@/test/render';
import { PayeeLookupSection } from './PayeeLookupSection';
import type { PayeeLookupSettings } from '@/types/payee-lookup';

vi.mock('@/lib/payee-lookup', () => ({
  payeeLookupApi: {
    getSettings: vi.fn(),
    updateSettings: vi.fn(),
    testKey: vi.fn(),
    getStatus: vi.fn(),
  },
}));

vi.mock('@/hooks/useContactLookupAvailable', () => ({
  useContactLookupAvailable: () => ({
    available: true,
    resolved: true,
    source: 'google-places',
  }),
}));

vi.mock('@/store/preferencesStore', () => ({
  usePreferencesStore: (selector: (state: unknown) => unknown) =>
    selector({
      preferences: { payeeContactLookupEnabled: false },
      updatePreferences: vi.fn(),
    }),
}));

import { payeeLookupApi } from '@/lib/payee-lookup';

const getSettings = payeeLookupApi.getSettings as unknown as Mock;
const updateSettings = payeeLookupApi.updateSettings as unknown as Mock;

const settings = (over: Partial<PayeeLookupSettings> = {}): PayeeLookupSettings => ({
  mode: 'none',
  configured: false,
  enabled: true,
  capEnabled: true,
  monthlyCap: 1000,
  apiKeyMasked: null,
  apiKeyReadable: true,
  usedThisMonth: 0,
  encryptionAvailable: true,
  ...over,
});

async function renderSection() {
  await act(async () => {
    render(<PayeeLookupSection />);
  });
}

beforeEach(() => {
  vi.clearAllMocks();
  getSettings.mockResolvedValue(settings());
  updateSettings.mockImplementation(async (patch) =>
    settings({ ...patch, configured: Boolean(patch.apiKey) }),
  );
});

describe('PayeeLookupSection', () => {
  it('invites an unconfigured user to set Google Places up', async () => {
    await renderSection();

    expect(screen.getByText('Google Places')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Set up' })).toBeInTheDocument();
    expect(
      screen.queryByRole('button', { name: 'Remove key' }),
    ).not.toBeInTheDocument();
  });

  it('shows the month usage against the cap once a key is stored', async () => {
    getSettings.mockResolvedValue(
      settings({
        mode: 'user',
        configured: true,
        apiKeyMasked: '****',
        usedThisMonth: 42,
        monthlyCap: 1000,
      }),
    );

    await renderSection();

    expect(screen.getByText(/Used this month: 42 of 1,?000/)).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Edit' })).toBeInTheDocument();
  });

  it('says the count is unlimited rather than printing a cap nobody set', async () => {
    getSettings.mockResolvedValue(
      settings({
        mode: 'user',
        configured: true,
        capEnabled: false,
        usedThisMonth: 9,
      }),
    );

    await renderSection();

    expect(screen.getByText(/No monthly limit/)).toBeInTheDocument();
  });

  describe('in operator mode', () => {
    const operator = settings({
      mode: 'operator',
      configured: true,
      monthlyCap: 5000,
    });

    it('offers the switch but no key or cap controls', async () => {
      // The deployment's key is already paid for; a key field beside it would
      // invite the user to pay twice for one lookup.
      getSettings.mockResolvedValue(operator);

      await renderSection();

      // Named, because the automatic-lookup toggle renders its own switch
      // below this card.
      expect(
        screen.getByRole('switch', {
          name: 'Use Google Places for payee lookups',
        }),
      ).toBeInTheDocument();
      expect(
        screen.queryByRole('button', { name: 'Set up' }),
      ).not.toBeInTheDocument();
      expect(
        screen.queryByRole('button', { name: 'Edit' }),
      ).not.toBeInTheDocument();
      expect(
        screen.queryByRole('button', { name: 'Remove key' }),
      ).not.toBeInTheDocument();
    });

    it('says who configured it', async () => {
      getSettings.mockResolvedValue(operator);

      await renderSection();

      expect(screen.getByText(/administrator/)).toBeInTheDocument();
    });
  });

  it('saves the switch as it changes and reverts on failure', async () => {
    getSettings.mockResolvedValue(
      settings({ mode: 'user', configured: true, apiKeyMasked: '****' }),
    );
    updateSettings.mockRejectedValue(new Error('nope'));

    await renderSection();
    const toggle = screen.getByRole('switch', {
      name: 'Use Google Places for payee lookups',
    });
    expect(toggle).toHaveAttribute('aria-checked', 'true');

    await act(async () => {
      fireEvent.click(toggle);
    });

    await waitFor(() => {
      expect(updateSettings).toHaveBeenCalledWith({ enabled: false });
    });
    // The save failed, so the switch goes back to what it actually is.
    await waitFor(() => {
      expect(
        screen.getByRole('switch', {
          name: 'Use Google Places for payee lookups',
        }),
      ).toHaveAttribute('aria-checked', 'true');
    });
  });

  it('clears the stored key with an empty string, never by omitting it', async () => {
    // An absent apiKey means "keep what is stored"; only "" removes it.
    getSettings.mockResolvedValue(
      settings({ mode: 'user', configured: true, apiKeyMasked: '****' }),
    );

    await renderSection();
    await act(async () => {
      fireEvent.click(screen.getByRole('button', { name: 'Remove key' }));
    });

    await waitFor(() => {
      expect(updateSettings).toHaveBeenCalledWith({ apiKey: '' });
    });
  });

  it('warns when the server cannot store a key, and does not offer to take one', async () => {
    getSettings.mockResolvedValue(settings({ encryptionAvailable: false }));

    await renderSection();

    expect(screen.getByText(/no encryption key configured/)).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Set up' })).toBeDisabled();
  });

  it('distinguishes an unreadable stored key from having none', async () => {
    // Different repair: enter it again, rather than for the first time.
    getSettings.mockResolvedValue(
      settings({
        mode: 'user',
        configured: true,
        apiKeyMasked: '****',
        apiKeyReadable: false,
      }),
    );

    await renderSection();

    expect(screen.getByText(/cannot be read by this server/)).toBeInTheDocument();
  });

  it('reports a failed load instead of rendering the empty state', async () => {
    // Rendering "not configured" would invite the user to enter a key they may
    // already have stored.
    getSettings.mockRejectedValue(new Error('offline'));

    await renderSection();

    expect(screen.getByText(/Could not load/)).toBeInTheDocument();
    expect(
      screen.queryByRole('button', { name: 'Set up' }),
    ).not.toBeInTheDocument();
  });
});
