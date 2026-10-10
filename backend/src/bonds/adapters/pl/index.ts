import {
  CalendarRegistry,
  registerCalendar,
} from "../../domain/calendar-registry";
import { plCalendar } from "./pl-calendar";

export { plBenchmarks } from "./pl-benchmarks";
export { plCalendar } from "./pl-calendar";

/** The registry plus the Polish calendar, for the caller to pass to the engine. */
export function registerPolishCalendars(
  registry: CalendarRegistry,
): CalendarRegistry {
  return registerCalendar(registry, plCalendar);
}
