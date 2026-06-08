import { describe, it, expect } from 'vitest';
import {
  DEFAULT_LOCALE,
  SUPPORTED_LOCALES,
  SUPPORTED_LOCALE_CODES,
  getLocaleDir,
  isSupportedLocale,
  matchAcceptLanguage,
  resolveLocale,
} from './config';

describe('i18n config', () => {
  describe('SUPPORTED_LOCALES', () => {
    it('includes the default locale', () => {
      expect(SUPPORTED_LOCALE_CODES).toContain(DEFAULT_LOCALE);
    });

    it('exposes a label and direction for each locale', () => {
      for (const locale of SUPPORTED_LOCALES) {
        expect(locale.label.length).toBeGreaterThan(0);
        expect(['ltr', 'rtl']).toContain(locale.dir);
      }
    });
  });

  describe('isSupportedLocale', () => {
    it('returns true for supported codes', () => {
      expect(isSupportedLocale('en')).toBe(true);
    });

    it('returns false for unknown codes and falsy input', () => {
      expect(isSupportedLocale('zz')).toBe(false);
      expect(isSupportedLocale('')).toBe(false);
      expect(isSupportedLocale(null)).toBe(false);
      expect(isSupportedLocale(undefined)).toBe(false);
    });
  });

  describe('resolveLocale', () => {
    it('returns the candidate when supported', () => {
      expect(resolveLocale('en')).toBe('en');
    });

    it('falls back to the default when unsupported', () => {
      expect(resolveLocale('zz')).toBe(DEFAULT_LOCALE);
      expect(resolveLocale(undefined)).toBe(DEFAULT_LOCALE);
    });
  });

  describe('getLocaleDir', () => {
    it('returns ltr for English', () => {
      expect(getLocaleDir('en')).toBe('ltr');
    });

    it('returns ltr for unknown codes', () => {
      expect(getLocaleDir('zz')).toBe('ltr');
    });
  });

  describe('matchAcceptLanguage', () => {
    it('returns the default for an empty header', () => {
      expect(matchAcceptLanguage(null)).toBe(DEFAULT_LOCALE);
      expect(matchAcceptLanguage('')).toBe(DEFAULT_LOCALE);
    });

    it('matches a supported tag verbatim', () => {
      expect(matchAcceptLanguage('en')).toBe('en');
    });

    it('strips region tags to find the primary subtag', () => {
      expect(matchAcceptLanguage('en-US,en;q=0.9')).toBe('en');
    });

    it('falls back when no supported tag is present', () => {
      expect(matchAcceptLanguage('zz-ZZ,qq;q=0.5')).toBe(DEFAULT_LOCALE);
    });
  });
});
