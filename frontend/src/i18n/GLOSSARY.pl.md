# Polish financial terminology glossary

Canonical Polish terms for Monize's UI translation (`messages/pl/*.json`). The
goal is consistency across every namespace: the same English concept must map to
the same Polish word everywhere.

Primary source: the official **GnuCash Polish glossary** (`po/glossary/pl.po`,
`glossary-1/pl.tbx`). Where GnuCash's choice does not fit a modern personal-
finance app, the deviation is noted with a rationale.

| English | Polish (canonical) | Notes |
|---|---|---|
| account | konto | |
| transaction | transakcja | |
| transfer (between accounts) | przelew | bank/account transfer |
| transfer (of securities) | przeniesienie | `transfer_in/out` of holdings — NOT "przelew" |
| deposit | wpłata | |
| withdrawal | wypłata | |
| balance | saldo | "opening balance" = "bilans otwarcia" |
| income | przychód | preferred over "dochód"; matches MS Money PL. Keep "podatek dochodowy" for income tax |
| expense | wydatek / wydatki | preferred over "koszt" for personal-finance spending |
| category | kategoria | |
| payee | odbiorca | **deviates** from GnuCash ("wierzyciel" = creditor); "odbiorca" is the correct payee semantics and matches modern apps |
| budget | budżet | |
| asset | aktywa | |
| liability | zobowiązanie / zobowiązania | |
| equity | kapitał własny | |
| net worth | wartość netto | |
| currency | waluta | |
| exchange rate | kurs wymiany | |
| security | papier wartościowy / papiery wartościowe | |
| stock / share | akcja | |
| dividend | dywidenda | |
| interest | odsetki | |
| portfolio | portfel | GnuCash: "portfel inwestycji" |
| gain | zysk | |
| loss | strata | |
| reconcile | uzgodnij / uzgadnianie | GnuCash: "uzgodnij"; NOT "rozliczanie" (settlement) |
| reconciled | uzgodniona | |
| amount | kwota | |
| memo / note | notatka | |
| tag | tag | |
| invoice | faktura | |
| bill | rachunek | |
| loan | pożyczka | |
| mortgage | hipoteka | |
| tax | podatek | "income tax" = "podatek dochodowy" |

UI register: informal-neutral imperative for actions ("Zapisz", "Anuluj",
"Usuń"). Do not translate brand names (Monize), currency/ticker codes, or
technical identifiers.
