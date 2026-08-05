import { FxAggregate } from "./fx-aggregate";

/**
 * The numerical examples in docs/specs/fx-conversion-completeness.md section 4,
 * plus the distinctions that section calls out as the point of the type.
 */
describe("FxAggregate", () => {
  it("is complete and zero before anything is added", () => {
    // Nothing to convert is a known answer, not an unknown one: an empty
    // account holds zero, and reporting that as unavailable tells the user a
    // settled question could not be worked out.
    const agg = new FxAggregate();
    expect(agg.total).toBe(0);
    expect(agg.knownSubtotal).toBe(0);
    expect(agg.isComplete).toBe(true);
    expect(agg.missingPairs).toEqual([]);
  });

  it("sums converted components", () => {
    const agg = new FxAggregate();
    agg.add(900, "USD", "EUR");
    agg.add(500, "EUR", "EUR");
    expect(agg.total).toBe(1400);
    expect(agg.knownSubtotal).toBe(1400);
    expect(agg.isComplete).toBe(true);
  });

  it("makes the total unknown when a component could not convert", () => {
    const agg = new FxAggregate();
    agg.add(500, "EUR", "EUR");
    agg.add(null, "USD", "EUR");
    expect(agg.total).toBeNull();
    // The part that did convert is still available, under its own name.
    expect(agg.knownSubtotal).toBe(500);
    expect(agg.missingPairs).toEqual(["USD->EUR"]);
    expect(agg.isComplete).toBe(false);
  });

  it("distinguishes 'nothing to convert' from 'could not convert'", () => {
    // Both have a knownSubtotal of 0. Only missingPairs tells them apart, which
    // is why it is not optional -- this is the exact confusion that made a
    // missing rate indistinguishable from a real 1:1.
    const empty = new FxAggregate();
    const failed = new FxAggregate();
    failed.add(null, "USD", "EUR");

    expect(empty.knownSubtotal).toBe(failed.knownSubtotal);
    expect(empty.total).toBe(0);
    expect(failed.total).toBeNull();
    expect(empty.missingPairs).toEqual([]);
    expect(failed.missingPairs).toEqual(["USD->EUR"]);
  });

  it("records each missing pair once and sorts them", () => {
    const agg = new FxAggregate();
    agg.add(null, "USD", "EUR");
    agg.add(null, "USD", "EUR");
    agg.add(null, "GBP", "EUR");
    expect(agg.missingPairs).toEqual(["GBP->EUR", "USD->EUR"]);
  });

  it("keeps the total unknown when only one of three currencies is missing", () => {
    const agg = new FxAggregate();
    agg.add(1000, "EUR", "EUR");
    agg.add(900, "USD", "EUR");
    agg.add(null, "JPY", "EUR");
    expect(agg.total).toBeNull();
    expect(agg.knownSubtotal).toBe(1900);
    expect(agg.missingPairs).toEqual(["JPY->EUR"]);
  });

  it("handles a negative (liability) component that cannot convert", () => {
    const agg = new FxAggregate();
    agg.add(-500, "EUR", "EUR");
    agg.add(null, "USD", "EUR");
    expect(agg.total).toBeNull();
    expect(agg.knownSubtotal).toBe(-500);
  });

  it("addConverted takes a value that needed no conversion", () => {
    const agg = new FxAggregate();
    agg.addConverted(250);
    expect(agg.total).toBe(250);
    expect(agg.isComplete).toBe(true);
  });

  it("addConverted cannot mask a gap recorded elsewhere", () => {
    const agg = new FxAggregate();
    agg.add(null, "USD", "EUR");
    agg.addConverted(250);
    expect(agg.total).toBeNull();
    expect(agg.knownSubtotal).toBe(250);
  });

  it("merge carries the other aggregate's gaps with its subtotal", () => {
    const a = new FxAggregate();
    a.addConverted(100);
    const b = new FxAggregate();
    b.addConverted(50);
    b.add(null, "JPY", "EUR");

    a.merge(b);
    expect(a.knownSubtotal).toBe(150);
    expect(a.total).toBeNull();
    expect(a.missingPairs).toEqual(["JPY->EUR"]);
  });

  it("a zero-valued component that converted keeps the total known", () => {
    const agg = new FxAggregate();
    agg.add(0, "USD", "EUR");
    expect(agg.total).toBe(0);
    expect(agg.isComplete).toBe(true);
  });
});
