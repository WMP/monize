# Opis zmian

Dwie niezależne gałęzie, oparte na aktualnym `main` od upstream (kenlasko) — w `main` była już konsolidacja MCP (`manage_securities`, `manage_payees`, `manage_transactions`).

| Gałąź | Zakres | Bazuje na | PR / Issue |
|---|---|---|---|
| `feat/categorized-transfers` | Kategoria na transferze + poprawki UX/raportu | baza PR #743 (`2b6e82b3`) | PR #743 |
| `fix/investment-fx-rate-744` | Kurs FX dla transakcji inwestycyjnych | świeży `origin/main` (`551b845d`) | Issue #744 |

---

## 1. `feat/categorized-transfers` (PR #743)

Bazowy commit funkcji (`5d957d63`, autor: WMP) pozwala transferowi nieść kategorię wydatkową i pokazuje go w raporcie miesięcznym. Poniżej **moje commity uzupełniające** z tej sesji.

### `ebf81325` — fix znaku kwoty na transferze
**Problem (z review kenlasko):** wybór kategorii typu *Expense* na transferze odwracał znak kwoty na ujemny, przez co transfer nie przechodził walidacji „amount must be positive".

**Fix:** w `handleCategoryChange` (`frontend/src/components/transactions/TransactionForm.tsx`) dodany guard `mode === 'normal'` — korekta znaku wg typu kategorii działa tylko w trybie normalnym, lustrzanie do istniejącego guardu w `handleAmountChange`. Znaki nóg transferu i tak ustalane są przy zapisie.

- Test regresji: kategoria wydatkowa na transferze utrzymuje dodatnią kwotę.

### `73b3625a` — kategoria widoczna na liście transakcji
**Problem:** wiersz transferu w kolumnie „Kategoria" pokazywał tylko chip konta ze strzałką (`→ Konto`), całkowicie ukrywając przypisaną kategorię.

**Fix:** w `TransactionRow.tsx` dla transferu z kategorią pokazujemy **chip kategorii + chip strzałki** (np. `[Inwestycje] [→ BOŚ IKE - Cash]`). Chip kategorii jest klikalny (filtruje po kategorii), jak zwykły chip.

- Test: skategoryzowany transfer renderuje kategorię i strzałkę, chip filtruje.

### `b66a876d` — pełne tłumaczenia (i18n)
Lokalizacja dwóch nowych kluczy funkcji (`transactions.form.fields.categoryOptional`, `transactions.form.transferCategoryNote`) na wszystkie 18 pełnych lokalizacji (`de, es, fr, hi, id, it, ja, ko, nl, pl, pt, pt-BR, ru, tr, uk, vi, zh-CN, zh-TW`). Warianty `en-US/en-CA/en-GB` dziedziczą z `en`.

### `d94c0a07` — notka dokumentacyjna w raporcie (bez zmiany zachowania)
Opisane w SQL `monthly-category-breakdown.service.ts`, że kategoria jest zapisywana na **obu nogach** transferu, więc:
- **agregat raportu liczy tylko nogę wypływu** (jedna pozycja netto, np. `-1000`),
- **drill-down/filtr po kategorii pokazuje obie nogi** (`-1000` i `+1000`), które wizualnie znoszą się do zera — to oczekiwane, nie podwójne liczenie; wartość netto żyje w agregacie.

### Decyzje projektowe (świadomie BEZ zmian)
- Zachowanie raportu zostaje — agregat jest poprawny (`-1000`).
- `excludeFromNetWorth` pozostaje czysto net-worthowe (wpływa na net worth + filtr listy kont + API/historia zmian), **nie** dotyka raportów. Nie nadpisane.
- Raporty kategorii nadal pomijają konta `INVESTMENT`. Znana, nietknięta niespójność: rollup transferów w raporcie miesięcznym nie filtruje kont inwestycyjnych ani `excludeFromNetWorth` (osobny temat na przyszłość).

### Status
Testy frontu (TransactionForm, TransferTransactionFields, TransactionRow) zielone; backend breakdown 11 ✅; `tsc` czysty; parity i18n 980 ✅. Wypchnięte do forka.

---

## 2. `fix/investment-fx-rate-744` (Issue #744)

**Problem:** cross-currency Buy/Sell inwestycji (np. papier w EUR finansowany z konta PLN) tworzony przez MCP/AI po cichu używał kursu `1.0`, gdy brakowało zapisanego kursu — księgowanie na koncie gotówkowym i koszt nabycia były zaniżone o wielkość kursu.

### `f84d9a2d` — właściwy kurs FX zamiast cichego 1.0
Kolejność rozwiązywania kursu (`resolveCashExchangeRate`), bez cichego `1.0`:
1. **Jawny override** `exchangeRate` (formularz web lub MCP/AI z danych rozliczenia brokera).
2. **Kurs na datę transakcji** — nowa metoda `ExchangeRateService.getRateForDate()`: najbliższy zapisany kurs ≤ data, inaczej pobranie z Yahoo dla tej daty (z zapisem wybranego punktu).
3. **Najnowszy zapisany kurs** jako źródło wtórne.
4. Dla realnej pary walut bez kursu — **rzuca błąd** (`errors.securities.exchangeRateUnavailable`) zamiast księgować po `1.0`.

Zgodnie z regułą współdzielonych narzędzi, opcjonalny `exchangeRate` wystawiony na **MCP i AI** (`manage_investment_transactions`, create + update):
- `backend/src/mcp/tools/investments.tool.ts`
- `backend/src/ai/query/tool-input-schemas.ts`, `tool-definitions.ts`, `tool-executor.service.ts`

Przepuszczony przez `InvestmentCreateRowInput`/`UpdateRowInput` i ścieżkę preview do istniejącego override w DTO. Data transakcji wpięta we wszystkie cztery wywołania `resolveCashExchangeRate` (create, preview, embedded-split, update re-resolve).

**Testy:** precedencja `getRateForDate` (stored / dated Yahoo / null); create odrzuca nieokreślony kurs cross-currency i używa kursu na datę; MCP i AI przekazują jawny `exchangeRate`. Łącznie 416 ✅ w dotkniętych suitach; `tsc` czysty.

### `e18c89cd` — pełne tłumaczenia (i18n)
Klucz `errors.securities.exchangeRateUnavailable` przetłumaczony na wszystkie 18 pełnych lokalizacji (placeholdery `{{ from }}`/`{{ to }}` i nazwa pola `exchangeRate` zachowane). Backend parity 170 ✅.

### Kryteria akceptacji z issue #744
- Cross-currency Buy/Sell przez MCP/AI księguje po kursie na **datę transakcji** (z danych albo z Yahoo), nie `1.0`. ✅
- MCP i AI przyjmują opcjonalny `exchangeRate` (obie warstwy zsynchronizowane). ✅
- Brak cichego `1.0` dla różnych walut — nieokreślony kurs jest zgłaszany. ✅
- Repro (IUSQ EUR→PLN, 2026-06-08, 3 @ €104.66) księguje ~zł 1350, nie zł 313.98. ✅ (kurs z Yahoo na datę; lub dokładnie po podaniu `exchangeRate: 4.2514`).

---

## Jak testować

Obie gałęzie są w osobnych worktree z podlinkowanym `node_modules`:
- `../monize-743` — `feat/categorized-transfers`
- `../monize-744` — `fix/investment-fx-rate-744`

Branche budują się i mają komplet tłumaczeń.
