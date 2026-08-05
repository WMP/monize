import { PartialSum } from "./partial-sum";

describe("PartialSum", () => {
  it("reports the total when every component is known", () => {
    const s = new PartialSum();
    s.add(100);
    s.add(35.5);
    expect(s.total).toBe(135.5);
    expect(s.isComplete).toBe(true);
    expect(s.unknownComponents).toBe(0);
  });

  it("is an empty, complete, zero total before anything is added", () => {
    // An account with no holdings holds zero -- a known, settled answer. It
    // must not read as "could not be computed".
    const s = new PartialSum();
    expect(s.total).toBe(0);
    expect(s.isComplete).toBe(true);
  });

  it("treats a known zero as a value, not as missing data", () => {
    const s = new PartialSum();
    s.add(0);
    s.add(0);
    expect(s.total).toBe(0);
    expect(s.isComplete).toBe(true);
  });

  it("poisons the total when one component is null", () => {
    const s = new PartialSum();
    s.add(100);
    s.add(null);
    s.add(35);
    expect(s.total).toBeNull();
    expect(s.isComplete).toBe(false);
    expect(s.unknownComponents).toBe(1);
  });

  it("keeps the known components reachable only as a named subtotal", () => {
    const s = new PartialSum();
    s.add(100);
    s.add(null);
    s.add(35);
    expect(s.knownSubtotal).toBe(135);
    // and the total still refuses to speak for them
    expect(s.total).toBeNull();
  });

  it("treats undefined like null", () => {
    const s = new PartialSum();
    s.add(10);
    s.add(undefined);
    expect(s.total).toBeNull();
  });

  it("treats NaN as unknown rather than propagating it into the sum", () => {
    // A NaN arriving from `Number(undefined)` or a division by zero would
    // otherwise turn the total into NaN, which renders as a broken number
    // instead of an honest "unknown".
    const s = new PartialSum();
    s.add(10);
    s.add(NaN);
    expect(s.total).toBeNull();
    expect(s.knownSubtotal).toBe(10);
  });

  it("can be marked incomplete without a component", () => {
    const s = new PartialSum();
    s.add(10);
    s.markIncomplete();
    expect(s.total).toBeNull();
    expect(s.knownSubtotal).toBe(10);
  });

  it("counts every unknown component", () => {
    const s = new PartialSum();
    s.add(null);
    s.add(null);
    s.markIncomplete();
    expect(s.unknownComponents).toBe(3);
  });
});
