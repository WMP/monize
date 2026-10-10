import { EMPTY_CALENDAR_REGISTRY } from "../../domain/calendar-registry";
import { plBenchmarks, plCalendar, registerPolishCalendars } from ".";

describe("Polish adapter", () => {
  it("registers the calendar under its id", () => {
    const registry = registerPolishCalendars(EMPTY_CALENDAR_REGISTRY);
    expect(registry.get("PL")).toBe(plCalendar);
    expect(EMPTY_CALENDAR_REGISTRY.size).toBe(0);
  });

  it("defines the two benchmark series with their publishers", () => {
    expect(plBenchmarks).toEqual([
      { id: "PL_NBP_REFERENCE", kind: "STEP", publisher: "NBP" },
      { id: "PL_CPI_GUS_YOY", kind: "MONTHLY", publisher: "GUS" },
    ]);
  });
});
