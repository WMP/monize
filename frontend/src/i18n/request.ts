import { cookies } from 'next/headers';
import { getRequestConfig } from 'next-intl/server';
import { defaultLocale, isLocale, LOCALE_COOKIE } from './config';
import { deepMerge } from './merge';
import enMessages from './messages/en';
import plMessages from './messages/pl';

type Messages = typeof enMessages;

const catalogs: Record<string, Messages> = {
  en: enMessages,
  pl: plMessages as Messages,
};

export default getRequestConfig(async () => {
  const cookieStore = await cookies();
  const cookieLocale = cookieStore.get(LOCALE_COOKIE)?.value;
  const locale = isLocale(cookieLocale) ? cookieLocale : defaultLocale;

  const messages =
    locale === defaultLocale
      ? catalogs[defaultLocale]
      : deepMerge(catalogs[defaultLocale], catalogs[locale]);

  return { locale, messages };
});
