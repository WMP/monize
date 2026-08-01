# Frontend Directory

Next.js App Router application. All commands run from this directory.

## Commands

```bash
npm run dev                # Dev server (port 3000)
npm run build              # Production build (standalone output for Docker)
npm run lint               # ESLint
npm run type-check         # tsc --noEmit
npm run test               # Vitest (single run)
npm run test:watch         # Vitest (watch mode)
npm run test:cov           # Coverage report (91% lines, 90% stmts, 87% funcs, 85% branches)
npm run i18n:pseudo        # Regenerate the xx pseudo-locale from en
npm run i18n:check         # Verify the pseudo-locale is up to date (CI gate)
```

## Layout

`src/` contains `app/` (App Router routes), `components/` (feature-organized React components plus shared `ui/`), `contexts/`, `hooks/`, `lib/` (axios API clients and utilities), `store/` (Zustand: `authStore`, `preferencesStore`, `demoStore`), `types/`, `test/`, and `proxy.ts`. Use the filesystem or LSP `workspaceSymbol` to discover specific files -- they're self-describing.

## Configuration

- **Path alias:** `@/*` maps to `src/*` (tsconfig + Vitest resolve alias)
- **TypeScript:** ES2017 target, strict mode, bundler module resolution, React JSX
- **Vitest:** jsdom environment, 30s timeout, V8 coverage provider; thresholds 91% lines, 90% statements, 87% functions, 85% branches
- **Tailwind CSS v4:** Via `@tailwindcss/postcss` in `postcss.config.js`, `@import "tailwindcss"` in `globals.css`
- **Next.js:** Standalone output (Docker), strict mode, security headers in `next.config.js`

## API Layer (`src/lib/`)

**Central client** (`api.ts`): Axios instance with `baseURL: /api/v1`, `withCredentials: true`, 10s timeout.

**Interceptors (non-obvious behavior):**
- **Request:** Reads `csrf_token` cookie, injects `X-CSRF-Token` header
- **Response (403 CSRF):** Transparent refresh via `/auth/csrf-refresh`, retries request
- **Response (401):** Token refresh via `/auth/refresh`, queues concurrent requests during refresh
- **Fallback:** On refresh failure, logs out and redirects to `/login`

Feature API modules (one per feature, typed axios wrappers) live alongside `api.ts`. Use the filesystem to discover them.

## Proxy (`src/proxy.ts`)

This is Next.js middleware (NOT the deprecated middleware pattern from this project's conventions). It handles:

- **API routing:** `/api/*` proxied to `INTERNAL_API_URL` (default `http://localhost:3001`)
- **CSP nonce:** Per-request nonce generated in `x-nonce` header, used by Next.js for inline scripts
- **Auth redirects:** Unauthenticated requests to protected routes redirect to `/login`
- **Security headers:** CSP with `strict-dynamic`, nonce-based script-src
- **Public paths:** `/login`, `/register`, `/auth/callback`, `/forgot-password`, `/reset-password` (no auth required)

## Component Patterns

- All interactive components use `'use client'`. Server components are the default for pages/layouts.
- Use dynamic imports for heavy components: `dynamic(() => import('./Chart'), { ssr: false })`.
- `ProtectedRoute` (`components/auth/ProtectedRoute.tsx`) wraps authenticated pages.
- **No `setState` in `useEffect`** — ESLint rule `react-hooks/set-state-in-effect` is enforced. To reset child state when a prop changes (e.g. on a dialog open transition), use the "info from previous render" pattern (track the prop in `useState` and update during render).
- **Dialogs use `Modal`** (`components/ui/Modal.tsx`) — handles Escape, focus trap, body scroll lock, focus restore, and stacked-modal popstate. Opt into `pushHistory` so the browser back button also closes. `ConfirmDialog` forwards `pushHistory` for stacked confirm flows.

## Reusing existing UI patterns

Each of these exists once. Use it; do not hand-roll a second one. Every rule here was added after an agent wrote the generic version and a human had to point it out.

### Date entry -- `DateInput`, never a raw `<input type="date">`

`components/ui/DateInput.tsx` is the only place a raw date input is allowed, and `ui-conventions.test.ts` fails the build if another appears. It carries the locale-aware parsing, the keyboard shortcuts, and `CalendarPopover` -- the custom picker that the `.date-picker-hide` CSS in `globals.css` exists to make room for by hiding the browser's own icon. A bare `<input type="date">` gets none of that and shows two calendar icons. 32 components use `DateInput`; yours should too.

### Currency entry -- `CurrencyInput`, never a raw number input

`components/ui/CurrencyInput.tsx` is the only way to take a money amount. It is a `type="text"` field with `inputMode="decimal"`, not `<input type="number">`: it filters non-numeric characters as you type, formats with thousands separators and two decimals on blur, strips the commas and clears a `0.00` on focus so the field is immediately typable, parses back through `parseAmount` so the value reaching the form is rounded to cents, and re-syncs when the parent changes the value externally (a form reset, or a category auto-signing the amount negative). It also accepts inline calculator expressions -- typing `100*1.13` and blurring or pressing Enter evaluates it in place instead of submitting the form -- and offers a calculator modal via the in-field icon. Props worth knowing: `prefix` for the currency symbol, `allowNegative` (default true), `allowCalculator` (default true), `allowSignToggle` for the in-field `±` button. 22 components use it; yours should too.

A raw `<input type="number">` gets none of this and adds spinner arrows, scroll-wheel value changes, and locale-dependent decimal handling. For non-money numbers -- share counts, rates, percentages -- use `NumericInput` instead: same filtering and blur formatting, but with `decimalPlaces`, a `suffix`, a `min`, `allowNegative` defaulting to false, and no calculator.

Note that unlike `DateInput`, this rule has no guard test in `ui-conventions.test.ts` yet -- add one there if a raw number input slips in.

### A toggle with visible text beside it -- `labelledBy`, never `label`

`ToggleSwitch` takes `label` (an `aria-label`) *or* `labelledBy` (the id of the
element holding the visible text), and which one is correct depends entirely on
whether the name is already on screen. A switch rendered next to a `<span>`
saying what it does must use `labelledBy` and point at that span's id: an
`aria-label` repeating visible text makes a screen reader announce the name
twice, and the visible text is not a bound `<label>`, so it looks clickable and
is not. Reserve `label` for a bare switch in a toolbar or a table cell, which is
what the prop's own doc comment says.

### A validation rule for a conditional section must be gated the same way

react-hook-form keeps the values of fields it has unmounted. A `superRefine`
rule over a section the form only sometimes renders therefore keeps firing after
the section disappears, attaching an error to a field nobody can see -- and
because there is no `onInvalid` handler, the submit button then silently does
nothing. `buildAccountSchema` is the worked example: the loan, mortgage and tax
rules each re-check the condition that put their section on screen before adding
an issue. If a section's visibility is a function of more than the submitted
data (an account's `accountSubType`, which the form cannot change), pass that
into the schema builder rather than leaving the rule ungated.

### A clickable table row -- `useLongPress({ onClick })`

`useLongPress` takes an `onClick` alongside `onLongPress` for exactly this: a plain click runs the row's primary action, a 750ms press (or right-click) opens the mobile action sheet, and a click that followed a long-press is suppressed. Spread `getRowHandlers(item)` on the `<tr>` and add `cursor-pointer`. The accounts, payees, tags, categories and securities lists all do this.

Do not put the click on a button around the symbol or the name instead. It looks identical and is not: the rest of the row -- all the cell padding, every other column -- becomes dead, and clicking a row "does nothing" for the majority of its area. Controls *inside* the row (a favourite star, `RowActions`) must `stopPropagation` so they act on themselves; both already do.

### A long list -- page it, or bound it and scroll with `scrollbar-slim`

Two patterns, depending on where it lives:

- A full-page list uses `components/ui/Pagination.tsx`.
- A list inside a card caps its height and scrolls: `scrollbar-slim max-h-* overflow-y-auto pr-1`.

The thing to avoid is the *default* scrollbar, not scrolling. On Linux and Windows
the native bar is a wide arrowed control drawn hard against the content, and inside
a small card it reads as a rendering fault rather than as an affordance. That is
what gets complained about. `scrollbar-slim` keeps the bar -- a bounded list needs
one, or the rest of it is invisible -- as a thin rounded thumb on an empty track,
in the theme's greys, light and dark. The utility is defined in `globals.css`
alongside `scrollbar-hide`; it arrives with the security-detail branch, so on a
branch that predates it, add it there rather than styling a bar inline.

Bound the height rather than letting the card grow, and rather than hiding rows
behind a "Show N more" expander. A card in a grid or beside a chart has to be the
same height whatever its contents, or it drags the layout around: a breakdown card
next to the price chart left a gap under the chart when it collapsed, and an
expander also puts a click in front of information the card exists to show at a
glance. `SecurityWeightingBars` and the detail page's "Held in accounts" are the
worked examples.

`scrollbar-hide` is for a horizontal strip of chips, where the overflow is obvious
from the content being cut. Never use it on a vertical list: hiding a bar you need
is worse than a plain one.

### A view that graduates to its own page -- delete the modal, do not flag it

Remove the modal mode instead of keeping it behind a prop: an `onClose?` nobody
passes and an `embedded` flag whose only caller always sets it leave every
`!embedded` branch compiling, tested and unreachable, still fetching the data
they no longer show. Delete the props, those branches, the orphaned catalog
strings in every locale, and whatever in a shared component only that modal used
(a `Modal` prop, a row-action icon).

### Copy -- `--` is comment style, never UI text

This repo writes `--` in code comments, and the habit is strong enough that it
leaks into catalog strings, where it renders literally on screen and reads as a
typo. In copy use an em dash, or recast the sentence and drop the aside.
`messages.punctuation.test.ts` fails the build on a new one; it carries a
shrink-only baseline of the strings that already had them.

The same applies to anything else that is punctuation rather than words: compose
it in the catalog, not in JSX. `"{units} ({share})"` is one string a translator
can reorder; `{value}{' ('}{share}{')'}` in a component is three fragments they
cannot reach.

## Form Patterns

`useFormModal<T>` (`hooks/useFormModal.ts`) manages create/edit modal state with browser-history integration (back button closes), unsaved-changes detection via `UnsavedChangesDialog`, and form submit exposed via ref. Returns `showForm`, `editingItem`, `openCreate()`, `openEdit(item)`, `close()`, `modalProps`, `unsavedChangesDialog`.

Supporting hooks: `useFormSubmitRef` (expose submit via ref), `useFormDirtyNotify` (track dirty state). Forms use react-hook-form + Zod.

## Internationalization (i18n)

All user-facing strings go through `next-intl` -- no hardcoded literals. Read them with `useTranslations('namespace')`; catalogs live in `src/i18n/messages/{locale}/{namespace}.json` (locales `de`, `en`, `en-US`, `en-CA`, `en-GB`, `es`, `fr`, `hi`, `id`, `it`, `ja`, `ko`, `nl`, `pl`, `pt`, `pt-BR`, `ru`, `tr`, `uk`, `vi`, `zh-CN`, `zh-TW`, `xx`; the `en-*` locales are lean regional variants holding only the strings that differ from `en`; register new namespaces in `src/i18n/messages.ts`). Use `t.rich` for embedded markup and `t.raw` for template strings. Adding or changing a string means updating every locale -- the parity test `src/i18n/messages.parity.test.ts` fails otherwise -- then regenerating the pseudo-locale with `npm run i18n:pseudo`. The language is a user preference (`LanguageSelector` in Settings -> Preferences). Full contributor flow: `src/i18n/messages/README.md`.

## React Testing (act() Pattern)

Components with async `useEffect` (API calls on mount) MUST use this pattern to avoid act() warnings:

```typescript
async function renderMyComponent() {
  let result: ReturnType<typeof render>;
  await act(async () => {
    result = render(<MyComponent />);
  });
  return result!;
}

it('renders data', async () => {
  const { getByText } = await renderMyComponent();
  expect(getByText('Expected')).toBeInTheDocument();
});
```

Wrap user interactions that trigger async state updates: `await act(async () => { fireEvent.click(button); });`

When a mock rejects a Promise, the component's error handler runs in a subsequent microtask after `act()` resolves. Add a flush after the interaction to drain it:

```typescript
await act(async () => { fireEvent.click(runBtn); });
await act(async () => {}); // flush pending rejection handlers
await waitFor(() => expect(screen.getByText('Error message')).toBeInTheDocument());
```

Never use synchronous `act(() => {...})` for calls that trigger async side-effects — always `await act(async () => {...})`.

## Testing Conventions

**Custom render** (`test/render.tsx`): Wraps components with `ThemeProvider`. Import `render` from `@/test/render` instead of `@testing-library/react`.

**Global mocks** (`test/setup.ts`): `next/navigation` (useRouter, usePathname, useSearchParams), `react-hot-toast`, `localStorage`, `window.scrollTo`, `window.matchMedia`.

**Test file naming:** `Component.test.tsx` (co-located with component).

## Theme

`ThemeContext` provides `theme` (light/dark/system), `resolvedTheme`, and `setTheme()`, plus `colorTheme`/`setColorTheme()` for the colour palette (`src/lib/color-themes.ts`). Both persisted to localStorage; applies `dark` class (Tailwind dark mode strategy) and a `data-theme` attribute (`default` = no attribute) to `<html>`; listens for system preference changes via `matchMedia`. Custom theme variables in `globals.css` `@theme` block; dark variant `@variant dark (&:where(.dark, .dark *))`.

Colour themes are pure CSS variable overrides in `src/app/themes.css` (`html[data-theme="..."]` redefines the gray/blue ramps etc. -- Tailwind v4 utilities compile to `var(--color-*)` so no component changes are needed). Chart colours go through `src/lib/chart-colors.ts`, which exposes `var(--chart-*)` strings for Recharts props; never hardcode hex colours in charts, and never theme user-chosen entity colours (tags, categories, payees).

**A hand-rolled CSS bar is a chart.** `chartColors` is not only for Recharts props -- a `<div>` bar, and the amount printed beside it, take the tokens through `style={{ backgroundColor }}` / `style={{ color }}`. Reaching for `bg-green-400 dark:bg-green-500` or `text-red-600 dark:text-red-400` instead looks right on the default palette and then stays Tailwind red/green on every other theme, which is exactly the thing that gets noticed. To emphasise one bar among many (a peak, a selection), vary `opacity` on the same token rather than picking a second shade -- opacity moves toward the card in both light and dark mode, so the emphasis reads the same way in each.

**The tokens cover more than series colour.** `chartColors.grid` and `.axis` carry their own dark overrides, so a `CartesianGrid` using them needs no `dark:stroke-*` class beside it. `chartColors.surface` is the card behind the chart -- use it for the ring around a marker dot, which exists to separate the dot from the line beneath it and so must be the background, not white. `chartColors.neutral` is for unclassified data (an "Other" slice, an item with no colour). `ui-conventions.test.ts` fails on any hex reaching a `fill`, `stroke` or `stopColor` in a component that imports recharts. Two things it deliberately does not police: `summaryCards[].color` for the PDF export, where `pdf-export.ts` parses the string as hex and a `var(...)` would produce NaN, and colour on a *data* field (`color:` on a datum), which is indistinguishable from the PDF case by regex. White drawn on top of a filled shape -- label text inside a coloured flag bubble -- is contrast-on-fill and stays literal; `surface` there would be invisible in dark mode.

**Spending is not an error: default a breakdown to `chartColors.primary`, not `chartColors.expense`.** Red is loud and the app spends it deliberately -- the Monthly Totals chart, where a loss month is the point. A routine breakdown (top categories, paid-from accounts, a seasonality strip) is a magnitude comparison, so its bars take the theme accent, which re-colours per palette because `--chart-primary` follows the theme's blue ramp. Keep `chartColors.income` for genuine inflows so a refund is still distinguishable; that leaves red spent only where it means something. `TopGroupsPanel` and `PayeeSeasonalityPanel` are the worked examples, and both carry a guard test asserting no `bg-`/`text-red|green-N` and no `var(--chart-expense)` survives in their output. Note that `income`/`expense` remain right for a chart genuinely *about* the in/out split -- the rule is about breakdowns that merely happen to be negative.

## Security Notes

- **Zod:** Configured with `jitless: true` (`zodConfig.ts`) for CSP compliance -- no `new Function()`
- **Auth tokens:** Stored in httpOnly cookies (backend-managed), never in JS-accessible storage
- **CSP:** Per-request nonce generated in proxy, `strict-dynamic` for script-src
- **ESLint:** `no-new-func: error` enforced to prevent CSP violations
