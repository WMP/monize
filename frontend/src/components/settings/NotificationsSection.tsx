'use client';

import { useState } from 'react';
import { useTranslations } from 'next-intl';
import toast from 'react-hot-toast';
import { Button } from '@/components/ui/Button';
import { userSettingsApi } from '@/lib/user-settings';
import { usePreferencesStore } from '@/store/preferencesStore';
import { UserPreferences } from '@/types/auth';
import { getErrorMessage } from '@/lib/errors';

interface NotificationsSectionProps {
  initialNotificationEmail: boolean;
  smtpConfigured: boolean;
  preferences: UserPreferences;
  onPreferencesUpdated: (prefs: UserPreferences) => void;
}

export function NotificationsSection({
  initialNotificationEmail,
  smtpConfigured,
  preferences,
  onPreferencesUpdated,
}: NotificationsSectionProps) {
  const t = useTranslations('settings');
  const updatePreferencesStore = usePreferencesStore((state) => state.updatePreferences);
  const [notificationEmail, setNotificationEmail] = useState(initialNotificationEmail);
  const [budgetDigestEnabled, setBudgetDigestEnabled] = useState(
    preferences.budgetDigestEnabled ?? true,
  );
  const [budgetDigestDay, setBudgetDigestDay] = useState(
    preferences.budgetDigestDay ?? 'MONDAY',
  );
  const [isSendingTestEmail, setIsSendingTestEmail] = useState(false);

  const handleToggleEmailNotifications = async () => {
    const newValue = !notificationEmail;
    setNotificationEmail(newValue);
    try {
      const updated = await userSettingsApi.updatePreferences({ notificationEmail: newValue });
      onPreferencesUpdated(updated);
      updatePreferencesStore(updated);
      toast.success(newValue ? t('notifications.emailEnabled') : t('notifications.emailDisabled'));
    } catch (error) {
      setNotificationEmail(!newValue);
      toast.error(getErrorMessage(error, t('notifications.emailUpdateError')));
    }
  };

  const handleToggleBudgetDigest = async () => {
    const newValue = !budgetDigestEnabled;
    setBudgetDigestEnabled(newValue);
    try {
      const updated = await userSettingsApi.updatePreferences({ budgetDigestEnabled: newValue });
      onPreferencesUpdated(updated);
      updatePreferencesStore(updated);
      toast.success(newValue ? t('notifications.budgetDigestEnabled') : t('notifications.budgetDigestDisabled'));
    } catch (error) {
      setBudgetDigestEnabled(!newValue);
      toast.error(getErrorMessage(error, t('notifications.budgetDigestUpdateError')));
    }
  };

  const handleDigestDayChange = async (day: 'MONDAY' | 'FRIDAY') => {
    const previousDay = budgetDigestDay;
    setBudgetDigestDay(day);
    try {
      const updated = await userSettingsApi.updatePreferences({ budgetDigestDay: day });
      onPreferencesUpdated(updated);
      updatePreferencesStore(updated);
      toast.success(t('notifications.digestDaySet', { day: day.charAt(0) + day.slice(1).toLowerCase() }));
    } catch (error) {
      setBudgetDigestDay(previousDay);
      toast.error(getErrorMessage(error, t('notifications.digestDayUpdateError')));
    }
  };

  const handleSendTestEmail = async () => {
    setIsSendingTestEmail(true);
    try {
      await userSettingsApi.sendTestEmail();
      toast.success(t('notifications.testEmailSent'));
    } catch (error) {
      toast.error(getErrorMessage(error, t('notifications.testEmailError')));
    } finally {
      setIsSendingTestEmail(false);
    }
  };

  return (
    <div className="bg-white dark:bg-gray-800 shadow dark:shadow-gray-700/50 rounded-lg p-6 mb-6">
      <h2 className="text-lg font-semibold text-gray-900 dark:text-gray-100 mb-4">{t('notifications.title')}</h2>

      {!smtpConfigured ? (
        <p className="text-sm text-gray-500 dark:text-gray-400">
          {t('notifications.smtpNotConfigured')}
        </p>
      ) : (
        <div className="space-y-4">
          <div className="flex items-center justify-between">
            <div>
              <p className="text-sm font-medium text-gray-900 dark:text-gray-100">{t('notifications.emailNotifications')}</p>
              <p className="text-sm text-gray-500 dark:text-gray-400">
                {t('notifications.emailNotificationsHint')}
              </p>
            </div>
            <button
              type="button"
              role="switch"
              aria-checked={notificationEmail}
              onClick={handleToggleEmailNotifications}
              className={`relative inline-flex h-6 w-11 items-center rounded-full transition-colors focus:outline-none focus:ring-2 focus:ring-blue-500 focus:ring-offset-2 dark:focus:ring-offset-gray-800 ${
                notificationEmail ? 'bg-blue-600' : 'bg-gray-200 dark:bg-gray-600'
              }`}
            >
              <span
                className={`inline-block h-4 w-4 transform rounded-full bg-white transition-transform ${
                  notificationEmail ? 'translate-x-6' : 'translate-x-1'
                }`}
              />
            </button>
          </div>

          {notificationEmail && (
            <>
              <div className="border-t border-gray-200 dark:border-gray-700 pt-4">
                <h3 className="text-sm font-medium text-gray-900 dark:text-gray-100 mb-3">
                  {t('notifications.budgetNotifications')}
                </h3>
                <div className="space-y-3">
                  <div className="flex items-center justify-between">
                    <div>
                      <p className="text-sm text-gray-700 dark:text-gray-300">{t('notifications.weeklyBudgetDigest')}</p>
                      <p className="text-xs text-gray-500 dark:text-gray-400">
                        {t('notifications.weeklyBudgetDigestHint')}
                      </p>
                    </div>
                    <button
                      type="button"
                      role="switch"
                      aria-checked={budgetDigestEnabled}
                      aria-label={t('notifications.toggleBudgetDigest')}
                      onClick={handleToggleBudgetDigest}
                      className={`relative inline-flex h-6 w-11 items-center rounded-full transition-colors focus:outline-none focus:ring-2 focus:ring-blue-500 focus:ring-offset-2 dark:focus:ring-offset-gray-800 ${
                        budgetDigestEnabled ? 'bg-blue-600' : 'bg-gray-200 dark:bg-gray-600'
                      }`}
                    >
                      <span
                        className={`inline-block h-4 w-4 transform rounded-full bg-white transition-transform ${
                          budgetDigestEnabled ? 'translate-x-6' : 'translate-x-1'
                        }`}
                      />
                    </button>
                  </div>

                  {budgetDigestEnabled && (
                    <div className="flex items-center justify-between pl-4">
                      <p className="text-sm text-gray-600 dark:text-gray-400">{t('notifications.digestDay')}</p>
                      <select
                        value={budgetDigestDay}
                        onChange={(e) => handleDigestDayChange(e.target.value as 'MONDAY' | 'FRIDAY')}
                        aria-label={t('notifications.digestDayAria')}
                        className="text-sm border border-gray-300 dark:border-gray-600 rounded-md px-2 py-1 bg-white dark:bg-gray-700 text-gray-900 dark:text-gray-100 focus:outline-none focus:ring-2 focus:ring-blue-500"
                      >
                        <option value="MONDAY">{t('notifications.monday')}</option>
                        <option value="FRIDAY">{t('notifications.friday')}</option>
                      </select>
                    </div>
                  )}
                </div>
              </div>

              <p className="text-xs text-gray-500 dark:text-gray-400 italic">
                {t('notifications.criticalAlertsNote')}
              </p>
            </>
          )}

          <div className="border-t border-gray-200 dark:border-gray-700 pt-4">
            <p className="text-sm text-gray-500 dark:text-gray-400 mb-3">
              {t('notifications.testEmailHint')}
            </p>
            <Button
              variant="outline"
              size="sm"
              onClick={handleSendTestEmail}
              disabled={isSendingTestEmail || !notificationEmail}
            >
              {isSendingTestEmail ? t('notifications.sending') : t('notifications.sendTestEmail')}
            </Button>
          </div>
        </div>
      )}
    </div>
  );
}
