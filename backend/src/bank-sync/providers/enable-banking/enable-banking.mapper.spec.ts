import { BankSyncProviderError } from "../bank-sync-provider.errors";
import {
  maskIdentifier,
  mapApplication,
  mapAuthorizationUrl,
  mapBalance,
  mapInstitutions,
  mapSession,
  mapTransaction,
  mapTransactionsPage,
} from "./enable-banking.mapper";

/** Wire JSON in, provider-neutral shapes out. Every value is synthetic. */

const invalid = { kind: "invalid_response" } as const;

describe("maskIdentifier", () => {
  it("keeps the last four characters", () => {
    expect(maskIdentifier("XX00 0000 0000 0000 0000 1234")).toBe("**** 1234");
    expect(maskIdentifier("XX00000000000000001234")).toBe("**** 1234");
  });

  it("shows nothing of an identifier too short to hide anything", () => {
    expect(maskIdentifier("12345")).toBe("****");
  });

  it("is null for anything that is not a non-empty string", () => {
    for (const value of [null, undefined, 42, {}, [], "", "   "]) {
      expect(maskIdentifier(value)).toBeNull();
    }
  });
});

describe("mapApplication", () => {
  it("reads the name and the registered redirect URLs", () => {
    expect(
      mapApplication({
        name: "  My Monize  ",
        redirect_urls: ["https://monize.example/settings/bank-sync/callback"],
      }),
    ).toEqual({
      applicationName: "My Monize",
      redirectUrls: ["https://monize.example/settings/bank-sync/callback"],
    });
  });

  it("tolerates absent and mistyped fields", () => {
    expect(mapApplication({})).toEqual({
      applicationName: null,
      redirectUrls: [],
    });
    expect(
      mapApplication({
        name: 5,
        redirect_urls: ["https://a.example", 7, null],
      }),
    ).toEqual({ applicationName: null, redirectUrls: ["https://a.example"] });
    expect(mapApplication({ redirect_urls: "https://a.example" })).toEqual({
      applicationName: null,
      redirectUrls: [],
    });
  });

  it.each([null, "text", 5, []])(
    "raises invalid_response for %p",
    (payload) => {
      expect(() => mapApplication(payload)).toThrow(
        expect.objectContaining(invalid),
      );
    },
  );
});

describe("mapInstitutions", () => {
  it("maps a bank", () => {
    expect(
      mapInstitutions({
        aspsps: [
          {
            name: "Example Bank",
            country: "pl",
            logo: "https://logos.example/bank.png",
            psu_types: ["personal", "business"],
            maximum_consent_validity: 7_776_000,
          },
        ],
      }),
    ).toEqual([
      {
        name: "Example Bank",
        country: "PL",
        logoUrl: "https://logos.example/bank.png",
        psuTypes: ["personal", "business"],
        maximumConsentValiditySeconds: 7_776_000,
      },
    ]);
  });

  it("skips a row without a name or a two-letter country, and non-objects", () => {
    const result = mapInstitutions({
      aspsps: [
        null,
        "bank",
        { country: "PL" },
        { name: "No Country" },
        { name: "Long Country", country: "POL" },
        { name: "Digits", country: "P1" },
        { name: "Kept", country: "DE" },
      ],
    });
    expect(result.map((bank) => bank.name)).toEqual(["Kept"]);
  });

  it("nulls what is absent or mistyped", () => {
    expect(
      mapInstitutions({
        aspsps: [
          {
            name: "Bare Bank",
            country: "DE",
            logo: 5,
            psu_types: "personal",
            maximum_consent_validity: "90",
          },
        ],
      }),
    ).toEqual([
      {
        name: "Bare Bank",
        country: "DE",
        logoUrl: null,
        psuTypes: [],
        maximumConsentValiditySeconds: null,
      },
    ]);
  });

  it("keeps only an https logo, and only a positive finite validity", () => {
    const [http, script, zero, negative, nan] = mapInstitutions({
      aspsps: [
        { name: "A", country: "DE", logo: "http://logos.example/a.png" },
        { name: "B", country: "DE", logo: "javascript:alert(1)" },
        { name: "C", country: "DE", maximum_consent_validity: 0 },
        { name: "D", country: "DE", maximum_consent_validity: -5 },
        { name: "E", country: "DE", maximum_consent_validity: NaN },
      ],
    });
    expect(http.logoUrl).toBeNull();
    expect(script.logoUrl).toBeNull();
    expect(zero.maximumConsentValiditySeconds).toBeNull();
    expect(negative.maximumConsentValiditySeconds).toBeNull();
    expect(nan.maximumConsentValiditySeconds).toBeNull();
  });

  it("bounds a name to 255 characters and strips control characters", () => {
    const [bank] = mapInstitutions({
      aspsps: [{ name: `Bank\u0000\n${"x".repeat(400)}`, country: "DE" }],
    });
    expect(bank.name).toBe(`Bank ${"x".repeat(250)}`);
  });

  it("returns an empty list for an empty answer", () => {
    expect(mapInstitutions({ aspsps: [] })).toEqual([]);
  });

  it.each([null, [], "x", { aspsps: "x" }, { aspsps: null }, {}])(
    "raises invalid_response for %p",
    (payload) => {
      expect(() => mapInstitutions(payload)).toThrow(
        expect.objectContaining(invalid),
      );
    },
  );
});

describe("mapAuthorizationUrl", () => {
  it("returns an https URL", () => {
    expect(mapAuthorizationUrl({ url: "https://bank.example/auth?x=1" })).toBe(
      "https://bank.example/auth?x=1",
    );
  });

  it.each([
    { url: "http://bank.example/auth" },
    { url: "javascript:alert(1)" },
    { url: "not a url" },
    { url: "" },
    { url: 5 },
    {},
    null,
  ])("raises invalid_response for %p", (payload) => {
    expect(() => mapAuthorizationUrl(payload)).toThrow(
      expect.objectContaining(invalid),
    );
  });
});

describe("mapSession", () => {
  const session = {
    session_id: "session-1",
    access: { valid_until: "2026-06-01T12:00:00.000000+00:00" },
    accounts: [
      {
        uid: "uid-1",
        identification_hash: "hash-1",
        name: "Everyday Account",
        currency: "eur",
        account_id: { iban: "XX00 0000 0000 0000 0000 1234" },
      },
    ],
  };

  it("maps the session and its accounts", () => {
    expect(mapSession(session)).toEqual({
      sessionId: "session-1",
      validUntil: new Date("2026-06-01T12:00:00.000Z"),
      accounts: [
        {
          externalAccountId: "uid-1",
          identificationHash: "hash-1",
          displayName: "Everyday Account",
          identifierMasked: "**** 1234",
          currencyCode: "EUR",
        },
      ],
    });
  });

  it("never carries the full identifier", () => {
    const serialized = JSON.stringify(mapSession(session));
    expect(serialized).not.toContain("0000 0000 0000");
  });

  it("falls back to `details` for the name and to other.identification for the number", () => {
    const [account] = mapSession({
      session_id: "s",
      accounts: [
        {
          uid: "uid-2",
          details: "Savings pot",
          account_id: { other: { identification: "ACC-00001234567" } },
        },
      ],
    }).accounts;
    expect(account.displayName).toBe("Savings pot");
    expect(account.identifierMasked).toBe("**** 4567");
  });

  it("nulls every optional field and skips a row without a uid", () => {
    const result = mapSession({
      session_id: "s",
      accounts: [
        null,
        "uid",
        { name: "no uid" },
        { uid: "uid-3", currency: "EURO", account_id: "x", name: 5 },
      ],
    });
    expect(result.accounts).toEqual([
      {
        externalAccountId: "uid-3",
        identificationHash: null,
        displayName: null,
        identifierMasked: null,
        currencyCode: null,
      },
    ]);
  });

  it("has a null validUntil when the expiry is absent or unreadable", () => {
    expect(mapSession({ session_id: "s", accounts: [] }).validUntil).toBeNull();
    expect(
      mapSession({
        session_id: "s",
        accounts: [],
        access: { valid_until: "soon" },
      }).validUntil,
    ).toBeNull();
    expect(
      mapSession({ session_id: "s", accounts: [], access: "x" }).validUntil,
    ).toBeNull();
  });

  it.each([
    null,
    "x",
    {},
    { session_id: "" },
    { session_id: 5, accounts: [] },
    { session_id: "s" },
    { session_id: "s", accounts: "x" },
  ])("raises invalid_response for %p", (payload) => {
    expect(() => mapSession(payload)).toThrow(expect.objectContaining(invalid));
  });
});

describe("mapTransaction", () => {
  const wire = {
    entry_reference: "E-1",
    transaction_id: "T-1",
    reference_number: "REF-1",
    transaction_amount: { amount: "12.34", currency: "EUR" },
    credit_debit_indicator: "DBIT",
    status: "BOOK",
    booking_date: "2026-03-10",
    value_date: "2026-03-11",
    transaction_date: "2026-03-09",
    creditor: { name: "Example Cafe" },
    debtor: { name: "Me" },
    remittance_information: ["Latte", "Card 1234"],
  };

  it("maps a booked debit and picks the creditor as the counterparty", () => {
    expect(mapTransaction(wire)).toEqual({
      entryReference: "E-1",
      transactionId: "T-1",
      bankReference: "REF-1",
      amount: "12.34",
      currencyCode: "EUR",
      direction: "debit",
      booked: true,
      bookingDate: "2026-03-10",
      valueDate: "2026-03-11",
      transactionDate: "2026-03-09",
      counterpartyName: "Example Cafe",
      remittance: ["Latte", "Card 1234"],
    });
  });

  it("picks the debtor as the counterparty for a credit", () => {
    const row = mapTransaction({
      ...wire,
      credit_debit_indicator: "CRDT",
      debtor: { name: "Employer Ltd" },
    });
    expect(row).toMatchObject({
      direction: "credit",
      counterpartyName: "Employer Ltd",
    });
  });

  it("has no counterparty when the direction is unknown", () => {
    const row = mapTransaction({ ...wire, credit_debit_indicator: "???" });
    expect(row).toMatchObject({ direction: null, counterpartyName: null });
  });

  describe("booked", () => {
    it("is true only for BOOK", () => {
      expect(mapTransaction({ ...wire, status: "BOOK" })?.booked).toBe(true);
      expect(mapTransaction({ ...wire, status: "book" })?.booked).toBe(true);
      for (const status of ["PDNG", "INFO", "HOLD", "OTHR", "RJCT"]) {
        expect(mapTransaction({ ...wire, status })?.booked).toBe(false);
      }
    });

    it("with no status, is true only when a booking date is present", () => {
      expect(mapTransaction({ ...wire, status: undefined })?.booked).toBe(true);
      expect(
        mapTransaction({ ...wire, status: undefined, booking_date: undefined })
          ?.booked,
      ).toBe(false);
      expect(
        mapTransaction({ ...wire, status: 5, booking_date: null })?.booked,
      ).toBe(false);
    });

    it("an explicit non-booked status wins over a booking date", () => {
      expect(
        mapTransaction({ ...wire, status: "PDNG", booking_date: "2026-03-10" })
          ?.booked,
      ).toBe(false);
    });
  });

  it("tolerates an empty object: every field null, nothing thrown", () => {
    expect(mapTransaction({})).toEqual({
      entryReference: null,
      transactionId: null,
      bankReference: null,
      amount: null,
      currencyCode: null,
      direction: null,
      booked: false,
      bookingDate: null,
      valueDate: null,
      transactionDate: null,
      counterpartyName: null,
      remittance: [],
    });
  });

  it("tolerates wrong types in every field", () => {
    expect(() =>
      mapTransaction({
        entry_reference: 5,
        transaction_id: {},
        reference_number: [],
        transaction_amount: "12",
        credit_debit_indicator: 7,
        status: {},
        booking_date: 20260310,
        creditor: "Example",
        debtor: [],
        remittance_information: { line: 1 },
      }),
    ).not.toThrow();
  });

  it("skips a row that is not an object", () => {
    for (const row of [null, undefined, 5, "x", []]) {
      expect(mapTransaction(row)).toBeNull();
    }
  });

  it("keeps an amount only when it is a plain decimal", () => {
    const amountOf = (amount: unknown) =>
      mapTransaction({
        ...wire,
        transaction_amount: { amount, currency: "EUR" },
      })?.amount;
    expect(amountOf("12.34")).toBe("12.34");
    expect(amountOf(" 7 ")).toBe("7");
    expect(amountOf(12.5)).toBe("12.5");
    expect(amountOf("1e3")).toBeNull();
    expect(amountOf("12,50")).toBeNull();
    expect(amountOf(NaN)).toBeNull();
    expect(amountOf(null)).toBeNull();
  });

  it("accepts a bare string as the remittance, and bounds the lines", () => {
    expect(
      mapTransaction({ ...wire, remittance_information: "Rent" })?.remittance,
    ).toEqual(["Rent"]);
    const lines = mapTransaction({
      ...wire,
      remittance_information: Array.from({ length: 50 }, () =>
        "x".repeat(2000),
      ),
    })?.remittance;
    expect(lines).toHaveLength(20);
    expect(lines?.[0]).toHaveLength(750);
  });

  it("drops non-string and blank remittance lines", () => {
    expect(
      mapTransaction({
        ...wire,
        remittance_information: ["a", 5, null, "  ", "b"],
      })?.remittance,
    ).toEqual(["a", "b"]);
  });

  it("bounds references and names to 255 characters", () => {
    const row = mapTransaction({
      ...wire,
      entry_reference: "e".repeat(400),
      transaction_id: "t".repeat(400),
      reference_number: "r".repeat(400),
      creditor: { name: "n".repeat(400) },
    });
    expect(row?.entryReference).toHaveLength(255);
    expect(row?.transactionId).toHaveLength(255);
    expect(row?.bankReference).toHaveLength(255);
    expect(row?.counterpartyName).toHaveLength(255);
  });

  it("upper-cases the currency and nulls one that is not three letters", () => {
    const currencyOf = (currency: unknown) =>
      mapTransaction({
        ...wire,
        transaction_amount: { amount: "1", currency },
      })?.currencyCode;
    expect(currencyOf("eur")).toBe("EUR");
    expect(currencyOf("EU")).toBeNull();
    expect(currencyOf("E1R")).toBeNull();
    expect(currencyOf(978)).toBeNull();
  });
});

describe("mapTransactionsPage", () => {
  it("maps the rows and the continuation key", () => {
    const page = mapTransactionsPage({
      transactions: [{ entry_reference: "E-1", status: "BOOK" }, null, "x"],
      continuation_key: "next-page",
    });
    expect(page.transactions).toHaveLength(1);
    expect(page.transactions[0].entryReference).toBe("E-1");
    expect(page.continuationKey).toBe("next-page");
  });

  it("has no continuation key on the last page", () => {
    for (const continuation_key of [null, undefined, "", "  ", 5]) {
      expect(
        mapTransactionsPage({ transactions: [], continuation_key })
          .continuationKey,
      ).toBeNull();
    }
  });

  it.each([null, [], "x", {}, { transactions: null }, { transactions: {} }])(
    "raises invalid_response for %p",
    (payload) => {
      expect(() => mapTransactionsPage(payload)).toThrow(
        expect.objectContaining(invalid),
      );
    },
  );

  it("throws the typed error class", () => {
    expect(() => mapTransactionsPage(null)).toThrow(BankSyncProviderError);
  });
});

describe("mapBalance", () => {
  const balance = (type: string, amount: string, extra = {}) => ({
    balance_type: type,
    balance_amount: { amount, currency: "EUR" },
    reference_date: "2026-03-10",
    ...extra,
  });

  it("picks CLBD, then ITBD, then ITAV, then XPCD", () => {
    const all = [
      balance("XPCD", "4"),
      balance("ITAV", "3"),
      balance("ITBD", "2"),
      balance("CLBD", "1"),
    ];
    expect(mapBalance({ balances: all })?.amount).toBe("1");
    expect(mapBalance({ balances: all.slice(0, 3) })?.amount).toBe("2");
    expect(mapBalance({ balances: all.slice(0, 2) })?.amount).toBe("3");
    expect(mapBalance({ balances: all.slice(0, 1) })?.amount).toBe("4");
  });

  it("falls back to the first readable balance of another type", () => {
    const result = mapBalance({
      balances: [
        { balance_type: "BROKEN" },
        balance("OTHR", "9"),
        balance("FWAV", "8"),
      ],
    });
    expect(result?.amount).toBe("9");
  });

  it("maps all four fields and keeps a negative amount", () => {
    expect(mapBalance({ balances: [balance("clbd", "-250.75")] })).toEqual({
      amount: "-250.75",
      currencyCode: "EUR",
      referenceDate: "2026-03-10",
      balanceType: "CLBD",
    });
  });

  it("skips a balance without a readable amount or currency", () => {
    const result = mapBalance({
      balances: [
        {
          balance_type: "CLBD",
          balance_amount: { amount: "x", currency: "EUR" },
        },
        {
          balance_type: "CLBD",
          balance_amount: { amount: "1", currency: "?" },
        },
        { balance_type: "CLBD", balance_amount: "1" },
        null,
        balance("ITBD", "5"),
      ],
    });
    expect(result?.amount).toBe("5");
  });

  it("is null, not zero, when the bank reported no balance", () => {
    expect(mapBalance({ balances: [] })).toBeNull();
    expect(mapBalance({ balances: [{ balance_type: "CLBD" }] })).toBeNull();
  });

  it.each([null, "x", {}, { balances: {} }, { balances: null }])(
    "raises invalid_response for %p",
    (payload) => {
      expect(() => mapBalance(payload)).toThrow(
        expect.objectContaining(invalid),
      );
    },
  );
});
