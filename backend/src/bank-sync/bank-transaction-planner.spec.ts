import { createHash } from "node:crypto";
import { TRANSACTION_NOTE_MAX_LENGTH } from "../common/transaction-note";
import {
  BANK_IMPORT_REFUSAL_REASONS,
  BankImportContext,
  planBankImport,
} from "./bank-transaction-planner";
import type { BankTransaction } from "./providers/bank-sync-provider.interface";

/**
 * The mapping truth table of docs/specs/bank-sync.md section 6, one line at a
 * time, then the amount, the text fields and the external key. Every row is
 * synthetic.
 */

const CTX: BankImportContext = {
  accountCurrencyCode: "EUR",
  syncFromDate: "2026-03-01",
  today: "2026-03-20",
};

const row = (overrides: Partial<BankTransaction> = {}): BankTransaction => ({
  entryReference: null,
  transactionId: null,
  bankReference: null,
  amount: "10.00",
  currencyCode: "EUR",
  direction: "debit",
  booked: true,
  bookingDate: "2026-03-10",
  valueDate: null,
  transactionDate: null,
  counterpartyName: null,
  remittance: [],
  ...overrides,
});

const sha256 = (value: string) =>
  createHash("sha256").update(value).digest("hex");

const plan = (rows: BankTransaction[], ctx: BankImportContext = CTX) =>
  planBankImport(rows, ctx);

const noRefusals = Object.fromEntries(
  BANK_IMPORT_REFUSAL_REASONS.map((reason) => [reason, 0]),
);

describe("planBankImport", () => {
  describe("the truth table, line by line", () => {
    it("1. a row that is not booked is counted as pending and nothing else", () => {
      // Every other field is bad too: line 1 wins.
      const result = plan([
        row({
          booked: false,
          bookingDate: null,
          amount: "abc",
          direction: null,
          currencyCode: "USD",
        }),
      ]);
      expect(result.pending).toBe(1);
      expect(result.planned).toEqual([]);
      expect(result.refused).toEqual(noRefusals);
      expect(result.beforeCutoff).toBe(0);
    });

    it("2. a row with no valid date is refused as missing_date", () => {
      const result = plan([
        row({ bookingDate: null }),
        row({ bookingDate: "2026-13-45", valueDate: "yesterday" }),
        row({ bookingDate: "", valueDate: "2026-02-30" }),
      ]);
      expect(result.refused.missing_date).toBe(3);
      expect(result.planned).toEqual([]);
    });

    it("2. missing_date wins over every later line", () => {
      const result = plan([
        row({
          bookingDate: null,
          amount: "abc",
          direction: null,
          currencyCode: "USD",
        }),
      ]);
      expect(result.refused).toEqual({ ...noRefusals, missing_date: 1 });
    });

    it("3. a date before the cut-off is counted as beforeCutoff, not refused", () => {
      const result = plan([
        row({ bookingDate: "2026-02-28" }),
        // Wins over the later lines: bad amount, unknown direction.
        row({ bookingDate: "2026-01-01", amount: "abc", direction: null }),
      ]);
      expect(result.beforeCutoff).toBe(2);
      expect(result.planned).toEqual([]);
      expect(result.refused).toEqual(noRefusals);
    });

    it("3. a row dated exactly on the cut-off is planned", () => {
      const result = plan([row({ bookingDate: "2026-03-01" })]);
      expect(result.beforeCutoff).toBe(0);
      expect(result.planned).toHaveLength(1);
    });

    it("4. a date after today + 1 day is refused as future_date", () => {
      const result = plan([
        row({ bookingDate: "2026-03-22" }),
        // Wins over the later lines.
        row({ bookingDate: "2026-04-01", amount: "abc" }),
      ]);
      expect(result.refused).toEqual({ ...noRefusals, future_date: 2 });
      expect(result.planned).toEqual([]);
    });

    it("4. today and today + 1 are planned", () => {
      const result = plan([
        row({ bookingDate: "2026-03-20" }),
        row({ bookingDate: "2026-03-21", amount: "11.00" }),
      ]);
      expect(result.planned.map((p) => p.transactionDate)).toEqual([
        "2026-03-20",
        "2026-03-21",
      ]);
    });

    it("4. today + 1 crosses a month boundary correctly", () => {
      const ctx = { ...CTX, today: "2026-03-31" };
      expect(
        plan([row({ bookingDate: "2026-04-01" })], ctx).planned,
      ).toHaveLength(1);
      expect(
        plan([row({ bookingDate: "2026-04-02" })], ctx).refused.future_date,
      ).toBe(1);
    });

    it("5. an amount that does not match the pattern is refused as invalid_amount", () => {
      const bad: Array<string | null> = [
        null,
        "",
        "   ",
        "abc",
        "-5",
        "+5",
        "1e3",
        "12,50",
        ".5",
        "5.",
        "1 000",
        "1.123456789",
        "12345678901234567",
        "NaN",
        "Infinity",
      ];
      const result = plan(bad.map((amount) => row({ amount })));
      expect(result.refused.invalid_amount).toBe(bad.length);
      expect(result.planned).toEqual([]);
    });

    it("5. invalid_amount wins over unknown_direction and currency_mismatch", () => {
      const result = plan([
        row({ amount: "abc", direction: null, currencyCode: "USD" }),
      ]);
      expect(result.refused).toEqual({ ...noRefusals, invalid_amount: 1 });
    });

    it("6. a direction that is neither credit nor debit is refused as unknown_direction", () => {
      const result = plan([
        row({ direction: null }),
        // Wins over currency_mismatch.
        row({ direction: null, currencyCode: "USD" }),
      ]);
      expect(result.refused).toEqual({ ...noRefusals, unknown_direction: 2 });
    });

    it("7. a currency that differs from the account's is refused as currency_mismatch", () => {
      const result = plan([row({ currencyCode: "USD" })]);
      expect(result.refused).toEqual({ ...noRefusals, currency_mismatch: 1 });
      expect(result.planned).toEqual([]);
    });

    it("7. a row with no currency is refused as currency_mismatch, never assumed", () => {
      const result = plan([
        row({ currencyCode: null }),
        row({ currencyCode: "  " }),
      ]);
      expect(result.refused.currency_mismatch).toBe(2);
      expect(result.planned).toEqual([]);
    });

    it("7. the currency comparison ignores case and surrounding space", () => {
      const result = plan([row({ currencyCode: " eur " })]);
      expect(result.planned).toHaveLength(1);
      const lower = plan([row()], { ...CTX, accountCurrencyCode: " eur" });
      expect(lower.planned).toHaveLength(1);
    });

    it("8. otherwise the row is planned", () => {
      const result = plan([row()]);
      expect(result.planned).toHaveLength(1);
      expect(result.refused).toEqual(noRefusals);
      expect(result.pending).toBe(0);
      expect(result.beforeCutoff).toBe(0);
    });

    it("counts every outcome in one call, in provider order for the planned rows", () => {
      const result = plan([
        row({ bookingDate: "2026-03-05", amount: "1.00" }),
        row({ booked: false }),
        row({ bookingDate: null }),
        row({ bookingDate: "2026-01-05" }),
        row({ bookingDate: "2026-03-06", amount: "2.00" }),
        row({ currencyCode: "GBP" }),
      ]);
      expect(result.planned.map((p) => p.amount)).toEqual([-1, -2]);
      expect(result.pending).toBe(1);
      expect(result.beforeCutoff).toBe(1);
      expect(result.refused).toEqual({
        ...noRefusals,
        missing_date: 1,
        currency_mismatch: 1,
      });
    });
  });

  describe("the planned row", () => {
    it("negates a debit and keeps a credit", () => {
      const result = plan([
        row({ direction: "credit", amount: "1000" }),
        row({ direction: "debit", amount: "12.50" }),
      ]);
      expect(result.planned.map((p) => p.amount)).toEqual([1000, -12.5]);
    });

    it("rounds with roundMoney, the money precision of four decimals", () => {
      // The spec text quotes -12.35 for this input, which is a two-decimal
      // rounding; `roundMoney` (the helper the spec names) keeps four, the
      // precision of decimal(20,4). See the report.
      const result = plan([
        row({ direction: "debit", amount: "12.345" }),
        row({ direction: "debit", amount: "12.34565" }),
        row({ direction: "credit", amount: "0.1" }),
      ]);
      expect(result.planned.map((p) => p.amount)).toEqual([
        -12.345, -12.3457, 0.1,
      ]);
    });

    it("trims the amount before matching it", () => {
      const result = plan([row({ direction: "credit", amount: " 5.25 " })]);
      expect(result.planned[0].amount).toBe(5.25);
    });

    it("accepts the widest amount the pattern allows", () => {
      const result = plan([
        row({ direction: "credit", amount: "1234567890123456.12345678" }),
      ]);
      expect(result.planned).toHaveLength(1);
      expect(Number.isFinite(result.planned[0].amount)).toBe(true);
    });

    it("plans a debit of zero as 0, not -0", () => {
      const result = plan([row({ direction: "debit", amount: "0.00" })]);
      expect(Object.is(result.planned[0].amount, 0)).toBe(true);
    });

    it("dates the row by the first valid of booking, value and transaction date", () => {
      const result = plan([
        row({
          bookingDate: "2026-03-10",
          valueDate: "2026-03-11",
          transactionDate: "2026-03-12",
          amount: "1",
        }),
        row({
          bookingDate: "not a date",
          valueDate: "2026-03-11",
          transactionDate: "2026-03-12",
          amount: "2",
        }),
        row({
          bookingDate: null,
          valueDate: null,
          transactionDate: "2026-03-12",
          amount: "3",
        }),
      ]);
      expect(result.planned.map((p) => p.transactionDate)).toEqual([
        "2026-03-10",
        "2026-03-11",
        "2026-03-12",
      ]);
    });

    it("applies the cut-off to the date the row is planned under", () => {
      // The booking date is invalid, so the (earlier) value date decides.
      const result = plan([
        row({ bookingDate: "bad", valueDate: "2026-02-27" }),
      ]);
      expect(result.beforeCutoff).toBe(1);
    });

    describe("payee text", () => {
      it("uses the counterparty the adapter chose for the direction", () => {
        const result = plan([
          row({ counterpartyName: "  Example Cafe  ", remittance: ["Latte"] }),
        ]);
        expect(result.planned[0].payeeText).toBe("Example Cafe");
      });

      it("falls back to the first remittance line", () => {
        const result = plan([
          row({ counterpartyName: null, remittance: ["", " Card 1234 ", "x"] }),
        ]);
        expect(result.planned[0].payeeText).toBe("Card 1234");
      });

      it("is null when nothing names a payee", () => {
        const result = plan([
          row({ counterpartyName: "   ", remittance: ["  "] }),
        ]);
        expect(result.planned[0].payeeText).toBeNull();
      });

      it("is bounded to 100 characters", () => {
        const result = plan([row({ counterpartyName: "A".repeat(150) })]);
        expect(result.planned[0].payeeText).toBe("A".repeat(100));
      });

      it("does not split a surrogate pair at the bound", () => {
        const name = `${"A".repeat(99)}\u{1F600}tail`;
        const result = plan([row({ counterpartyName: name })]);
        expect(result.planned[0].payeeText).toBe("A".repeat(99));
      });
    });

    describe("description", () => {
      it("joins the remittance lines with a space", () => {
        const result = plan([
          row({ remittance: ["Invoice 42", "March rent"] }),
        ]);
        expect(result.planned[0].description).toBe("Invoice 42 March rent");
      });

      it("drops blank lines, and is null when nothing is left", () => {
        expect(
          plan([row({ remittance: [" a ", "", "  ", "b"] })]).planned[0]
            .description,
        ).toBe("a b");
        expect(
          plan([row({ remittance: [] })]).planned[0].description,
        ).toBeNull();
        expect(
          plan([row({ remittance: ["   "] })]).planned[0].description,
        ).toBeNull();
      });

      it("is bounded by TRANSACTION_NOTE_MAX_LENGTH", () => {
        const result = plan([
          row({ remittance: ["x".repeat(TRANSACTION_NOTE_MAX_LENGTH + 100)] }),
        ]);
        expect(result.planned[0].description).toHaveLength(
          TRANSACTION_NOTE_MAX_LENGTH,
        );
      });
    });

    describe("reference number", () => {
      it("is the bank's reference, trimmed", () => {
        const result = plan([row({ bankReference: " REF-77 " })]);
        expect(result.planned[0].referenceNumber).toBe("REF-77");
      });

      it("is null when absent or blank, and bounded to 100 characters", () => {
        expect(plan([row()]).planned[0].referenceNumber).toBeNull();
        expect(
          plan([row({ bankReference: "  " })]).planned[0].referenceNumber,
        ).toBeNull();
        expect(
          plan([row({ bankReference: "R".repeat(300) })]).planned[0]
            .referenceNumber,
        ).toBe("R".repeat(100));
      });

      it("is display data only: the key does not use it", () => {
        const withRef = plan([row({ bankReference: "SAME" })]).planned[0];
        const other = plan([row({ bankReference: "OTHER" })]).planned[0];
        expect(withRef.externalKey).toBe(other.externalKey);
      });
    });
  });

  describe("external key", () => {
    it("prefers ref: over id: and over the hash", () => {
      const result = plan([
        row({ entryReference: "E-1", transactionId: "T-1" }),
        row({ entryReference: null, transactionId: "T-2", amount: "2" }),
      ]);
      expect(result.planned.map((p) => p.externalKey)).toEqual([
        "ref:E-1",
        "id:T-2",
      ]);
    });

    it("skips a blank reference and falls through to the id", () => {
      const result = plan([
        row({ entryReference: "   ", transactionId: "T-3" }),
      ]);
      expect(result.planned[0].externalKey).toBe("id:T-3");
    });

    it("trims the reference and the id", () => {
      const result = plan([
        row({ entryReference: "  E-9  " }),
        row({ transactionId: " T-9 ", amount: "2" }),
      ]);
      expect(result.planned.map((p) => p.externalKey)).toEqual([
        "ref:E-9",
        "id:T-9",
      ]);
    });

    it("builds hash: + SHA-256 of date|amount|currency|direction|payee|description + :0", () => {
      const result = plan([
        row({
          amount: "4.50",
          counterpartyName: "Example Cafe",
          remittance: ["Latte"],
        }),
      ]);
      const expected = sha256("2026-03-10|4.5|EUR|debit|Example Cafe|Latte");
      expect(result.planned[0].externalKey).toBe(`hash:${expected}:0`);
    });

    it("uses empty strings for a missing payee and description", () => {
      const result = plan([row({ amount: "3" })]);
      const expected = sha256("2026-03-10|3|EUR|debit||");
      expect(result.planned[0].externalKey).toBe(`hash:${expected}:0`);
    });

    it("is stable: the same row gives the same key, a different row another", () => {
      const a = plan([row()]).planned[0].externalKey;
      const b = plan([row()]).planned[0].externalKey;
      const c = plan([row({ amount: "10.01" })]).planned[0].externalKey;
      const d = plan([row({ direction: "credit" })]).planned[0].externalKey;
      const e = plan([row({ bookingDate: "2026-03-11" })]).planned[0]
        .externalKey;
      expect(a).toBe(b);
      expect(new Set([a, c, d, e]).size).toBe(4);
    });

    it("numbers identical rows from 0 in the order the provider returned them", () => {
      const coffee = row({ amount: "2.80", counterpartyName: "Example Cafe" });
      const other = row({ amount: "9.99", counterpartyName: "Other Shop" });
      const result = plan([coffee, other, coffee, coffee]);
      const keys = result.planned.map((p) => p.externalKey);
      const coffeeHash = sha256("2026-03-10|2.8|EUR|debit|Example Cafe|");
      const otherHash = sha256("2026-03-10|9.99|EUR|debit|Other Shop|");
      expect(keys).toEqual([
        `hash:${coffeeHash}:0`,
        `hash:${otherHash}:0`,
        `hash:${coffeeHash}:1`,
        `hash:${coffeeHash}:2`,
      ]);
    });

    it("gives two identical coffees on one day the same keys on every fetch", () => {
      const coffee = row({ amount: "2.80", counterpartyName: "Example Cafe" });
      const first = plan([coffee, coffee]).planned.map((p) => p.externalKey);
      // A later fetch has a wider window and more rows before and after them.
      const later = plan([
        row({ bookingDate: "2026-03-09", amount: "1" }),
        coffee,
        coffee,
        row({ bookingDate: "2026-03-11", amount: "1" }),
      ]).planned.map((p) => p.externalKey);
      expect(later.slice(1, 3)).toEqual(first);
    });

    it("counts only the rows that are planned", () => {
      const coffee = row({ amount: "2.80" });
      const result = plan([
        coffee,
        // Same content but pending: never counted.
        { ...coffee, booked: false },
        coffee,
      ]);
      const hash = sha256("2026-03-10|2.8|EUR|debit||");
      expect(result.planned.map((p) => p.externalKey)).toEqual([
        `hash:${hash}:0`,
        `hash:${hash}:1`,
      ]);
    });

    it("keeps a payee containing the separator from reading as the description", () => {
      const a = plan([row({ counterpartyName: "A|B", remittance: ["C"] })])
        .planned[0].externalKey;
      const b = plan([row({ counterpartyName: "A", remittance: ["B|C"] })])
        .planned[0].externalKey;
      expect(a).not.toBe(b);
    });

    it("keeps a backslash in a field from disguising a separator", () => {
      const key = (counterpartyName: string, description: string) =>
        plan([row({ counterpartyName, remittance: [description] })]).planned[0]
          .externalKey;
      expect(key("A\\", "|B")).not.toBe(key("A\\|", "B"));
      expect(key("A\\", "|B")).not.toBe(key("A", "\\|B"));
      expect(key("A\\|B", "C")).not.toBe(key("A", "B\\|C"));
    });

    describe("the 255-character bound", () => {
      it("leaves a key of exactly 255 characters alone", () => {
        const reference = "R".repeat(251);
        const key = plan([row({ entryReference: reference })]).planned[0]
          .externalKey;
        expect(key).toBe(`ref:${reference}`);
        expect(key).toHaveLength(255);
      });

      it("replaces a longer ref: key by its prefix and the SHA-256 of the whole key", () => {
        const reference = "R".repeat(252);
        const key = plan([row({ entryReference: reference })]).planned[0]
          .externalKey;
        expect(key).toBe(`ref:${sha256(`ref:${reference}`)}`);
        expect(key.length).toBeLessThanOrEqual(255);
      });

      it("does the same for an id: key, deterministically and distinctly", () => {
        const long = (suffix: string) => "T".repeat(300) + suffix;
        const keys = [long("a"), long("a"), long("b")].map(
          (transactionId) =>
            plan([row({ transactionId })]).planned[0].externalKey,
        );
        expect(keys[0]).toBe(`id:${sha256(`id:${long("a")}`)}`);
        expect(keys[0]).toBe(keys[1]);
        expect(keys[0]).not.toBe(keys[2]);
        expect(keys[0].length).toBeLessThanOrEqual(255);
      });

      it("never produces a key over 255 characters", () => {
        const result = plan([
          row({ entryReference: "E".repeat(5000) }),
          row({ transactionId: "T".repeat(5000), amount: "2" }),
          row({
            amount: "3",
            counterpartyName: "N".repeat(500),
            remittance: ["D".repeat(5000)],
          }),
        ]);
        for (const planned of result.planned) {
          expect(planned.externalKey.length).toBeLessThanOrEqual(255);
        }
      });
    });
  });

  it("does not modify its input", () => {
    const rows: readonly BankTransaction[] = Object.freeze([
      Object.freeze(
        row({ remittance: Object.freeze(["a", "b"]) as unknown as string[] }),
      ),
      Object.freeze(row({ booked: false })),
    ]);
    expect(() => planBankImport(rows, CTX)).not.toThrow();
  });

  it("returns a zeroed plan for no rows", () => {
    expect(plan([])).toEqual({
      planned: [],
      refused: noRefusals,
      pending: 0,
      beforeCutoff: 0,
    });
  });
});
