import {
  AUTO_DISABLE_REPROBE_INTERVAL_MS,
  PRICE_FETCH_ABSENT_THRESHOLD,
  PriceFetchStateInput,
  ProviderConfigInput,
  canFetchActive,
  computeFetchOutcomeUpdate,
  isProviderConfigured,
  isReprobeDue,
  shouldAttemptFetch,
} from "./price-fetch-status";

const NOW = new Date("2026-09-02T12:00:00Z");

function state(
  over: Partial<PriceFetchStateInput & ProviderConfigInput> = {},
): PriceFetchStateInput & ProviderConfigInput {
  return {
    priceFetchStatus: "active",
    priceFetchFailureCount: 0,
    priceFetchLastFailureAt: null,
    priceFetchAutoDisabledAt: null,
    skipPriceUpdates: false,
    quoteProvider: null,
    msnInstrumentId: null,
    ...over,
  };
}

describe("isProviderConfigured", () => {
  it("is true for an ordinary security", () => {
    expect(isProviderConfigured(state())).toBe(true);
  });

  it("is false for a skipPriceUpdates symbol with no override", () => {
    expect(isProviderConfigured(state({ skipPriceUpdates: true }))).toBe(false);
  });

  it("is true when a skipPriceUpdates symbol has a provider override", () => {
    expect(
      isProviderConfigured(
        state({ skipPriceUpdates: true, quoteProvider: "msn" }),
      ),
    ).toBe(true);
  });

  it("is true when a skipPriceUpdates symbol has an MSN instrument id", () => {
    expect(
      isProviderConfigured(
        state({ skipPriceUpdates: true, msnInstrumentId: "a1u3p2" }),
      ),
    ).toBe(true);
  });
});

describe("canFetchActive", () => {
  it("is true for an active, provider-configured security", () => {
    expect(canFetchActive(state())).toBe(true);
  });

  it("is false when disabled", () => {
    expect(canFetchActive(state({ priceFetchStatus: "disabled" }))).toBe(false);
  });

  it("is false when auto_disabled (that path goes through re-probe, not this)", () => {
    expect(canFetchActive(state({ priceFetchStatus: "auto_disabled" }))).toBe(
      false,
    );
  });

  it("is false for an active but unconfigured symbol", () => {
    expect(canFetchActive(state({ skipPriceUpdates: true }))).toBe(false);
  });
});

describe("isReprobeDue", () => {
  it("is false for active/disabled statuses", () => {
    expect(isReprobeDue(state({ priceFetchStatus: "active" }), NOW)).toBe(
      false,
    );
    expect(isReprobeDue(state({ priceFetchStatus: "disabled" }), NOW)).toBe(
      false,
    );
  });

  it("is due immediately when auto_disabled has never stamped a failure", () => {
    expect(
      isReprobeDue(
        state({
          priceFetchStatus: "auto_disabled",
          priceFetchLastFailureAt: null,
        }),
        NOW,
      ),
    ).toBe(true);
  });

  it("is not due before the cooldown elapses", () => {
    const last = new Date(
      NOW.getTime() - (AUTO_DISABLE_REPROBE_INTERVAL_MS - 1000),
    );
    expect(
      isReprobeDue(
        state({
          priceFetchStatus: "auto_disabled",
          priceFetchLastFailureAt: last,
        }),
        NOW,
      ),
    ).toBe(false);
  });

  it("is due once the cooldown elapses", () => {
    const last = new Date(NOW.getTime() - AUTO_DISABLE_REPROBE_INTERVAL_MS);
    expect(
      isReprobeDue(
        state({
          priceFetchStatus: "auto_disabled",
          priceFetchLastFailureAt: last,
        }),
        NOW,
      ),
    ).toBe(true);
  });

  it("is never due for an unconfigured symbol even when the clock says so", () => {
    expect(
      isReprobeDue(
        state({
          priceFetchStatus: "auto_disabled",
          priceFetchLastFailureAt: null,
          skipPriceUpdates: true,
        }),
        NOW,
      ),
    ).toBe(false);
  });
});

describe("shouldAttemptFetch", () => {
  it("fetches an active security", () => {
    expect(shouldAttemptFetch(state(), NOW)).toBe(true);
  });

  it("never fetches a disabled security", () => {
    expect(
      shouldAttemptFetch(state({ priceFetchStatus: "disabled" }), NOW),
    ).toBe(false);
  });

  it("fetches an auto_disabled security only when its re-probe is due", () => {
    const notDue = new Date(NOW.getTime() - 1000);
    const due = new Date(NOW.getTime() - AUTO_DISABLE_REPROBE_INTERVAL_MS);
    expect(
      shouldAttemptFetch(
        state({
          priceFetchStatus: "auto_disabled",
          priceFetchLastFailureAt: notDue,
        }),
        NOW,
      ),
    ).toBe(false);
    expect(
      shouldAttemptFetch(
        state({
          priceFetchStatus: "auto_disabled",
          priceFetchLastFailureAt: due,
        }),
        NOW,
      ),
    ).toBe(true);
  });
});

describe("computeFetchOutcomeUpdate", () => {
  it("does nothing for a disabled security", () => {
    expect(
      computeFetchOutcomeUpdate(
        state({ priceFetchStatus: "disabled" }),
        "absent",
        NOW,
      ),
    ).toBeNull();
  });

  it("is a no-op on success for an already-clean active security", () => {
    expect(computeFetchOutcomeUpdate(state(), "success", NOW)).toBeNull();
  });

  it("resets the streak on success after some failures", () => {
    expect(
      computeFetchOutcomeUpdate(
        state({ priceFetchFailureCount: 3, priceFetchLastFailureAt: NOW }),
        "success",
        NOW,
      ),
    ).toEqual({
      priceFetchStatus: "active",
      priceFetchFailureCount: 0,
      priceFetchLastFailureAt: null,
      priceFetchAutoDisabledAt: null,
    });
  });

  it("re-enables an auto_disabled security whose re-probe succeeds", () => {
    expect(
      computeFetchOutcomeUpdate(
        state({
          priceFetchStatus: "auto_disabled",
          priceFetchFailureCount: PRICE_FETCH_ABSENT_THRESHOLD,
          priceFetchLastFailureAt: NOW,
          priceFetchAutoDisabledAt: NOW,
        }),
        "success",
        NOW,
      ),
    ).toEqual({
      priceFetchStatus: "active",
      priceFetchFailureCount: 0,
      priceFetchLastFailureAt: null,
      priceFetchAutoDisabledAt: null,
    });
  });

  it("bumps the streak on an absent answer below the threshold", () => {
    expect(
      computeFetchOutcomeUpdate(
        state({ priceFetchFailureCount: 2 }),
        "absent",
        NOW,
      ),
    ).toEqual({
      priceFetchFailureCount: 3,
      priceFetchLastFailureAt: NOW,
    });
  });

  it("auto-disables an active security exactly at the threshold", () => {
    expect(
      computeFetchOutcomeUpdate(
        state({ priceFetchFailureCount: PRICE_FETCH_ABSENT_THRESHOLD - 1 }),
        "absent",
        NOW,
      ),
    ).toEqual({
      priceFetchFailureCount: PRICE_FETCH_ABSENT_THRESHOLD,
      priceFetchLastFailureAt: NOW,
      priceFetchStatus: "auto_disabled",
      priceFetchAutoDisabledAt: NOW,
    });
  });

  it("does not auto-disable one absent answer short of the threshold", () => {
    const update = computeFetchOutcomeUpdate(
      state({ priceFetchFailureCount: PRICE_FETCH_ABSENT_THRESHOLD - 2 }),
      "absent",
      NOW,
    );
    expect(update).not.toHaveProperty("priceFetchStatus");
  });

  it("on an absent re-probe of an auto_disabled security, only resets the clock", () => {
    const later = new Date(NOW.getTime() + 1000);
    expect(
      computeFetchOutcomeUpdate(
        state({
          priceFetchStatus: "auto_disabled",
          priceFetchFailureCount: PRICE_FETCH_ABSENT_THRESHOLD,
          priceFetchLastFailureAt: NOW,
          priceFetchAutoDisabledAt: NOW,
        }),
        "absent",
        later,
      ),
    ).toEqual({
      priceFetchFailureCount: PRICE_FETCH_ABSENT_THRESHOLD + 1,
      priceFetchLastFailureAt: later,
    });
  });
});
