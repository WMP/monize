import type { TourArea, TourDefinition } from './types';

/**
 * Display order for the tour catalog's area groups: the introduction first,
 * then the app's areas roughly in the order the header lists them.
 *
 * Typed as a `Record` over `TourArea` on purpose. A new area added to the union
 * fails type-check here rather than silently sorting last, which is the kind of
 * rule the compiler can hold and a comment cannot.
 */
export const TOUR_AREA_RANK: Record<TourArea, number> = {
  intro: 0,
  accounts: 1,
  transactions: 2,
  budgets: 3,
  investments: 4,
  reports: 5,
  settings: 6,
};

/** Areas in catalog order, derived from the ranks so the two cannot drift. */
export const TOUR_AREA_ORDER: readonly TourArea[] = (
  Object.keys(TOUR_AREA_RANK) as TourArea[]
).sort((a, b) => TOUR_AREA_RANK[a] - TOUR_AREA_RANK[b]);

/**
 * i18n key (within the `tours` namespace) for a tour's *name*.
 *
 * The introduction tour has two strings: `intro.basics.title` names it
 * ("Introduction to Monize") and `offer.introTitle` pitches it ("New here?
 * Take the introduction tour"). A catalog listing every tour wants the name;
 * `TourOfferList` in the What's New modal wants the pitch and deliberately
 * keeps using `offer.introTitle`.
 */
export function tourTitleKey(tour: TourDefinition): string {
  return `${tour.i18nPrefix}.title`;
}

export interface TourAreaGroup {
  area: TourArea;
  tours: readonly TourDefinition[];
}

/**
 * Group tours by area for display, areas in `TOUR_AREA_ORDER` and tours in
 * registry order within each. Areas with no tours are omitted; every tour
 * passed in comes back out exactly once.
 */
export function groupToursByArea(
  tours: readonly TourDefinition[],
): readonly TourAreaGroup[] {
  return TOUR_AREA_ORDER.map((area) => ({
    area,
    tours: tours.filter((tour) => tour.area === area),
  })).filter((group) => group.tours.length > 0);
}

/**
 * How many steps the catalog reports for a tour.
 *
 * This is the authored count. `startTour` drops `skipOnMobile` steps at launch
 * time, so a narrow viewport may see fewer; the catalog does not know the
 * viewport it will be read on and does not pretend to.
 */
export function tourStepCount(tour: TourDefinition): number {
  return tour.steps.length;
}
