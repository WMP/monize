import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, fireEvent, act, waitFor } from '@/test/render';
import { OnboardingPreferences } from './OnboardingPreferences';

const mockUpdatePreferences = vi.fn();
const mockStoreUpdate = vi.fn();
const mockRefresh = vi.fn();

vi.mock('next/navigation', async () => {
  const actual = await vi.importActual<typeof import('next/navigation')>(
    'next/navigation',
  );
  return {
    ...actual,
    useRouter: () => ({ refresh: mockRefresh, push: vi.fn(), replace: vi.fn() }),
  };
});

vi.mock('@/lib/exchange-rates', () => ({
  exchangeRatesApi: {
    getCurrencies: vi.fn().mockResolvedValue([
      { code: 'USD', name: 'US Dollar' },
      { code: 'CAD', name: 'Canadian Dollar' },
    ]),
  },
}));

vi.mock('@/lib/user-settings', () => ({
  userSettingsApi: {
    updatePreferences: (...args: unknown[]) => mockUpdatePreferences(...args),
  },
}));

vi.mock('@/store/preferencesStore', () => ({
  usePreferencesStore: (selector: (s: unknown) => unknown) =>
    selector({ updatePreferences: mockStoreUpdate }),
}));

vi.mock('js-cookie', () => ({ default: { set: vi.fn() } }));

async function renderOnboarding(onComplete = vi.fn()) {
  await act(async () => {
    render(<OnboardingPreferences initialLanguage="en" onComplete={onComplete} />);
  });
  return { onComplete };
}

describe('OnboardingPreferences', () => {
  beforeEach(() => vi.clearAllMocks());

  it('renders language and currency selectors', async () => {
    await renderOnboarding();
    expect(screen.getByText('Language')).toBeInTheDocument();
    expect(screen.getByText('Default currency')).toBeInTheDocument();
    await waitFor(() =>
      expect(screen.getByText('CAD - Canadian Dollar')).toBeInTheDocument(),
    );
  });

  it('saves the chosen language and currency on continue', async () => {
    mockUpdatePreferences.mockResolvedValue({ language: 'en', defaultCurrency: 'CAD' });
    const { onComplete } = await renderOnboarding();

    await waitFor(() =>
      expect(screen.getByText('CAD - Canadian Dollar')).toBeInTheDocument(),
    );
    await act(async () => {
      fireEvent.change(screen.getByLabelText('Default currency'), {
        target: { value: 'CAD' },
      });
    });
    await act(async () => {
      fireEvent.click(screen.getByText('Continue'));
    });

    await waitFor(() =>
      expect(mockUpdatePreferences).toHaveBeenCalledWith({
        language: 'en',
        defaultCurrency: 'CAD',
      }),
    );
    expect(mockStoreUpdate).toHaveBeenCalled();
    // The layout must re-render with the new locale's catalogs; without the
    // refresh the app keeps showing the old language until a full reload.
    expect(mockRefresh).toHaveBeenCalled();
    expect(onComplete).toHaveBeenCalled();
  });

  it('skips without saving', async () => {
    const { onComplete } = await renderOnboarding();
    await act(async () => {
      fireEvent.click(screen.getByText('Skip for now'));
    });
    expect(mockUpdatePreferences).not.toHaveBeenCalled();
    expect(mockRefresh).not.toHaveBeenCalled();
    expect(onComplete).toHaveBeenCalled();
  });
});
