/**
 * Backend mirror of `frontend/src/i18n/config.ts`. Keep the two lists in sync.
 *
 * Locale codes are ISO 639-1 (e.g. 'en', 'fr') or BCP 47 tags (e.g. 'pt-BR')
 * and must match folder names under `backend/src/i18n/locales/`.
 */

export const DEFAULT_LOCALE = "en";

export const SUPPORTED_LOCALE_CODES: readonly string[] = ["en"];

export function isSupportedLocale(code: string | undefined | null): boolean {
  if (!code) return false;
  return SUPPORTED_LOCALE_CODES.includes(code);
}
