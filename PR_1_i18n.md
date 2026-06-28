# i18n: multi-language support with full Polish translation

Branch: `feat/i18n-polish` -> base `main` (independent of the Monthly Breakdown
report PR; the two can merge in any order).

## Summary
Adds frontend internationalization via **next-intl**, with **English as the
default** and a complete **Polish** translation. Users switch language in
**Settings -> Preferences**; the choice is stored in a `NEXT_LOCALE` cookie (no
URL prefix) and persists across sessions. English is the fallback locale, so any
not-yet-translated string renders in English rather than breaking.

## How it works
- **Locale source**: `NEXT_LOCALE` cookie, resolved in `src/i18n/request.ts`;
  `<html lang>` set from it in the root layout. No route rewriting.
- **Catalogs**: 24 per-namespace JSON files per locale
  (`src/i18n/messages/{en,pl}/<namespace>.json`), merged at load time.
- **Fallback**: the active locale is deep-merged onto the English base
  (`src/i18n/merge.ts`), so a missing Polish key falls back to English.
- **Switcher**: `LanguageSwitcher` writes the cookie via a server action and
  refreshes; added to `PreferencesSection`.

## Coverage
- **208 components/pages** localized via `useTranslations` / `getTranslations`.
- **4171 message keys** per locale, exact EN/PL key parity.
- Translated: navigation/shell, auth, dashboard, accounts, transactions,
  scheduled transactions, categories, payees, tags, budgets, bills, investments,
  securities, currencies, insights, import, settings, admin, AI, reconcile,
  shared UI, and the Reports catalog (names/descriptions/categories/filters) plus
  15 report views.
- **Follow-up**: ~45 of the larger report components (mostly investment reports
  and the report builders) are not yet localized and fall back to English.

## Polish terminology
Validated against the official **GnuCash Polish glossary**, documented in
`src/i18n/GLOSSARY.pl.md` for cross-namespace consistency (income = przychód,
expense = wydatek, account transfer = przelew, securities transfer =
przeniesienie, reconcile = uzgodnij, payee = odbiorca, net worth = wartość
netto). One deliberate deviation: payee is `odbiorca`, not GnuCash's `wierzyciel`
(creditor), which is the wrong semantics for a payee.

## Tests
- Existing component tests resolve `t('...')` against the real English catalog
  via a stable `next-intl` test mock (`src/test/setup.ts`) — English-text
  assertions keep passing unchanged.
- New tests: `merge.test.ts` (fallback deep-merge), `config.test.ts`.
- Full frontend Vitest suite green; `tsc --noEmit` clean. Backend untouched.

## Notes
No emojis, immutable updates, follows `CLAUDE.md`. No backend or database
changes.
