# Kredyt: brak danych w harmonogramie i znikający symulator nadpłaty

Notatka diagnostyczna. Opisuje, dlaczego harmonogram kredytu nie odzwierciedla
rat i dlaczego symulator nadpłaty może zniknąć. Podaje też rozwiązanie.

Uwaga: przykłady kwot i nazw są poglądowe. Nie zawierają danych identyfikujących
(numerów rachunków, danych osobowych). Dane produkcyjne należy maskować.

## Objaw

- Symulator nadpłaty kredytu nie pokazuje się na stronie szczegółów kredytu.
- Po dodaniu lub edycji transakcji spłaty w harmonogramie kredytu nic się nie
  zmienia.
- Saldo kredytu w aplikacji nie spada wraz z ratami.

## Skąd Monize bierze dane do harmonogramu

Kluczowa zasada: **historia i harmonogram kredytu powstają wyłącznie z
transakcji zaksięgowanych NA koncie kredytu.**

- Strona konta pobiera transakcje przez `fetchAllAccountTransactions(accountId)`
  (`frontend/src/lib/loan-history.ts`), które woła
  `transactionsApi.getAll({ accountId })` — czyli tylko ruchy na koncie kredytu.
- `deriveLoanPaymentHistory` (`frontend/src/lib/loan-history.ts`) przechodzi po
  tych transakcjach i traktuje każdą wpłatę (kwota dodatnia) jako spłatę
  kapitału.

Wniosek: aby rata weszła do harmonogramu, musi być **transferem na konto
kredytu**. Wydatek zaksięgowany na koncie źródłowym (np. rachunek bieżący) z samą
kategorią „kredyt" nie dotyka konta kredytu i jest dla harmonogramu niewidoczny.

## Przyczyna (model danych)

W analizowanych danych na konto kredytu trafiają **tylko nadpłaty** (transfery na
konto kredytu). Raty regularne są zaksięgowane jako **wydatki na koncie
źródłowym** z kategorią kredytu, bez drugiej nogi transferu na konto kredytu.

Przykład (poglądowy):

| Data       | Konto      | Typ zapisu                         | Kwota    | Widoczne dla harmonogramu |
|------------|------------|------------------------------------|----------|---------------------------|
| 2022-07-18 | kredyt hip.| Transfer From rachunek (nadpłata)  | +4604,80 | TAK                       |
| 2022-08-05 | kredyt hip.| Transfer From rachunek (nadpłata)  | +1234,12 | TAK                       |
| 2022-09-06 | kredyt hip.| Transfer From rachunek (nadpłata)  | +1650,00 | TAK                       |
| 2023-06-05 | rachunek   | Wydatek, kategoria „kredyt"        |  -898,64 | NIE                       |
| 2023-05-05 | rachunek   | Wydatek, kategoria „kredyt"        |  -899,81 | NIE                       |

Skutki w kodzie:

1. `deriveLoanPaymentHistory` widzi wyłącznie nadpłaty. Każda z nich jest
   rozpoznana jako nadpłata (`isOverpayment` -> typ `OVERPAYMENT`,
   `frontend/src/lib/loan-history.ts`).
2. W historii jest **zero rat regularnych** (typ `REGULAR`).
3. `observedInstallment(history)` zwraca `null` — brak zaobserwowanej raty do
   przyjęcia jako kwota płatności projekcji.
4. Raty regularne **nie zmniejszają salda kredytu**, bo nie są ruchem na koncie
   kredytu. Ruszają je tylko nadpłaty.
5. Dodanie lub edycja wydatku „kredyt" na koncie źródłowym **nie zmienia
   harmonogramu** — nie dotyka konta kredytu.

## Dlaczego to nie jest kwestia oprocentowania

Symulator renderuje się tylko, gdy `buildLoanProjectionInput`
(`frontend/src/lib/loan-history.ts`) zbuduje projekcję. Zwraca ona `null`, gdy
zachodzi choć jeden warunek:

- saldo kredytu <= 0,01 (kredyt spłacony),
- brak częstotliwości płatności (`account.paymentFrequency`),
- `seed.payment` == null lub <= 0,
- `seed.annualRate` == null (brak stopy).

Gdy oprocentowanie jest ustawione na koncie, `seed.annualRate` NIE jest `null` —
stopa nie jest blokadą. Blokadą jest tu **struktura transakcji**: brak rat
regularnych na koncie kredytu (`observedInstallment` = `null`), przez co kwota
płatności musi zejść na wartość kontraktową `account.paymentAmount`, a saldo
kredytu nie odzwierciedla realnych spłat.

Dla porządku: gdyby oprocentowanie NIE było ustawione (brak `account.interestRate`
i brak wpisu zmiany oprocentowania z datą <= dziś), `resolveEffectiveLoanTerms`
(`frontend/src/lib/loan-comparison.ts`) zwróciłby `annualRate = null` i projekcja
też by się nie zbudowała. Stopa widoczna w wierszach tabeli bywa **odtworzona**
z odsetek (`assignObservedRates`), więc obecność „5,50%" w tabeli nie dowodzi, że
stopa jest zapisana. To osobna, wcześniejsza możliwa przyczyna — nie ta.

## Rozwiązanie

Ratę kredytu należy księgować jako **transfer z konta źródłowego na konto
kredytu**:

- **Kapitał** = kwota transferu na konto kredytu. To ona zmniejsza saldo kredytu.
- **Odsetki** = albo linia podziału (split) z kategorią odsetek na tym transferze,
  albo osobny wydatek z kategorią odsetek na koncie źródłowym.

Tak działają już nadpłaty w tych danych — dlatego tylko one są w harmonogramie.
Raty regularne trzeba doprowadzić do tej samej postaci.

Najprościej: na koncie kredytu użyć **„Skonfiguruj płatności cykliczne" /
„Skonfiguruj płatności"**. Kreator (`LoanPaymentSetupService` po stronie backendu)
tworzy transfer wraz z podziałem kapitał/odsetki w poprawnej postaci.

Poprawa istniejących danych: każdy wydatek „kredyt" na koncie źródłowym trzeba
przerobić na transfer na konto kredytu (kapitał), a część odsetkową ująć jako
podział lub osobny wydatek z kategorią odsetek.

## Konsekwencja dla salda

Skoro raty regularne nigdy nie ruszyły konta kredytu, **saldo kredytu w aplikacji
jest zawyżone** względem stanu faktycznego — spadło tylko o nadpłaty. Po
przeksięgowaniu rat na transfery saldo i harmonogram się zejdą.

## Jeśli źródłem jest import

Jeśli transakcje powstały z importu (MNY/CSV) i to import zapisał raty jako
wydatki z kategorią zamiast transferów na konto kredytu, to jest to błąd do
naprawienia na ścieżce importu — rata kredytu powinna wchodzić jako transfer na
konto kredytu z podziałem kapitał/odsetki. Kategoria interpretowana jest przez
`fetchLoanInterestTransactions` tylko dla **odsetek** (kategoria odsetek + konto
źródłowe), nigdy dla kapitału.

## Szybka weryfikacja

Otwórz jedną ratę regularną w rejestrze. Jeśli nie jest transferem na konto
kredytu (brak drugiej nogi „Transfer To/From" na koncie kredytu), to potwierdza
tę diagnozę.

## Odniesienia w kodzie

- `frontend/src/lib/loan-history.ts` — `fetchAllAccountTransactions`,
  `deriveLoanPaymentHistory`, `classifyPayment`, `isOverpayment`,
  `observedInstallment`, `buildLoanProjectionInput`, `resolveSeedPayment`.
- `frontend/src/lib/loan-comparison.ts` — `resolveEffectiveLoanTerms`.
- `frontend/src/components/accounts/loan-detail/LoanDetailView.tsx` — warunek
  renderowania symulatora (`projectionInput && ...`).
- `frontend/src/app/accounts/[id]/page.tsx` — ładowanie danych konta kredytu.
