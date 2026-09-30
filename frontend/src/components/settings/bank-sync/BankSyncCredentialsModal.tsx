'use client';

import { useForm } from 'react-hook-form';
import { zodResolver } from '@hookform/resolvers/zod';
import { z } from 'zod';
import { useTranslations } from 'next-intl';
import '@/lib/zodConfig';
import { Button } from '@/components/ui/Button';
import { Input } from '@/components/ui/Input';
import { Modal } from '@/components/ui/Modal';
import { cn, inputBaseClasses, inputErrorClasses } from '@/lib/utils';
import type { SaveBankSyncCredentials } from '@/types/bank-sync';
import { EnableBankingControlPanelLink } from './EnableBankingControlPanelLink';

const APPLICATION_ID_MAX = 200;
const PRIVATE_KEY_MAX = 20000;

type Translate = (key: string) => string;

/**
 * Built from `t` so the messages are localized, and from `keyStored` because
 * what the key field owes depends on it: with no key stored it is required,
 * with one stored an empty field means "keep it".
 *
 * The format check is a sanity check on what was pasted (a PEM block naming a
 * private key), not a parse. The server parses it as an RSA key and answers 400
 * with its own reason when it is not one.
 */
function buildSchema(t: Translate, keyStored: boolean) {
  return z.object({
    applicationId: z
      .string()
      .trim()
      .min(1, t('applicationIdRequired'))
      .max(APPLICATION_ID_MAX, t('applicationIdTooLong')),
    privateKey: z
      .string()
      .max(PRIVATE_KEY_MAX, t('privateKeyTooLong'))
      .superRefine((value, ctx) => {
        const key = value.trim();
        if (key === '') {
          if (!keyStored) {
            ctx.addIssue({ code: 'custom', message: t('privateKeyRequired') });
          }
          return;
        }
        if (!key.includes('-----BEGIN') || !key.includes('PRIVATE KEY-----')) {
          ctx.addIssue({ code: 'custom', message: t('privateKeyInvalid') });
        }
      }),
  });
}

type FormData = z.infer<ReturnType<typeof buildSchema>>;

interface BankSyncCredentialsModalProps {
  isOpen: boolean;
  /** The application ID stored now, or null when nothing is stored. */
  applicationId: string | null;
  /** A key is stored. The key itself is never sent to the browser. */
  privateKeySet: boolean;
  onClose: () => void;
  onSave: (data: SaveBankSyncCredentials) => Promise<void>;
}

/**
 * The application ID and private key of the user's Enable Banking application.
 *
 * The key field is never prefilled: the server does not send it, and a stored
 * key is signalled by the placeholder. An untouched field means "keep the
 * stored key", so it is left out of the request rather than sent empty -- the
 * user cannot see the key to retype it, and an empty value could read as a
 * request to clear it.
 */
export function BankSyncCredentialsModal({
  isOpen,
  applicationId,
  privateKeySet,
  onClose,
  onSave,
}: BankSyncCredentialsModalProps) {
  const t = useTranslations('settings.bankSync.credentialsModal');
  // modalSource lives beside the card's help copy, under `credentials`.
  const tCredentials = useTranslations('settings.bankSync.credentials');

  const {
    register,
    handleSubmit,
    formState: { errors, isSubmitting },
  } = useForm<FormData>({
    resolver: zodResolver(buildSchema(t, privateKeySet)),
    defaultValues: { applicationId: applicationId ?? '', privateKey: '' },
  });

  const submit = handleSubmit(async (data) => {
    const update: SaveBankSyncCredentials = { applicationId: data.applicationId };
    const key = data.privateKey.trim();
    if (key !== '') update.privateKey = key;
    await onSave(update);
  });

  return (
    <Modal
      isOpen={isOpen}
      onClose={onClose}
      title={t('title')}
      description={t('subtitle')}
      padding="md"
      maxWidth="lg"
      pushHistory
    >
      <p className="mb-4 text-sm text-gray-600 dark:text-gray-400">
        {tCredentials.rich('modalSource', {
          link: (chunks) => (
            <EnableBankingControlPanelLink>{chunks}</EnableBankingControlPanelLink>
          ),
        })}
      </p>
      <form onSubmit={submit} className="space-y-4" noValidate>
        <Input
          label={t('applicationIdLabel')}
          id="bank-sync-application-id"
          autoComplete="off"
          spellCheck={false}
          {...register('applicationId')}
          error={errors.applicationId?.message}
          placeholder={t('applicationIdPlaceholder')}
        />

        <div>
          <label
            htmlFor="bank-sync-private-key"
            className="mb-1 block text-sm font-medium text-gray-700 dark:text-gray-300"
          >
            {t('privateKeyLabel')}
          </label>
          <textarea
            id="bank-sync-private-key"
            rows={6}
            // Not a credential of this site: a password manager must not fill
            // the account password into the provider's key.
            autoComplete="off"
            spellCheck={false}
            className={cn(
              inputBaseClasses,
              'border px-3 py-2 font-mono text-xs',
              errors.privateKey && inputErrorClasses,
            )}
            placeholder={
              privateKeySet
                ? t('privateKeyStoredPlaceholder')
                : t('privateKeyPlaceholder')
            }
            {...register('privateKey')}
          />
          {errors.privateKey?.message ? (
            <p className="mt-1 text-sm text-red-600 dark:text-red-400">
              {errors.privateKey.message}
            </p>
          ) : (
            <p className="mt-1 text-xs text-gray-500 dark:text-gray-400">
              {t('privateKeyHelp')}
            </p>
          )}
        </div>

        <div className="flex justify-end gap-2 pt-2">
          <Button type="button" variant="outline" onClick={onClose}>
            {t('cancel')}
          </Button>
          <Button type="submit" disabled={isSubmitting}>
            {isSubmitting ? t('saving') : t('save')}
          </Button>
        </div>
      </form>
    </Modal>
  );
}
