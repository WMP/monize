import {
  CalendarRegistry,
  EMPTY_CALENDAR_REGISTRY,
} from "./domain/calendar-registry";
import { registerPolishCalendars } from "./adapters/pl";

/**
 * Every installed country adapter's calendars, the one place adapters are wired.
 * Adding a country is one more `register...Calendars` call here; the domain and
 * the engine never learn of it.
 */
export const BOND_CALENDARS: CalendarRegistry = [
  registerPolishCalendars,
].reduce((registry, register) => register(registry), EMPTY_CALENDAR_REGISTRY);
