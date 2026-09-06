import { MovementInputs, decideMovement } from "./portfolio-movement.util";

const base = (over: Partial<MovementInputs>): MovementInputs => ({
  mvComplete: true,
  mvToday: 100_000,
  currency: "USD",
  baseline: { value: 100_000, currency: "USD" },
  flow: { complete: true, value: 0 },
  movePercent: 5,
  ...over,
});

describe("decideMovement", () => {
  it("withholds and does not rebaseline when today's value is incomplete", () => {
    // INV-PORTMOVE-001/002: a subtotal is unknown, never 0%, and never a baseline.
    const d = decideMovement(base({ mvComplete: false, mvToday: 110_000 }));
    expect(d).toEqual({ fire: null, rebaselineTo: null });
  });

  it("withholds and does not rebaseline when the flow is incomplete", () => {
    const d = decideMovement(
      base({ mvToday: 108_000, flow: { complete: false, value: 0 } }),
    );
    expect(d).toEqual({ fire: null, rebaselineTo: null });
  });

  it("does nothing when the alert is off (no threshold)", () => {
    expect(decideMovement(base({ movePercent: null }))).toEqual({
      fire: null,
      rebaselineTo: null,
    });
    expect(decideMovement(base({ movePercent: 0 }))).toEqual({
      fire: null,
      rebaselineTo: null,
    });
  });

  it("captures a first baseline without firing", () => {
    const d = decideMovement(base({ baseline: null, mvToday: 100_000 }));
    expect(d).toEqual({ fire: null, rebaselineTo: 100_000 });
  });

  it("re-baselines on a reporting-currency change, never comparing across currencies", () => {
    const d = decideMovement(
      base({ currency: "EUR", baseline: { value: 90_000, currency: "USD" } }),
    );
    expect(d).toEqual({ fire: null, rebaselineTo: 100_000 });
  });

  it("re-baselines without firing when the baseline value is 0", () => {
    const d = decideMovement(
      base({ baseline: { value: 0, currency: "USD" }, mvToday: 5_000 }),
    );
    expect(d).toEqual({ fire: null, rebaselineTo: 5_000 });
  });

  it("does NOT fire when a deposit lifts the value (net of external flow)", () => {
    // A 12,000 deposit with no market move: movement = 113,000 - 101,000 - 12,000 = 0.
    const d = decideMovement(
      base({
        mvToday: 113_000,
        baseline: { value: 101_000, currency: "USD" },
        flow: { complete: true, value: 12_000 },
      }),
    );
    expect(d.fire).toBeNull();
    expect(d.rebaselineTo).toBe(113_000);
  });

  it("treats a dividend as return, not a loss (internal, zero external flow)", () => {
    // Ex-dividend day: the price drop is offset by the dividend cash inside the
    // value, and the dividend is not an external flow -> ~0 movement, never a loss.
    const d = decideMovement(
      base({
        mvToday: 100_000,
        baseline: { value: 100_000, currency: "USD" },
        flow: { complete: true, value: 0 },
      }),
    );
    expect(d.fire).toBeNull();
  });

  it("fires down on a market loss beyond the threshold", () => {
    const d = decideMovement(
      base({ mvToday: 92_000, baseline: { value: 100_000, currency: "USD" } }),
    );
    expect(d.fire).toEqual({
      changePercent: -8,
      direction: "down",
      movementValue: -8_000,
    });
    expect(d.rebaselineTo).toBe(92_000);
  });

  it("fires up on a market gain beyond the threshold", () => {
    const d = decideMovement(
      base({ mvToday: 106_000, baseline: { value: 100_000, currency: "USD" } }),
    );
    expect(d.fire).toEqual({
      changePercent: 6,
      direction: "up",
      movementValue: 6_000,
    });
  });

  it("stays silent below the threshold but still rebaselines", () => {
    const d = decideMovement(
      base({ mvToday: 103_000, baseline: { value: 100_000, currency: "USD" } }),
    );
    expect(d.fire).toBeNull();
    expect(d.rebaselineTo).toBe(103_000);
  });

  it("compares at full precision and rounds the reported percent to 2dp", () => {
    // 100,000 -> 105,005 is +5.005%, above 5%; reported rounded to 5.01 (well,
    // 5.005 rounds to 5.01 at 2dp via round-half-up on the scaled integer).
    const d = decideMovement(
      base({ mvToday: 105_005, baseline: { value: 100_000, currency: "USD" } }),
    );
    expect(d.fire?.changePercent).toBe(5.01);
    // A value that is 4.999% is below 5% and does not fire.
    const below = decideMovement(
      base({ mvToday: 104_999, baseline: { value: 100_000, currency: "USD" } }),
    );
    expect(below.fire).toBeNull();
  });

  it("removes an external withdrawal from the movement too", () => {
    // A 5,000 withdrawal (negative external flow) with no market move:
    // movement = 95,000 - 100,000 - (-5,000) = 0.
    const d = decideMovement(
      base({
        mvToday: 95_000,
        baseline: { value: 100_000, currency: "USD" },
        flow: { complete: true, value: -5_000 },
      }),
    );
    expect(d.fire).toBeNull();
  });
});
