// Supported UI locales. English is the default and the fallback for missing keys.
export const locales = ['en', 'pl'] as const;

export type Locale = (typeof locales)[number];

export const defaultLocale: Locale = 'en';

// Name of the cookie that stores the user's selected locale. The app uses a
// cookie (not a URL prefix) so locale survives across the authenticated SPA
// without rewriting every route.
export const LOCALE_COOKIE = 'NEXT_LOCALE';

export const localeNames: Record<Locale, string> = {
  en: 'English',
  pl: 'Polski',
};

export function isLocale(value: string | undefined | null): value is Locale {
  return value != null && (locales as readonly string[]).includes(value);
}
