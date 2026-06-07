'use server';

import { cookies } from 'next/headers';
import { defaultLocale, isLocale, LOCALE_COOKIE, type Locale } from './config';

/**
 * Persist the chosen locale in a cookie. next-intl reads this cookie in
 * request.ts on the next render, so the caller should refresh the router
 * (or reload) after awaiting this action.
 */
export async function setLocale(locale: Locale): Promise<void> {
  const value = isLocale(locale) ? locale : defaultLocale;
  const cookieStore = await cookies();
  cookieStore.set(LOCALE_COOKIE, value, {
    path: '/',
    maxAge: 60 * 60 * 24 * 365, // one year
    sameSite: 'lax',
  });
}
