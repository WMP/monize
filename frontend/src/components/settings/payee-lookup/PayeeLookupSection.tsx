'use client';

import { useCallback, useEffect, useState } from 'react';
import toast from 'react-hot-toast';
import { useTranslations } from 'next-intl';
import { Button } from '@/components/ui/Button';
import { Card } from '@/components/ui/Card';
import { ToggleSwitch } from '@/components/ui/ToggleSwitch';
import { useContactLookupAvailable } from '@/hooks/useContactLookupAvailable';
import { getErrorMessage } from '@/lib/errors';
import { payeeLookupApi } from '@/lib/payee-lookup';
import type {
  PayeeLookupSettings,
  UpdatePayeeLookupSettings,
} from '@/types/payee-lookup';
import { GooglePlacesConfigModal } from './GooglePlacesConfigModal';
import { PayeeContactLookupToggle } from './PayeeContactLookupToggle';

interface PayeeLookupSectionProps {
  disabled?: boolean;
}

/**
 * Where a payee's website, address, email and phone come from.
 *
 * Its own settings section rather than a corner of AI Settings, because Google
 * Places is not an AI provider: a user who configures Places and no AI would
 * otherwise have to go to a screen about models to set up a business
 * directory, and the automatic-lookup switch below it would sit under a
 * heading that no longer describes what answers the lookup.
 *
 * Two save contracts on one screen, deliberately. The on/off switch and the
 * automatic-lookup toggle save as they change (the section's contract). The
 * key and the cap are edited in a modal with an explicit Save, because a key
 * is invalid until it is complete -- saving it per keystroke would store a
 * dozen broken credentials and test none of them.
 */
export function PayeeLookupSection({ disabled = false }: PayeeLookupSectionProps) {
  const t = useTranslations('settings.payeeLookup');
  const [settings, setSettings] = useState<PayeeLookupSettings | null>(null);
  const [loadFailed, setLoadFailed] = useState(false);
  const [saving, setSaving] = useState(false);
  const [showConfig, setShowConfig] = useState(false);
  // Whether ANY source can answer -- Places within its cap, or an AI provider.
  // The automatic-lookup toggle is about a lookup that runs by itself, so it is
  // offered only when something could actually run.
  const { available: lookupAvailable } = useContactLookupAvailable();

  useEffect(() => {
    let active = true;
    payeeLookupApi
      .getSettings()
      .then((data) => {
        if (active) setSettings(data);
      })
      .catch(() => {
        // A failed read is not "nothing configured": rendering the empty state
        // would invite the user to enter a key they may already have stored.
        if (active) setLoadFailed(true);
      });
    return () => {
      active = false;
    };
  }, []);

  const save = useCallback(
    async (update: UpdatePayeeLookupSettings) => {
      setSaving(true);
      try {
        const saved = await payeeLookupApi.updateSettings(update);
        setSettings(saved);
        toast.success(t('saved'));
        return saved;
      } finally {
        setSaving(false);
      }
    },
    [t],
  );

  const handleToggle = async (next: boolean) => {
    if (!settings || saving) return;
    const previous = settings;
    setSettings({ ...settings, enabled: next });
    try {
      await save({ enabled: next });
    } catch (error) {
      // Revert to the value THIS change replaced, so two changes in flight
      // cannot restore each other's.
      setSettings(previous);
      toast.error(getErrorMessage(error, t('saveFailed')));
    }
  };

  const handleSaveConfig = async (update: UpdatePayeeLookupSettings) => {
    try {
      await save(update);
      setShowConfig(false);
    } catch (error) {
      toast.error(getErrorMessage(error, t('saveFailed')));
    }
  };

  const handleRemoveKey = async () => {
    try {
      await save({ apiKey: '' });
    } catch (error) {
      toast.error(getErrorMessage(error, t('saveFailed')));
    }
  };

  if (loadFailed) {
    return (
      <Card padding="md" className="mb-6">
        <h2 className="mb-1 text-lg font-semibold text-gray-900 dark:text-gray-100">
          {t('title')}
        </h2>
        <p className="text-sm text-red-600 dark:text-red-400">{t('loadFailed')}</p>
      </Card>
    );
  }

  if (!settings) return null;

  const operatorManaged = settings.mode === 'operator';

  return (
    <>
      <Card padding="md" className="mb-6">
        <h2 className="mb-1 text-lg font-semibold text-gray-900 dark:text-gray-100">
          {t('title')}
        </h2>
        <p className="mb-4 text-sm text-gray-500 dark:text-gray-400">
          {t('subtitle')}
        </p>

        <div className="flex items-start justify-between gap-4">
          <div>
            <p className="text-sm font-medium text-gray-900 dark:text-gray-100">
              {t('googlePlaces.title')}
            </p>
            <p className="text-xs text-gray-500 dark:text-gray-400">
              {operatorManaged
                ? t('googlePlaces.operatorManaged')
                : settings.configured
                  ? t('googlePlaces.configured')
                  : t('googlePlaces.notConfigured')}
            </p>
          </div>
          <ToggleSwitch
            checked={settings.enabled}
            onChange={handleToggle}
            disabled={disabled || saving}
            label={t('googlePlaces.toggleLabel')}
          />
        </div>

        {/* A key that cannot be decrypted is not the same as no key: say so,
            because the repair is to enter it again rather than for the first
            time. */}
        {!settings.apiKeyReadable && (
          <p className="mt-3 text-sm text-amber-700 dark:text-amber-300">
            {t('googlePlaces.keyUnreadable')}
          </p>
        )}

        {!operatorManaged && !settings.encryptionAvailable && (
          <p className="mt-3 text-sm text-amber-700 dark:text-amber-300">
            {t('googlePlaces.encryptionUnavailable')}
          </p>
        )}

        {settings.configured && settings.enabled && (
          <p className="mt-3 text-sm text-gray-500 dark:text-gray-400">
            {settings.capEnabled
              ? t('googlePlaces.usage', {
                  used: settings.usedThisMonth,
                  cap: settings.monthlyCap,
                })
              : t('googlePlaces.usageNoCap', { used: settings.usedThisMonth })}
          </p>
        )}

        {!operatorManaged && (
          <div className="mt-4 flex flex-wrap gap-2">
            <Button
              type="button"
              variant="outline"
              size="sm"
              onClick={() => setShowConfig(true)}
              disabled={disabled || !settings.encryptionAvailable}
            >
              {settings.configured
                ? t('googlePlaces.edit')
                : t('googlePlaces.configure')}
            </Button>
            {settings.configured && (
              <Button
                type="button"
                variant="outline"
                size="sm"
                onClick={handleRemoveKey}
                disabled={disabled || saving}
              >
                {t('googlePlaces.removeKey')}
              </Button>
            )}
          </div>
        )}
      </Card>

      <PayeeContactLookupToggle
        disabled={disabled}
        lookupAvailable={lookupAvailable}
      />

      {showConfig && (
        <GooglePlacesConfigModal
          isOpen={showConfig}
          settings={settings}
          onClose={() => setShowConfig(false)}
          onSave={handleSaveConfig}
          onTest={payeeLookupApi.testKey}
        />
      )}
    </>
  );
}
