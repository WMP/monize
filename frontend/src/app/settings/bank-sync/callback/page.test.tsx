import { describe, it, expect, vi, beforeEach } from 'vitest';
import toast from 'react-hot-toast';
import { act, render, screen, waitFor } from '@/test/render';
import BankSyncCallbackPage from './page';

const mockReplace = vi.fn();
let mockSearchParams = new URLSearchParams();

vi.mock('next/navigation', () => ({
  useRouter: () => ({
    push: vi.fn(),
    replace: mockReplace,
    back: vi.fn(),
    prefetch: vi.fn(),
    refresh: vi.fn(),
  }),
  usePathname: () => '/settings/bank-sync/callback',
  useSearchParams: () => mockSearchParams,
}));

vi.mock('@/components/auth/ProtectedRoute', () => ({
  ProtectedRoute: ({ children }: { children: React.ReactNode }) => <div>{children}</div>,
}));

vi.mock('@/components/layout/PageLayout', () => ({
  PageLayout: ({ children }: { children: React.ReactNode }) => <div>{children}</div>,
}));

const mockCompleteCallback = vi.fn();

vi.mock('@/lib/bank-sync', () => ({
  bankSyncApi: {
    completeCallback: (...args: unknown[]) => mockCompleteCallback(...args),
  },
}));

const activeConnection = { id: 'c1', institutionName: 'Alpha Bank', status: 'active', lastError: null };

async function renderCallback(query: string) {
  mockSearchParams = new URLSearchParams(query);
  let view!: ReturnType<typeof render>;
  await act(async () => {
    view = render(<BankSyncCallbackPage />);
  });
  return view;
}

beforeEach(() => {
  vi.clearAllMocks();
  mockSearchParams = new URLSearchParams();
  vi.spyOn(window.history, 'replaceState').mockImplementation(() => {});
});

describe('BankSyncCallbackPage', () => {
  it('shows a loading screen while the connection is completed', async () => {
    mockCompleteCallback.mockReturnValue(new Promise(() => {}));

    await renderCallback('state=s1&code=c1');

    expect(screen.getByText('Connecting your bank')).toBeInTheDocument();
    expect(mockReplace).not.toHaveBeenCalled();
  });

  it('posts the state and code, then returns to the settings page with a success toast', async () => {
    mockCompleteCallback.mockResolvedValue(activeConnection);

    await renderCallback('state=s1&code=c1');

    await waitFor(() => expect(mockReplace).toHaveBeenCalledWith('/settings/bank-sync'));
    expect(mockCompleteCallback).toHaveBeenCalledWith({ state: 's1', code: 'c1' });
    expect(toast.success).toHaveBeenCalledWith('Connected to Alpha Bank');
    expect(toast.error).not.toHaveBeenCalled();
  });

  it('takes the state and code out of the address bar before anything else', async () => {
    mockCompleteCallback.mockReturnValue(new Promise(() => {}));

    await renderCallback('state=s1&code=c1');

    // Only the path is kept, so the single-use state and code reach neither
    // history nor a bookmark.
    expect(window.history.replaceState).toHaveBeenCalledWith(null, '', window.location.pathname);
    expect(window.history.replaceState).toHaveBeenCalledTimes(1);
  });

  it('reports the bank\'s refusal, records it, and returns', async () => {
    mockCompleteCallback.mockResolvedValue({
      ...activeConnection,
      status: 'failed',
      lastError: 'User cancelled',
    });

    await renderCallback('state=s1&error=access_denied&error_description=User+cancelled');

    await waitFor(() => expect(mockReplace).toHaveBeenCalledWith('/settings/bank-sync'));
    expect(mockCompleteCallback).toHaveBeenCalledWith({
      state: 's1',
      error: 'access_denied',
      errorDescription: 'User cancelled',
    });
    expect(toast.error).toHaveBeenCalledWith('Your bank did not grant access: User cancelled');
    expect(toast.success).not.toHaveBeenCalled();
  });

  it('falls back to the error code when the bank gave no description', async () => {
    mockCompleteCallback.mockResolvedValue({ ...activeConnection, status: 'failed' });

    await renderCallback('state=s1&error=access_denied');

    await waitFor(() => expect(mockReplace).toHaveBeenCalled());
    expect(toast.error).toHaveBeenCalledWith('Your bank did not grant access: access_denied');
  });

  it('bounds the bank\'s message', async () => {
    mockCompleteCallback.mockResolvedValue({ ...activeConnection, status: 'failed' });

    await renderCallback(`state=s1&error=e&error_description=${'x'.repeat(1000)}`);

    await waitFor(() => expect(mockReplace).toHaveBeenCalled());
    expect(toast.error).toHaveBeenCalledWith(
      `Your bank did not grant access: ${'x'.repeat(300)}`,
    );
  });

  it('still shows the bank\'s refusal when the server could not record it', async () => {
    mockCompleteCallback.mockRejectedValue({ response: { data: { message: 'Unknown state' } } });

    await renderCallback('state=s1&error=access_denied&error_description=Nope');

    await waitFor(() => expect(mockReplace).toHaveBeenCalledWith('/settings/bank-sync'));
    expect(toast.error).toHaveBeenCalledWith('Your bank did not grant access: Nope');
  });

  it('shows the server message when the connection is refused, and returns', async () => {
    mockCompleteCallback.mockRejectedValue({
      response: { data: { message: 'The authorization has expired' } },
    });

    await renderCallback('state=s1&code=c1');

    await waitFor(() => expect(mockReplace).toHaveBeenCalledWith('/settings/bank-sync'));
    expect(toast.error).toHaveBeenCalledWith('The authorization has expired');
  });

  it('does not report success for a connection that did not become active', async () => {
    mockCompleteCallback.mockResolvedValue({
      ...activeConnection,
      status: 'failed',
      lastError: 'Consent was not granted',
    });

    await renderCallback('state=s1&code=c1');

    await waitFor(() => expect(mockReplace).toHaveBeenCalled());
    expect(toast.success).not.toHaveBeenCalled();
    expect(toast.error).toHaveBeenCalledWith('Consent was not granted');
  });

  it('says the connection could not be completed when it is not active and gave no reason', async () => {
    mockCompleteCallback.mockResolvedValue({ ...activeConnection, status: 'pending', lastError: null });

    await renderCallback('state=s1&code=c1');

    await waitFor(() => expect(mockReplace).toHaveBeenCalled());
    expect(toast.error).toHaveBeenCalledWith('The connection could not be completed');
  });

  it('refuses a callback with no state without calling the server', async () => {
    await renderCallback('code=c1');

    await waitFor(() => expect(mockReplace).toHaveBeenCalledWith('/settings/bank-sync'));
    expect(mockCompleteCallback).not.toHaveBeenCalled();
    expect(toast.error).toHaveBeenCalledWith(
      'The bank did not return a valid response. Start the connection again.',
    );
  });

  it('refuses a callback with neither a code nor an error without calling the server', async () => {
    await renderCallback('state=s1');

    await waitFor(() => expect(mockReplace).toHaveBeenCalledWith('/settings/bank-sync'));
    expect(mockCompleteCallback).not.toHaveBeenCalled();
    expect(toast.error).toHaveBeenCalled();
  });

  it('refuses an empty query', async () => {
    await renderCallback('');

    await waitFor(() => expect(mockReplace).toHaveBeenCalledWith('/settings/bank-sync'));
    expect(mockCompleteCallback).not.toHaveBeenCalled();
  });

  it('posts the callback exactly once, however often it re-renders', async () => {
    mockCompleteCallback.mockResolvedValue(activeConnection);

    const view = await renderCallback('state=s1&code=c1');
    // A new URLSearchParams instance (what stripping the query produces) and a
    // re-render must not post the single-use state a second time.
    mockSearchParams = new URLSearchParams();
    await act(async () => {
      view.rerender(<BankSyncCallbackPage />);
    });
    await act(async () => {
      view.rerender(<BankSyncCallbackPage />);
    });

    await waitFor(() => expect(mockReplace).toHaveBeenCalledTimes(1));
    expect(mockCompleteCallback).toHaveBeenCalledTimes(1);
    expect(toast.success).toHaveBeenCalledTimes(1);
    expect(toast.error).not.toHaveBeenCalled();
  });
});
