import { render, RenderOptions } from '@testing-library/react';
import { ReactElement } from 'react';
import { NextIntlClientProvider } from 'next-intl';
import { ThemeProvider } from '@/contexts/ThemeContext';
import commonMessages from '@/i18n/messages/en/common.json';
import settingsMessages from '@/i18n/messages/en/settings.json';

// Synchronous English message catalog so existing tests don't need to mock
// next-intl or load messages asynchronously.
const testMessages = {
  common: commonMessages,
  settings: settingsMessages,
};

function AllProviders({ children }: { children: React.ReactNode }) {
  return (
    <NextIntlClientProvider locale="en" messages={testMessages}>
      <ThemeProvider>{children}</ThemeProvider>
    </NextIntlClientProvider>
  );
}

function customRender(
  ui: ReactElement,
  options?: Omit<RenderOptions, 'wrapper'>,
) {
  return render(ui, { wrapper: AllProviders, ...options });
}

export * from '@testing-library/react';
export { customRender as render };
