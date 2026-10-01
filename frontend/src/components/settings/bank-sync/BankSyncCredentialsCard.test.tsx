import { describe, it, expect, vi, beforeEach } from 'vitest';
import toast from 'react-hot-toast';
import { act, fireEvent, render, screen, waitFor, within } from '@/test/render';
import {
  BANK_SYNC_PRIVACY_TEMPLATE_URL,
  BANK_SYNC_TERMS_TEMPLATE_URL,
  ENABLE_BANKING_SITE_URL,
} from '@/lib/bank-sync-links';
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

  it('says the redirect URL does not have to be reachable from the internet', () => {
    renderCard(status());

    expect(
      screen.getByText(
        'The redirect URL does not have to be reachable from the internet. Only your browser opens it.',
      ),
    ).toBeInTheDocument();
  });

  describe('redirect URL scheme', () => {
    const WARNING =
      'A "Production" application accepts only an https redirect URL. This one uses http, so it works only with a "Sandbox" application. Set PUBLIC_APP_URL to the https address of Monize.';

    it('warns that an http redirect URL works only with a Sandbox application', () => {
      renderCard(status({ redirectUrl: 'http://monize.example/settings/bank-sync/callback' }));

      expect(screen.getByText(WARNING)).toBeInTheDocument();
    });

    it('reads the scheme case-insensitively', () => {
      renderCard(status({ redirectUrl: 'HTTP://monize.example/settings/bank-sync/callback' }));

      expect(screen.getByText(WARNING)).toBeInTheDocument();
    });

    it('does not warn about an https redirect URL', () => {
      renderCard(status());

      expect(screen.queryByText(WARNING)).toBeNull();
    });

    it('does not mistake an https URL that merely contains http:// for an http one', () => {
      renderCard(status({ redirectUrl: 'https://monize.example/?next=http://elsewhere' }));

      expect(screen.queryByText(WARNING)).toBeNull();
    });
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

  describe('setup help', () => {
    const SHOW = 'Show setup help';
    const HIDE = 'Hide setup help';

    it('is expanded, with no toggle, while no credentials are stored', () => {
      renderCard(status());

      expect(screen.getByRole('heading', { name: 'What is Enable Banking?' })).toBeInTheDocument();
      expect(screen.getByRole('heading', { name: 'How to set it up' })).toBeInTheDocument();
      expect(screen.getByRole('heading', { name: 'Network access' })).toBeInTheDocument();
      expect(screen.getByText(/licensed in the EU/)).toBeInTheDocument();
      expect(screen.getByText(/free application in restricted production mode/)).toBeInTheDocument();
      expect(screen.getByText(/api\.enablebanking\.com over HTTPS/)).toBeInTheDocument();
      expect(screen.queryByRole('button', { name: SHOW })).toBeNull();
      expect(screen.queryByRole('button', { name: HIDE })).toBeNull();
    });

    it('lists seven steps in order, the link in the first and the redirect URL in the fourth', () => {
      renderCard(status());

      const list = screen.getByRole('list');
      const items = within(list).getAllByRole('listitem');
      expect(list.tagName).toBe('OL');
      expect(items).toHaveLength(7);
      expect(items[0]).toHaveTextContent(
        'Create an account at Enable Banking (select "Get Started" and wait for the confirmation email). Then sign in to the control panel and open "API applications".',
      );
      expect(
        within(items[0]).getByRole('link', { name: 'Enable Banking' }),
      ).toHaveAttribute('href', ENABLE_BANKING_SITE_URL);
      expect(items[1]).toHaveTextContent(
        'Select "Production". Monize reads your real bank accounts only through a Production application. Select "Sandbox" only if you want to try the connection first: it shows only demo data from test banks.',
      );
      expect(items[2]).toHaveTextContent('Keep "Generate in the browser" for the private key.');
      expect(items[3]).toHaveTextContent(
        'Enter an application name. Paste the redirect URL below into "Allowed redirect URLs". For "Production", the control panel also requires a description, an email for data protection matters, a privacy URL and a terms URL.',
      );
      expect(items[4]).toHaveTextContent(/^Select "Register"\./);
      expect(items[5]).toHaveTextContent(
        'For "Production", the new application shows "Inactive". Select "Activate by linking accounts", select the country, your bank and the usage type ("personal" for a personal account, "business" for a company account), and select "Link". Then sign in at your bank and authorize your accounts. Do not select "Request activation": it asks for general availability, which personal use does not need. Without linked accounts the bank returns no accounts. Later, when you connect the bank in Monize, select the same usage type.',
      );
      expect(items[6]).toHaveTextContent(
        'Enter the application ID from the application list, and load the private key file here.',
      );
      expect(within(list).getAllByRole('link')).toHaveLength(3);
      expect(screen.getByLabelText('Redirect URL')).toBeInTheDocument();
    });

    it('gives the personal-use advice for step four as a sub-paragraph of that step', () => {
      renderCard(status());

      const items = within(screen.getByRole('list')).getAllByRole('listitem');
      const advice = within(items[3]).getByText(/^For personal use: describe the application/);
      expect(advice.tagName).toBe('P');
      expect(advice).toHaveTextContent(
        'For personal use: describe the application as your own self-hosted personal finance manager and enter your own email address. For the two URLs you can enter the Monize templates: privacy notice and terms of use. If other people use your Monize instance, publish your own version with your name instead. In restricted mode, Enable Banking does not check these two URLs.',
      );
      expect(within(items[2]).queryByText(/For personal use/)).toBeNull();
    });

    it('links the privacy and terms templates in step four, in a new tab', () => {
      renderCard(status());

      const items = within(screen.getByRole('list')).getAllByRole('listitem');
      const privacy = within(items[3]).getByRole('link', { name: 'privacy notice' });
      const terms = within(items[3]).getByRole('link', { name: 'terms of use' });
      expect(privacy).toHaveAttribute('href', BANK_SYNC_PRIVACY_TEMPLATE_URL);
      expect(terms).toHaveAttribute('href', BANK_SYNC_TERMS_TEMPLATE_URL);
      for (const link of [privacy, terms]) {
        expect(link).toHaveAttribute('target', '_blank');
        expect(link).toHaveAttribute('rel', 'noopener noreferrer');
      }
    });

    it('warns after the steps that Sandbox transactions are demo data', () => {
      renderCard(status());

      const list = screen.getByRole('list');
      const note = screen.getByText(
        'Transactions from a Sandbox application are demo data. Link a Sandbox bank account only to a test account in Monize, not to an account that holds your real transactions.',
      );
      expect(note.tagName).toBe('P');
      expect(list.contains(note)).toBe(false);
      expect(
        list.compareDocumentPosition(note) & Node.DOCUMENT_POSITION_FOLLOWING,
      ).toBeTruthy();
    });

    it('does not show the Sandbox note while the help is folded', () => {
      renderCard(configured());

      expect(screen.queryByText(/Transactions from a Sandbox application/)).toBeNull();
    });

    it('is folded behind a toggle once credentials are stored', () => {
      renderCard(configured());

      const toggle = screen.getByRole('button', { name: SHOW });
      expect(toggle).toHaveAttribute('aria-expanded', 'false');
      expect(toggle).not.toHaveAttribute('aria-controls');
      expect(screen.queryByRole('heading', { name: 'What is Enable Banking?' })).toBeNull();
      expect(screen.queryByRole('heading', { name: 'How to set it up' })).toBeNull();
      expect(screen.queryByRole('heading', { name: 'Network access' })).toBeNull();
    });

    it('opens and folds with the toggle, naming the panel it controls while open', async () => {
      renderCard(configured());

      await click(SHOW);

      const toggle = screen.getByRole('button', { name: HIDE });
      expect(toggle).toHaveAttribute('aria-expanded', 'true');
      const panelId = toggle.getAttribute('aria-controls');
      expect(panelId).toBeTruthy();
      const panel = document.getElementById(panelId as string);
      expect(panel).not.toBeNull();
      expect(
        within(panel as HTMLElement).getByRole('heading', { name: 'What is Enable Banking?' }),
      ).toBeInTheDocument();
      expect(screen.queryByRole('button', { name: SHOW })).toBeNull();

      await click(HIDE);

      expect(screen.getByRole('button', { name: SHOW })).toHaveAttribute('aria-expanded', 'false');
      expect(screen.queryByRole('heading', { name: 'How to set it up' })).toBeNull();
    });

    it('opens the Enable Banking site from step one in a new tab without handing it window.opener', () => {
      renderCard(status());

      const link = screen.getByRole('link', { name: 'Enable Banking' });
      expect(link).toHaveAttribute('href', ENABLE_BANKING_SITE_URL);
      expect(link).toHaveAttribute('target', '_blank');
      expect(link).toHaveAttribute('rel', 'noopener noreferrer');
    });

    it('keeps the subtitle plain text, with the links only in the steps', () => {
      renderCard(status());

      expect(screen.getAllByRole('link')).toHaveLength(3);
      expect(within(screen.getByRole('list')).getAllByRole('link')).toHaveLength(3);
    });

    it('opens again when the credentials are removed', () => {
      const onStatusChange = vi.fn();
      const { rerender } = render(
        <BankSyncCredentialsCard status={configured()} onStatusChange={onStatusChange} />,
      );
      expect(screen.queryByRole('heading', { name: 'How to set it up' })).toBeNull();

      rerender(<BankSyncCredentialsCard status={status()} onStatusChange={onStatusChange} />);

      expect(screen.getByRole('heading', { name: 'How to set it up' })).toBeInTheDocument();
    });
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
