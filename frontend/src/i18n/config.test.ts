import { describe, it, expect } from 'vitest';
import { locales, defaultLocale, isLocale, localeNames, LOCALE_COOKIE } from './config';

describe('i18n config', () => {
  it('supports English and Polish', () => {
    expect(locales).toEqual(['en', 'pl']);
  });

  it('defaults to English', () => {
    expect(defaultLocale).toBe('en');
  });

  it('uses NEXT_LOCALE as the cookie name', () => {
    expect(LOCALE_COOKIE).toBe('NEXT_LOCALE');
  });

  it('has a display name for every locale', () => {
    for (const locale of locales) {
      expect(localeNames[locale]).toBeTruthy();
    }
  });

  describe('isLocale', () => {
    it('accepts supported locales', () => {
      expect(isLocale('en')).toBe(true);
      expect(isLocale('pl')).toBe(true);
    });

    it('rejects unsupported or empty values', () => {
      expect(isLocale('de')).toBe(false);
      expect(isLocale('')).toBe(false);
      expect(isLocale(undefined)).toBe(false);
      expect(isLocale(null)).toBe(false);
    });
  });
});
