# Frontend translations

This folder holds per-locale UI strings for Monize. Each locale lives in its own
folder and is split into small JSON files (namespaces) so translation work can
be done in focused PRs.

## Adding a language (example: Spanish)

1. Copy `en/` to a new folder named for the language. Use the ISO 639-1 code
   (`es`) or a BCP 47 tag if you need a regional variant (`pt-BR`).

       cp -r en es

2. Translate every value in every JSON file. **Leave the keys alone.** If a key
   contains an ICU placeholder like `{count, plural, ...}`, preserve the
   structure but translate the surrounding text:

       "transactionCount": "{count, plural, one {# transaccion} other {# transacciones}}"

3. Add one entry to `frontend/src/i18n/config.ts`:

       { code: "es", label: "Espanol", dir: "ltr" }

4. Mirror the same steps in `backend/src/i18n/locales/` so server-rendered
   strings (error messages, email templates) are translated too.

5. Open a PR. No other code changes are needed.

## Testing locally

- Change the language in **Settings -> Preferences**.
- The pseudo-locale `xx` (visible in dev builds only) wraps every translated
  string with `[XX-...-XX]` markers, making it easy to spot strings that
  haven't been extracted yet.

## Namespaces

The catalogue is split into small files by feature area. To add a new
namespace, add it to the `NAMESPACES` array in `src/i18n/messages.ts` and
create matching JSON files for every locale.

| Namespace  | Contents                                          |
|------------|---------------------------------------------------|
| `common`   | Shared UI primitives (buttons, dialogs, toasts)   |
| `settings` | The settings page (themes, preferences, language) |

More namespaces will be added in subsequent PRs as feature areas are extracted.
