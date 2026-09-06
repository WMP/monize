import { foldExternalFlow } from "./portfolio-flow.util";

describe("foldExternalFlow", () => {
  const rateFor = (rates: Record<string, number | null>) => (c: string) =>
    c in rates ? rates[c] : null;

  it("sums a single reporting-currency flow with no conversion", () => {
    const folded = foldExternalFlow(
      [{ currency: "USD", amount: 12_000 }],
      "USD",
      rateFor({}),
    );
    expect(folded).toEqual({ complete: true, value: 12_000, missingPairs: [] });
  });

  it("converts a foreign flow through the rate", () => {
    const folded = foldExternalFlow(
      [
        { currency: "USD", amount: 1_000 },
        { currency: "EUR", amount: 500 },
      ],
      "USD",
      rateFor({ EUR: 1.1 }),
    );
    expect(folded.complete).toBe(true);
    expect(folded.value).toBe(1_550); // 1000 + 500*1.1
  });

  it("marks the flow incomplete when a currency has no rate", () => {
    const folded = foldExternalFlow(
      [
        { currency: "USD", amount: 1_000 },
        { currency: "JPY", amount: 100_000 },
      ],
      "USD",
      rateFor({ JPY: null }),
    );
    expect(folded.complete).toBe(false);
    expect(folded.missingPairs).toEqual(["JPY->USD"]);
  });

  it("treats a zero or negative rate as missing, never as applicable", () => {
    const folded = foldExternalFlow(
      [{ currency: "EUR", amount: 500 }],
      "USD",
      rateFor({ EUR: 0 }),
    );
    expect(folded.complete).toBe(false);
    expect(folded.missingPairs).toEqual(["EUR->USD"]);
  });

  it("skips a zero subtotal without needing a rate", () => {
    const folded = foldExternalFlow(
      [{ currency: "GBP", amount: 0 }],
      "USD",
      rateFor({}),
    );
    expect(folded).toEqual({ complete: true, value: 0, missingPairs: [] });
  });

  it("keeps a withdrawal's sign", () => {
    const folded = foldExternalFlow(
      [{ currency: "USD", amount: -5_000 }],
      "USD",
      rateFor({}),
    );
    expect(folded.value).toBe(-5_000);
  });
});
