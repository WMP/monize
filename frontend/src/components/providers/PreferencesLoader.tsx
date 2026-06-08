'use client';

import { useEffect } from 'react';
import { useRouter } from 'next/navigation';
import Cookies from 'js-cookie';
import { useAuthStore } from '@/store/authStore';
import { usePreferencesStore } from '@/store/preferencesStore';
import { useTheme } from '@/contexts/ThemeContext';
import { LOCALE_COOKIE, isSupportedLocale } from '@/i18n/config';

/**
 * Component that loads user preferences when authenticated.
 * Should be placed inside the app layout.
 */
export function PreferencesLoader({ children }: { children: React.ReactNode }) {
  const router = useRouter();
  const isAuthenticated = useAuthStore((state) => state.isAuthenticated);
  const authHydrated = useAuthStore((state) => state._hasHydrated);
  const loadPreferences = usePreferencesStore((state) => state.loadPreferences);
  const clearPreferences = usePreferencesStore((state) => state.clearPreferences);
  const preferences = usePreferencesStore((state) => state.preferences);
  const isLoaded = usePreferencesStore((state) => state.isLoaded);
  const prefsHydrated = usePreferencesStore((state) => state._hasHydrated);
  const { setTheme } = useTheme();

  useEffect(() => {
    // Wait for both stores to hydrate
    if (!authHydrated || !prefsHydrated) return;

    if (isAuthenticated && !isLoaded) {
      loadPreferences();
    } else if (!isAuthenticated) {
      clearPreferences();
    }
  }, [isAuthenticated, authHydrated, prefsHydrated, isLoaded, loadPreferences, clearPreferences]);

  // Sync theme when preferences change
  useEffect(() => {
    if (prefsHydrated && preferences?.theme) {
      setTheme(preferences.theme as 'light' | 'dark' | 'system');
    }
  }, [prefsHydrated, preferences?.theme, setTheme]);

  // Sync language cookie from DB preference. The proxy reads NEXT_LOCALE and
  // sets the x-locale header on the next request; we refresh the router so
  // the new language takes effect immediately if it differs from the cookie.
  useEffect(() => {
    if (!prefsHydrated || !preferences?.language) return;
    if (!isSupportedLocale(preferences.language)) return;
    const current = Cookies.get(LOCALE_COOKIE);
    if (current === preferences.language) return;
    Cookies.set(LOCALE_COOKIE, preferences.language, {
      sameSite: 'lax',
      expires: 365,
    });
    router.refresh();
  }, [prefsHydrated, preferences?.language, router]);

  return <>{children}</>;
}
