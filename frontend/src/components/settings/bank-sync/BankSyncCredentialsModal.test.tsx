import { describe, it, expect, vi, beforeEach } from 'vitest';
import { act, fireEvent, render, screen, waitFor } from '@/test/render';
import { BankSyncCredentialsModal } from './BankSyncCredentialsModal';

const PEM = '-----BEGIN PRIVATE KEY-----\nMIIEvQIBADANBgkq\n-----END PRIVATE KEY-----';

function renderModal(over: { applicationId?: string | null; privateKeySet?: boolean } = {}) {
  const onSave = vi.fn().mockResolvedValue(undefined);
  const onClose = vi.fn();
  render(
    <BankSyncCredentialsModal
      isOpen
      applicationId={over.applicationId ?? null}
      privateKeySet={over.privateKeySet ?? false}
      onClose={onClose}
      onSave={onSave}
    />,
  );
  return { onSave, onClose };
}

const applicationIdField = () => screen.getByLabelText('Application ID');
const keyField = () => screen.getByLabelText('Private key (PEM)');
const submit = async () => {
  await act(async () => {
    fireEvent.click(screen.getByRole('button', { name: 'Save' }));
  });
};

beforeEach(() => {
  vi.clearAllMocks();
});

describe('BankSyncCredentialsModal', () => {
  it('never renders a stored key, only a placeholder saying one is stored', () => {
    renderModal({ applicationId: 'app-1', privateKeySet: true });

    expect(keyField()).toHaveValue('');
    expect(keyField().getAttribute('placeholder')).toMatch(/A key is stored/);
    expect(applicationIdField()).toHaveValue('app-1');
  });

  it('shows the plain placeholder when no key is stored', () => {
    renderModal();

    expect(keyField().getAttribute('placeholder')).not.toMatch(/A key is stored/);
  });

  it('declares the key field as not this site\'s credential and unchecked by spelling', () => {
    renderModal();

    expect(keyField()).toHaveAttribute('autocomplete', 'off');
    expect(keyField()).toHaveAttribute('spellcheck', 'false');
  });

  it('omits the key when the field was left alone and one is stored', async () => {
    const { onSave } = renderModal({ applicationId: 'app-1', privateKeySet: true });

    await submit();

    await waitFor(() => expect(onSave).toHaveBeenCalled());
    expect(onSave).toHaveBeenCalledWith({ applicationId: 'app-1' });
    expect(onSave.mock.calls[0][0]).not.toHaveProperty('privateKey');
  });

  it('treats a whitespace-only key like an untouched one when one is stored', async () => {
    const { onSave } = renderModal({ applicationId: 'app-1', privateKeySet: true });

    fireEvent.change(keyField(), { target: { value: '   \n ' } });
    await submit();

    await waitFor(() => expect(onSave).toHaveBeenCalled());
    expect(onSave.mock.calls[0][0]).not.toHaveProperty('privateKey');
  });

  it('requires a key when none is stored', async () => {
    const { onSave } = renderModal();

    fireEvent.change(applicationIdField(), { target: { value: 'app-1' } });
    await submit();

    expect(await screen.findByText('Enter the private key')).toBeInTheDocument();
    expect(onSave).not.toHaveBeenCalled();
  });

  it('requires the application ID', async () => {
    const { onSave } = renderModal({ privateKeySet: true });

    await submit();

    expect(await screen.findByText('Enter the application ID')).toBeInTheDocument();
    expect(onSave).not.toHaveBeenCalled();
  });

  it.each([
    ['plain text', 'not a key'],
    ['a certificate', '-----BEGIN CERTIFICATE-----\nabc\n-----END CERTIFICATE-----'],
    ['a public key', '-----BEGIN PUBLIC KEY-----\nabc\n-----END PUBLIC KEY-----'],
  ])('refuses %s as the key', async (_label, value) => {
    const { onSave } = renderModal({ applicationId: 'app-1' });

    fireEvent.change(keyField(), { target: { value } });
    await submit();

    expect(
      await screen.findByText(/does not look like a PEM private key/),
    ).toBeInTheDocument();
    expect(onSave).not.toHaveBeenCalled();
  });

  it('sends a pasted PEM key with the application ID, trimmed', async () => {
    const { onSave } = renderModal();

    fireEvent.change(applicationIdField(), { target: { value: '  app-2  ' } });
    fireEvent.change(keyField(), { target: { value: `\n${PEM}\n` } });
    await submit();

    await waitFor(() => expect(onSave).toHaveBeenCalled());
    expect(onSave).toHaveBeenCalledWith({ applicationId: 'app-2', privateKey: PEM });
  });

  it('accepts an RSA PRIVATE KEY block as well', async () => {
    const { onSave } = renderModal({ applicationId: 'app-1' });
    const rsa = '-----BEGIN RSA PRIVATE KEY-----\nabc\n-----END RSA PRIVATE KEY-----';

    fireEvent.change(keyField(), { target: { value: rsa } });
    await submit();

    await waitFor(() => expect(onSave).toHaveBeenCalledWith({ applicationId: 'app-1', privateKey: rsa }));
  });

  it('closes through Cancel without saving', async () => {
    const { onSave, onClose } = renderModal();

    fireEvent.click(screen.getByRole('button', { name: 'Cancel' }));

    expect(onClose).toHaveBeenCalled();
    expect(onSave).not.toHaveBeenCalled();
  });
});
