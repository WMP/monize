import { positionCloseAsOf, PricePoint } from "./position-price.util";

/**
 * The as-of merge for issue #1242. The invariant under test: the accepted price
 * store (security_prices) is authoritative for valuation regardless of a
 * security's skipPriceUpdates flag, a transaction-derived fallback answers only
 * when the store cannot, and no observation after the sample date is ever used.
 */
describe("positionCloseAsOf", () => {
  const stored: PricePoint[] = [
    { date: "2024-06-01", close: 61 },
    { date: "2026-07-31", close: 100 },
    { date: "2026-08-20", close: 120 },
  ];

  it("uses the latest accepted stored close on or before the date", () => {
    expect(positionCloseAsOf(stored, undefined, "2026-08-20")).toBe(120);
    expect(positionCloseAsOf(stored, undefined, "2026-08-25")).toBe(120);
  });

  it("does not leak a future observation backward", () => {
    // 2026-08-01 sits between the 2026-07-31 ($100) and 2026-08-20 ($120) rows.
    expect(positionCloseAsOf(stored, undefined, "2026-08-01")).toBe(100);
    // Before the first observation there is nothing to carry forward.
    expect(positionCloseAsOf(stored, undefined, "2024-01-01")).toBeNull();
  });

  it("prefers the accepted store over a transaction-derived fallback", () => {
    // Same-day: the store holds a manual $120 correction while the transaction
    // implied $61. The store wins; the fallback is never consulted.
    const tx: PricePoint[] = [{ date: "2026-08-20", close: 61 }];
    expect(positionCloseAsOf(stored, tx, "2026-08-20")).toBe(120);
  });

  it("falls back to transaction prices only when the store is empty", () => {
    const tx: PricePoint[] = [
      { date: "2024-01-10", close: 50 },
      { date: "2024-03-10", close: 55 },
    ];
    expect(positionCloseAsOf(undefined, tx, "2024-02-01")).toBe(50);
    expect(positionCloseAsOf([], tx, "2024-05-01")).toBe(55);
    // The fallback also respects the as-of boundary.
    expect(positionCloseAsOf(undefined, tx, "2023-12-31")).toBeNull();
  });

  it("returns null when neither source can answer", () => {
    expect(positionCloseAsOf(undefined, undefined, "2026-01-01")).toBeNull();
    expect(positionCloseAsOf([], [], "2026-01-01")).toBeNull();
  });
});
