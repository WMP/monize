import { POLISH_BOND_ADAPTER } from "./adapters/pl";
import { BondAdapter } from "./bond-adapter";
import {
  CalendarRegistry,
  EMPTY_CALENDAR_REGISTRY,
} from "./domain/calendar-registry";

/**
 * Every installed country adapter, the one place adapters are wired. Adding a
 * country is one more entry here; the domain and the engine never learn of it.
 */
export const INSTALLED_BOND_ADAPTERS: readonly BondAdapter[] = [
  POLISH_BOND_ADAPTER,
];

export const BOND_CALENDARS: CalendarRegistry = INSTALLED_BOND_ADAPTERS.reduce(
  (registry, adapter) => adapter.registerCalendars(registry),
  EMPTY_CALENDAR_REGISTRY,
);
