import {
  buildGemSignalNotification,
  detectSignalChange,
} from "./gem-signal-change-alert.service";
import {
  GemAssetRef,
  GemHistoryEntryView,
  GemStrategyReportView,
} from "./gem-report.types";
import {
  NotificationSeverity,
  NotificationType,
} from "../notification-center/entities/notification.entity";

/** A target asset ref, identified by security (or a securityless role). */
function winner(
  role: string,
  securityId: string | null,
  symbol: string | null = null,
): GemAssetRef {
  return { role, securityId, symbol, name: symbol } as GemAssetRef;
}

/** A minimal history period -- only the fields the detector reads. */
function period(
  evaluatedOn: string,
  state: "RISK_ON" | "RISK_OFF",
  win: GemAssetRef | null,
): GemHistoryEntryView {
  return {
    id: `sig-${evaluatedOn}`,
    evaluatedOn,
    effectiveFrom: evaluatedOn,
    winner: win,
    state,
    action: "HOLD",
    momentum: {},
    change: null,
    executed: null,
  } as unknown as GemHistoryEntryView;
}

/** A report carrying only the history the detector reads. */
function reportWith(history: GemHistoryEntryView[]): GemStrategyReportView {
  return { history } as unknown as GemStrategyReportView;
}

const US = winner("US_EQUITY", "sec-us", "VTI");
const INTL = winner("INTL_EQUITY", "sec-intl", "VXUS");
const SAFE = winner("SAFE", "sec-safe", "BND");

describe("detectSignalChange", () => {
  it("reports a RISK_ON -> RISK_OFF move as a risk change", () => {
    const change = detectSignalChange(
      reportWith([
        period("2026-09-01", "RISK_OFF", SAFE),
        period("2026-08-01", "RISK_ON", US),
      ]),
    );
    expect(change).not.toBeNull();
    expect(change!.kind).toBe("risk");
    expect(change!.current.evaluatedOn).toBe("2026-09-01");
    expect(change!.previous.evaluatedOn).toBe("2026-08-01");
  });

  it("reports a same-state target change as an allocation change", () => {
    const change = detectSignalChange(
      reportWith([
        period("2026-09-01", "RISK_ON", INTL),
        period("2026-08-01", "RISK_ON", US),
      ]),
    );
    expect(change!.kind).toBe("allocation");
  });

  it("prefers the risk kind when both state and target moved", () => {
    // RISK_ON(US) -> RISK_OFF(SAFE) is both a state and a target change; the
    // louder risk event wins so an allocation row is not also raised.
    const change = detectSignalChange(
      reportWith([
        period("2026-09-01", "RISK_OFF", SAFE),
        period("2026-08-01", "RISK_ON", US),
      ]),
    );
    expect(change!.kind).toBe("risk");
  });

  it("is silent when nothing changed", () => {
    expect(
      detectSignalChange(
        reportWith([
          period("2026-09-01", "RISK_ON", US),
          period("2026-08-01", "RISK_ON", US),
        ]),
      ),
    ).toBeNull();
  });

  it("is a no-op with fewer than two evaluable periods", () => {
    expect(detectSignalChange(reportWith([]))).toBeNull();
    expect(
      detectSignalChange(reportWith([period("2026-09-01", "RISK_ON", US)])),
    ).toBeNull();
  });

  it("takes the two latest periods regardless of history order", () => {
    // Ascending order in the array must not change which two are compared.
    const change = detectSignalChange(
      reportWith([
        period("2026-07-01", "RISK_ON", US),
        period("2026-09-01", "RISK_OFF", SAFE),
        period("2026-08-01", "RISK_ON", US),
      ]),
    );
    expect(change!.current.evaluatedOn).toBe("2026-09-01");
    expect(change!.previous.evaluatedOn).toBe("2026-08-01");
    expect(change!.kind).toBe("risk");
  });

  it("treats a securityless role change as a change, and same role as none", () => {
    const roleOnlyA = winner("US_EQUITY", null);
    const roleOnlyB = winner("INTL_EQUITY", null);
    expect(
      detectSignalChange(
        reportWith([
          period("2026-09-01", "RISK_ON", roleOnlyB),
          period("2026-08-01", "RISK_ON", roleOnlyA),
        ]),
      )!.kind,
    ).toBe("allocation");
    expect(
      detectSignalChange(
        reportWith([
          period("2026-09-01", "RISK_ON", roleOnlyA),
          period("2026-08-01", "RISK_ON", roleOnlyA),
        ]),
      ),
    ).toBeNull();
  });
});

describe("buildGemSignalNotification", () => {
  const ref = { id: "strat-1", name: "My GEM" };

  it("maps a risk change to a WARNING with a period+kind dedupe key", () => {
    const change = detectSignalChange(
      reportWith([
        period("2026-09-01", "RISK_OFF", SAFE),
        period("2026-08-01", "RISK_ON", US),
      ]),
    )!;
    const input = buildGemSignalNotification(ref, change);
    expect(input.type).toBe(NotificationType.GEM_SIGNAL_CHANGED);
    expect(input.severity).toBe(NotificationSeverity.WARNING);
    expect(input.target).toBe("/reports/gem-strategy");
    expect(input.dedupeKey).toBe("gem:strat-1:2026-09-01:risk");
    expect(input.data).toMatchObject({
      strategyId: "strat-1",
      kind: "risk",
      fromState: "RISK_ON",
      toState: "RISK_OFF",
      targetSecurityId: "sec-safe",
      evaluatedOn: "2026-09-01",
    });
  });

  it("maps an allocation change to INFO with an allocation dedupe key", () => {
    const change = detectSignalChange(
      reportWith([
        period("2026-09-01", "RISK_ON", INTL),
        period("2026-08-01", "RISK_ON", US),
      ]),
    )!;
    const input = buildGemSignalNotification(ref, change);
    expect(input.severity).toBe(NotificationSeverity.INFO);
    expect(input.dedupeKey).toBe("gem:strat-1:2026-09-01:allocation");
    expect(input.data).toMatchObject({ kind: "allocation", toSymbol: "VXUS" });
  });

  it("carries no amount or price on the wire, only ids and role/symbol facts", () => {
    const change = detectSignalChange(
      reportWith([
        period("2026-09-01", "RISK_OFF", SAFE),
        period("2026-08-01", "RISK_ON", US),
      ]),
    )!;
    const input = buildGemSignalNotification(ref, change);
    const serialized = JSON.stringify(input.data);
    expect(serialized).not.toMatch(/price|amount|value|balance/i);
  });
});
