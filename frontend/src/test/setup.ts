import '@testing-library/jest-dom/vitest';
import { cleanup } from '@testing-library/react';
import { afterEach, vi } from 'vitest';

afterEach(() => {
  cleanup();
});

// Suppress known-harmless jsdom warnings for SVG elements used by Recharts.
// Also suppress tagged output from the project's `createLogger` (e.g.
// "[useMonteCarloScenarios] Save failed: ..."). Tests intentionally exercise
// logger.error/warn paths and assert behavioral effects (toasts, state) rather
// than console output, so the tagged log lines are pure noise.
const LOGGER_TAG_RE = /^\[[A-Za-z][\w-]*\]$/;
const originalConsoleError = console.error;
console.error = (...args: unknown[]) => {
  const msg = typeof args[0] === 'string' ? args[0] : '';
  if (
    msg.includes('is unrecognized in this browser') ||
    msg.includes('is using incorrect casing') ||
    LOGGER_TAG_RE.test(msg)
  ) {
    return;
  }
  originalConsoleError(...args);
};

const originalConsoleWarn = console.warn;
console.warn = (...args: unknown[]) => {
  const msg = typeof args[0] === 'string' ? args[0] : '';
  if (LOGGER_TAG_RE.test(msg)) return;
  originalConsoleWarn(...args);
};

const originalConsoleInfo = console.info;
console.info = (...args: unknown[]) => {
  const msg = typeof args[0] === 'string' ? args[0] : '';
  if (LOGGER_TAG_RE.test(msg)) return;
  originalConsoleInfo(...args);
};

// Mock next/navigation
vi.mock('next/navigation', () => ({
  useRouter: () => ({
    push: vi.fn(),
    replace: vi.fn(),
    back: vi.fn(),
    prefetch: vi.fn(),
    refresh: vi.fn(),
  }),
  usePathname: () => '/',
  useSearchParams: () => new URLSearchParams(),
}));

// Mock next-intl. Translations resolve against the real English catalog so
// existing assertions on visible English text keep passing after components
// switch to t('...'). Interpolation ({name}) and t.rich/raw are supported.
vi.mock('next-intl', async () => {
  const en = (await import('@/i18n/messages/en')).default as Record<string, unknown>;

  const lookup = (namespace: string, key: string): string => {
    const root = (en[namespace] ?? {}) as Record<string, unknown>;
    let cur: unknown = root;
    for (const part of key.split('.')) {
      cur = cur != null ? (cur as Record<string, unknown>)[part] : undefined;
    }
    return typeof cur === 'string' ? cur : `${namespace}.${key}`;
  };

  // Cache the translator per namespace so useTranslations returns a STABLE
  // function identity across renders, mirroring real next-intl. Components
  // legitimately put `t` in useCallback/useEffect dependency arrays; an
  // unstable mock would recreate those callbacks every render and can spin
  // mount effects into an infinite loop (manifesting as test timeouts).
  const translatorCache = new Map<string, ReturnType<typeof buildTranslator>>();
  function buildTranslator(namespace: string) {
    const t = (key: string, values?: Record<string, unknown>) => {
      let str = lookup(namespace, key);
      if (values) {
        for (const [k, v] of Object.entries(values)) {
          str = str.replaceAll(`{${k}}`, String(v));
        }
      }
      return str;
    };
    t.rich = (key: string) => lookup(namespace, key);
    t.markup = (key: string) => lookup(namespace, key);
    t.raw = (key: string) => lookup(namespace, key);
    t.has = () => true;
    return t;
  }
  const useTranslations = (namespace = '') => {
    let t = translatorCache.get(namespace);
    if (!t) {
      t = buildTranslator(namespace);
      translatorCache.set(namespace, t);
    }
    return t;
  };

  return {
    useTranslations,
    useLocale: () => 'en',
    useMessages: () => en,
    useNow: () => new Date(0),
    useTimeZone: () => 'UTC',
    useFormatter: () => ({
      number: (value: number) => String(value),
      dateTime: (value: Date) => value.toISOString(),
      relativeTime: (value: Date) => value.toISOString(),
      list: (value: Iterable<string>) => Array.from(value).join(', '),
    }),
    NextIntlClientProvider: ({ children }: { children: React.ReactNode }) => children,
  };
});

// Mock next-intl/server for any server-component code reached in tests.
vi.mock('next-intl/server', async () => {
  const en = (await import('@/i18n/messages/en')).default as Record<string, unknown>;
  const lookup = (namespace: string, key: string): string => {
    const root = (en[namespace] ?? {}) as Record<string, unknown>;
    let cur: unknown = root;
    for (const part of key.split('.')) {
      cur = cur != null ? (cur as Record<string, unknown>)[part] : undefined;
    }
    return typeof cur === 'string' ? cur : `${namespace}.${key}`;
  };
  return {
    getTranslations: async (namespace = '') => {
      const t = (key: string, values?: Record<string, unknown>) => {
        let str = lookup(namespace as string, key);
        if (values) {
          for (const [k, v] of Object.entries(values)) {
            str = str.replaceAll(`{${k}}`, String(v));
          }
        }
        return str;
      };
      return t;
    },
    getLocale: async () => 'en',
    getMessages: async () => en,
  };
});

// Mock react-hot-toast
vi.mock('react-hot-toast', () => ({
  default: {
    success: vi.fn(),
    error: vi.fn(),
    loading: vi.fn(),
    dismiss: vi.fn(),
  },
  Toaster: () => null,
}));

// Mock localStorage
const localStorageMock = (() => {
  let store: Record<string, string> = {};
  return {
    getItem: vi.fn((key: string) => store[key] ?? null),
    setItem: vi.fn((key: string, value: string) => {
      store[key] = value;
    }),
    removeItem: vi.fn((key: string) => {
      delete store[key];
    }),
    clear: vi.fn(() => {
      store = {};
    }),
    get length() {
      return Object.keys(store).length;
    },
    key: vi.fn((i: number) => Object.keys(store)[i] ?? null),
  };
})();

Object.defineProperty(window, 'localStorage', { value: localStorageMock });

// Mock scrollTo (not implemented in jsdom)
window.scrollTo = vi.fn() as any;

// Mock matchMedia
Object.defineProperty(window, 'matchMedia', {
  writable: true,
  value: vi.fn().mockImplementation((query: string) => ({
    matches: false,
    media: query,
    onchange: null,
    addListener: vi.fn(),
    removeListener: vi.fn(),
    addEventListener: vi.fn(),
    removeEventListener: vi.fn(),
    dispatchEvent: vi.fn(),
  })),
});
