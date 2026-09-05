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
  PayeeLookupPreferredSource,
  PayeeLookupSettings,
  UpdatePayeeLookupSettings,
} from '@/types/payee-lookup';
import { aiApi } from '@/lib/ai';
import type { AiProviderConfig } from '@/types/ai';
import { GooglePlacesConfigModal } from './GooglePlacesConfigModal';
import { LookupSourceOrder } from './LookupSourceOrder';
import { PayeeContactLookupToggle } from './PayeeContactLookupToggle';

/**
 * Where the wiki explains getting a Google Places key.
 *
 * Worth a link rather than more copy on the card: the setup is a Google Cloud
 * errand (create a project, enable Places API (New), restrict the key BY IP
 * because Monize calls Google from the server, not by HTTP referrer) and none
 * of it fits beside a switch.
 */
const GOOGLE_PLACES_SETUP_URL =
  'https://github.com/kenlasko/monize/wiki/Categories-and-Payees#setting-up-google-places';

interface PayeeLookupSectionProps {
  disabled?: boolean;
  /**
   * Outer spacing, so a host can place the section. The Settings page stacks
   * sections and wants the bottom margin; a modal supplies its own padding and
   * does not.
   */
  className?: string;
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
export function PayeeLookupSection({
  disabled = false,
  className = 'mb-6',
}: PayeeLookupSectionProps) {
  const t = useTranslations('settings.payeeLookup');
  const [settings, setSettings] = useState<PayeeLookupSettings | null>(null);
  const [loadFailed, setLoadFailed] = useState(false);
  const [saving, setSaving] = useState(false);
  const [showConfig, setShowConfig] = useState(false);
  // Only the ACTIVE providers: an inactive one cannot answer a lookup, so
  // offering it would let the user pin a source that reports no_provider.
  const [aiProviders, setAiProviders] = useState<AiProviderConfig[]>([]);
  // Whether ANY source can answer -- Places within its cap, or an AI provider.
  // The automatic-lookup toggle is about a lookup that runs by itself, so it is
  // offered only when something could actually run.
  const { available: lookupAvailable, aiConfigured } =
    useContactLookupAvailable();

  useEffect(() => {
    let active = true;
    // Best-effort: the order list still works without it, offering no model
    // choice rather than a broken one.
    aiApi
      .getConfigs()
      .then((configs) => {
        if (active) setAiProviders(configs.filter((c) => c.isActive));
      })
      .catch(() => {
        if (active) setAiProviders([]);
      });
    return () => {
      active = false;
    };
  }, []);

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

  const handlePreferredSource = async (next: PayeeLookupPreferredSource) => {
    if (!settings || saving || settings.preferredSource === next) return;
    const previous = settings;
    setSettings({ ...settings, preferredSource: next });
    try {
      await save({ preferredSource: next });
    } catch (error) {
      setSettings(previous);
      toast.error(getErrorMessage(error, t('saveFailed')));
    }
  };

  const handleAiProvider = async (configId: string | null) => {
    if (!settings || saving || settings.aiProviderConfigId === configId) return;
    const previous = settings;
    setSettings({ ...settings, aiProviderConfigId: configId });
    try {
      await save({ aiProviderConfigId: configId });
    } catch (error) {
      setSettings(previous);
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
      <Card padding="md" className={className}>
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
      <Card padding="md" className={className}>
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
          <div className="mt-4 flex flex-wrap items-center gap-2">
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
            {/* Only before there is a key: getting one is a Google Cloud
                errand with a step that is easy to get wrong (restrict by IP,
                not by HTTP referrer -- this is a server-side call). Once it
                works the link is clutter. */}
            {!settings.configured && (
              <a
                href={GOOGLE_PLACES_SETUP_URL}
                target="_blank"
                rel="noopener noreferrer"
                className="text-sm font-medium text-blue-600 hover:underline dark:text-blue-400"
              >
                {t('googlePlaces.setupInstructions')}
              </a>
            )}
          </div>
        )}

        {/* Ordering only matters when both sources can actually answer. With
            one configured there is nothing to order, and offering the choice
            would imply a fallback that does not exist. */}
        {aiConfigured && settings.configured && (
          <LookupSourceOrder
            settings={settings}
            aiProviders={aiProviders}
            disabled={disabled || saving}
            onReorder={handlePreferredSource}
            onSelectAiProvider={handleAiProvider}
          />
        )}

        <PayeeContactLookupToggle
          disabled={disabled}
          lookupAvailable={lookupAvailable}
        />
      </Card>

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
