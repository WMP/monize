import { describe, it, expect, vi, beforeEach } from 'vitest';
import toast from 'react-hot-toast';
import { act, fireEvent, render, screen, waitFor } from '@/test/render';
import { BankSyncCredentialsCard } from './BankSyncCredentialsCard';
import type { BankSyncStatus } from '@/types/bank-sync';

const mockSave = vi.fn();
const mockDelete = vi.fn();
const mockTest = vi.fn();

vi.mock('@/lib/bank-sync', () => ({
  bankSyncApi: {
    saveCredentials: (...args: unknown[]) => mockSave(...args),
    deleteCredentials: (...args: unknown[]) => mockDelete(...args),
    testCredentials: (...args: unknown[]) => mockTest(...args),
  },
}));

const REDIRECT = 'https://monize.example/settings/bank-sync/callback';

const status = (over: Partial<BankSyncStatus> = {}): BankSyncStatus => ({
  encryptionAvailable: true,
  providers: ['enable_banking'],
  credentials: null,
  redirectUrl: REDIRECT,
  ...over,
});

const configured = (): BankSyncStatus =>
  status({
    credentials: {
      provider: 'enable_banking',
      applicationId: 'app-123',
      privateKeySet: true,
    },
  });

function renderCard(s: BankSyncStatus, disabled = false) {
  const onStatusChange = vi.fn();
  render(
    <BankSyncCredentialsCard
      status={s}
      disabled={disabled}
      onStatusChange={onStatusChange}
    />,
  );
  return { onStatusChange };
}

const click = async (name: string | RegExp) => {
  await act(async () => {
    fireEvent.click(screen.getByRole('button', { name }));
  });
};

beforeEach(() => {
  vi.clearAllMocks();
  Object.defineProperty(navigator, 'clipboard', {
    value: { writeText: vi.fn().mockResolvedValue(undefined) },
    configurable: true,
  });
});

describe('BankSyncCredentialsCard', () => {
  it('shows the redirect URL read-only and copies it', async () => {
    renderCard(status());

    const field = screen.getByLabelText('Redirect URL');
    expect(field).toHaveValue(REDIRECT);
    expect(field).toHaveAttribute('readonly');
    expect(screen.getByText(/Register this exact URL/)).toBeInTheDocument();

    await click('Copy');

    expect(navigator.clipboard.writeText).toHaveBeenCalledWith(REDIRECT);
    expect(toast.success).toHaveBeenCalledWith('Copied');
  });

  it('reports a copy that failed', async () => {
    vi.mocked(navigator.clipboard.writeText).mockRejectedValue(new Error('denied'));
    renderCard(status());

    await click('Copy');

    expect(toast.error).toHaveBeenCalledWith('Could not copy the redirect URL');
  });

  it('says no application is set up, and offers setup rather than test or remove', () => {
    renderCard(status());

    expect(screen.getByText('No application is set up yet.')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Set up credentials' })).toBeEnabled();
    expect(screen.queryByRole('button', { name: 'Test connection' })).toBeNull();
    expect(screen.queryByRole('button', { name: 'Remove credentials' })).toBeNull();
  });

  it('shows the stored application ID and that a key is stored, never the key', () => {
    renderCard(configured());

    expect(screen.getByText('app-123')).toBeInTheDocument();
    expect(screen.getByText('A private key is stored.')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Edit credentials' })).toBeInTheDocument();
  });

  it('warns and disables saving when the server cannot encrypt', () => {
    renderCard(status({ encryptionAvailable: false }));

    expect(screen.getByRole('alert')).toHaveTextContent(/no encryption key/);
    expect(screen.getByRole('button', { name: 'Set up credentials' })).toBeDisabled();
  });

  it('disables every control in demo mode', () => {
    renderCard(configured(), true);

    expect(screen.getByRole('button', { name: 'Edit credentials' })).toBeDisabled();
    expect(screen.getByRole('button', { name: 'Test connection' })).toBeDisabled();
    expect(screen.getByRole('button', { name: 'Remove credentials' })).toBeDisabled();
  });

  it('saves through the modal and hands the server status to the page', async () => {
    const saved = configured();
    mockSave.mockResolvedValue(saved);
    const { onStatusChange } = renderCard(status());

    await click('Set up credentials');
    fireEvent.change(screen.getByLabelText('Application ID'), { target: { value: 'app-123' } });
    fireEvent.change(screen.getByLabelText('Private key (PEM)'), {
      target: { value: '-----BEGIN PRIVATE KEY-----\nabc\n-----END PRIVATE KEY-----' },
    });
    await click('Save');

    await waitFor(() => expect(onStatusChange).toHaveBeenCalledWith(saved));
    expect(mockSave).toHaveBeenCalledWith({
      applicationId: 'app-123',
      privateKey: '-----BEGIN PRIVATE KEY-----\nabc\n-----END PRIVATE KEY-----',
    });
    expect(toast.success).toHaveBeenCalled();
    expect(screen.queryByLabelText('Private key (PEM)')).toBeNull();
  });

  it('keeps the modal open and shows the server message when saving fails', async () => {
    mockSave.mockRejectedValue({ response: { data: { message: 'Not an RSA key' } } });
    const { onStatusChange } = renderCard(configured());

    await click('Edit credentials');
    await click('Save');

    await waitFor(() => expect(toast.error).toHaveBeenCalledWith('Not an RSA key'));
    expect(onStatusChange).not.toHaveBeenCalled();
    expect(screen.getByLabelText('Private key (PEM)')).toBeInTheDocument();
  });

  it('confirms before removing credentials, then reports them removed', async () => {
    mockDelete.mockResolvedValue(undefined);
    const { onStatusChange } = renderCard(configured());

    await click('Remove credentials');
    expect(mockDelete).not.toHaveBeenCalled();
    await click('Remove');

    await waitFor(() =>
      expect(onStatusChange).toHaveBeenCalledWith(expect.objectContaining({ credentials: null })),
    );
    expect(mockDelete).toHaveBeenCalled();
  });

  it('does not remove anything when the confirmation is cancelled', async () => {
    renderCard(configured());

    await click('Remove credentials');
    await click('Cancel');

    expect(mockDelete).not.toHaveBeenCalled();
  });

  describe('test connection', () => {
    it('reports a working application by name', async () => {
      mockTest.mockResolvedValue({ ok: true, applicationName: 'My App', redirectUrls: [REDIRECT] });
      renderCard(configured());

      await click('Test connection');

      expect(await screen.findByText('The application works: My App')).toBeInTheDocument();
    });

    it('warns when the provider lists redirect URLs and ours is not among them', async () => {
      mockTest.mockResolvedValue({
        ok: true,
        applicationName: 'My App',
        redirectUrls: ['https://elsewhere.example/cb'],
      });
      renderCard(configured());

      await click('Test connection');

      expect(await screen.findByText(/not registered for it/)).toBeInTheDocument();
    });

    it('does not warn when the provider lists no redirect URLs at all', async () => {
      mockTest.mockResolvedValue({ ok: true, applicationName: 'My App', redirectUrls: [] });
      renderCard(configured());

      await click('Test connection');

      await screen.findByText('The application works: My App');
      expect(screen.queryByText(/not registered for it/)).toBeNull();
    });

    it('reports credentials the provider did not accept', async () => {
      mockTest.mockResolvedValue({ ok: false, applicationName: '', redirectUrls: [] });
      renderCard(configured());

      await click('Test connection');

      expect(
        await screen.findByText('The provider did not accept these credentials.'),
      ).toBeInTheDocument();
    });

    it('says the test itself failed, not that the credentials are wrong', async () => {
      mockTest.mockRejectedValue({ response: { data: { message: 'Provider unavailable' } } });
      renderCard(configured());

      await click('Test connection');

      expect(await screen.findByText('Provider unavailable')).toBeInTheDocument();
      expect(screen.queryByText('The provider did not accept these credentials.')).toBeNull();
    });
  });
});
