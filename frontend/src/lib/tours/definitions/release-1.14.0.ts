import { TOUR_ANCHORS } from '../anchors';
import type { TourDefinition } from '../types';

/** Minor line these tours belong to; matched against the running major.minor. */
export const RELEASE_1_14_MINOR = '1.14';

/**
 * The new security detail page (discussion #964).
 *
 * Short on purpose: the page is a reading surface, not a workflow, so there is
 * nothing to fill in and no form to open. Five content steps name what each
 * region answers, in the order they appear down the page, and the user drives
 * the one navigation themselves.
 *
 * `requiresData` hides the whole tour for a user with no securities. Every step
 * after the first lives on `/securities/<id>`, and no such page exists for them
 * -- the tour would open on a prompt they cannot satisfy. Gating one step would
 * not help: the rest would go with it.
 *
 * The id of a security is the user's to pick, so the second step waits on a
 * route change rather than pointing at a row: the securities list repeats its
 * Details action per row, and no single row is the right one to spotlight.
 */
export const RELEASE_1_14_SECURITY_DETAIL_TOUR: TourDefinition = {
  id: 'release-1.14.0/security-detail',
  area: 'investments',
  version: RELEASE_1_14_MINOR,
  i18nPrefix: 'release.v1_14_0.securityDetail',
  requiresData: 'securitiesExist',
  steps: [
    {
      // Route-agnostic welcome: shows wherever the tour was launched from, so it
      // never fights a closing What's New modal's history.back().
      id: 'welcome',
      anchorId: null,
    },
    {
      // The user picks which security to open, so this waits for any
      // /securities/<id>. Unobtrusive: they have to read the list and choose,
      // and dimming it would hide the very thing they are choosing from.
      id: 'openDetail',
      route: '/securities',
      anchorId: null,
      unobtrusive: true,
      advance: { type: 'route', route: '/securities/' },
    },
    {
      // What you hold and what it is worth, in one row above the chart.
      id: 'summary',
      route: '/securities',
      routeMatch: '/securities/',
      anchorId: TOUR_ANCHORS.securityDetailSummary,
      placement: 'bottom',
      // A security sold down to nothing shows the closed-position panel here
      // instead of the cards, and that is worth a sentence rather than a gap in
      // the step counter.
      fallbackWhenMissing: true,
      // The user drove the navigation, so the page is already rendered: the
      // cards either mounted with it or were replaced. A long wait would sit
      // behind a blank overlay before explaining itself.
      anchorTimeoutMs: 2500,
    },
    {
      // The chart plus its two rows of controls. `allowInteraction` so the user
      // can switch series and ranges while reading about them -- the whole point
      // of the step is that these are worth trying.
      id: 'chart',
      route: '/securities',
      routeMatch: '/securities/',
      anchorId: TOUR_ANCHORS.securityDetailChart,
      placement: 'auto',
      allowInteraction: true,
    },
    {
      // The column beside the chart: what the instrument is, and what it is
      // made of.
      id: 'keyInfo',
      route: '/securities',
      routeMatch: '/securities/',
      anchorId: TOUR_ANCHORS.securityDetailKeyInfo,
      placement: 'left',
      // Narrow screens stack it under the chart, where "beside the chart" makes
      // no sense and the step would need a different sentence.
      skipOnMobile: true,
    },
    {
      // Where the rest of the detail lives: the description, the period returns,
      // the sector and country breakdowns, and the tables the list's modals used
      // to be the only route to.
      id: 'tabs',
      route: '/securities',
      routeMatch: '/securities/',
      anchorId: TOUR_ANCHORS.securityDetailTabs,
      placement: 'bottom',
    },
    {
      id: 'finish',
      anchorId: null,
    },
  ],
};

/**
 * The GEM (Global Equities Momentum) strategy report.
 *
 * Set up first, then read the result. The tour opens the report, goes straight
 * into Settings, offers the add-instruments shortcut and the five role pickers,
 * covers the accounts and the timing/cost fields, invites a save, and only then
 * walks the Overview cards -- which by that point have something in them.
 *
 * The settings steps carry `allowInteraction` so the user can actually fill the
 * form in while reading about it. **None of them advances on a mutation**: every
 * one still moves on with Next, so a user who presses nothing reaches the end.
 * That is the line this tour holds -- actionable, never required.
 *
 * Deliberately **not** gated on `securitiesExist`. A user with no instruments is
 * the primary audience: the report opens for them, the Settings tab renders, and
 * the "Roles and instruments" card is where the tour now sends them first.
 * Gating it would hide the tour from exactly the people it is for.
 *
 * One tour, not a "configured"/"unconfigured" pair. The two states differ only in
 * whether the fill-missing-roles shortcut is on screen, and the `addInstruments`
 * copy covers both -- so the tour needs no branch, and its anchors stay stable
 * either way.
 */
export const RELEASE_1_14_GEM_STRATEGY_TOUR: TourDefinition = {
  id: 'release-1.14.0/gem-strategy',
  area: 'reports',
  version: RELEASE_1_14_MINOR,
  i18nPrefix: 'release.v1_14_0.gemStrategy',
  steps: [
    {
      // Route-agnostic welcome: shows wherever the tour was launched, so it never
      // fights a closing What's New modal's history.back().
      id: 'welcome',
      anchorId: null,
    },
    {
      // The Reports listing remembers its category filter across visits, so the
      // GEM card can easily be filtered out before the tour arrives:
      // `?category=investment` forces the group holding it. `routeMatch` keeps
      // the engine's "am I there yet" check working, since a pathname carries no
      // query. A route advance rather than a click, because clicking the card
      // navigates -- a click advance would race its own navigation.
      id: 'findReport',
      route: '/reports?category=investment',
      routeMatch: '/reports',
      anchorId: TOUR_ANCHORS.reportGemStrategy,
      placement: 'auto',
      advance: { type: 'route', route: '/reports/gem-strategy' },
      // A search box or a hidden category can still filter the card out; name
      // the report in a centered card rather than vanish.
      fallbackWhenMissing: true,
      // Long enough for the engine's navigation to land and the listing to
      // render, short enough that the stand-in does not sit behind a blank
      // screen (the post-navigation default is 10s).
      anchorTimeoutMs: 4000,
    },
    {
      // Orientation before the setup: what a scenario is, and the four questions
      // the page answers once it has data.
      id: 'page',
      route: '/reports/gem-strategy',
      anchorId: TOUR_ANCHORS.gemStrategyHeader,
      placement: 'bottom',
    },
    {
      // A click advance is safe here: Edit settings switches an in-page tab, so
      // there is no navigation for the advance to race.
      id: 'openSettings',
      route: '/reports/gem-strategy',
      anchorId: TOUR_ANCHORS.gemStrategyEditSettings,
      placement: 'auto',
      advance: { type: 'click' },
    },
    {
      // The stable "Roles and instruments" card, not the conditional shortcut
      // box inside it -- see the anchor's own comment. The copy covers both
      // states, so no step is skipped when the roles are already filled.
      //
      // First anchor inside the settings form, which fetches its accounts and
      // securities before rendering, so this is the step that carries the
      // slow-load fallback: it says the form did not arrive rather than leaving a
      // hole in the step counter.
      //
      // `allowInteraction` so the user can actually press the add button while
      // reading about it -- the tour is a setup walkthrough now, and a passive
      // step would cover the control with the spotlight's click blocker. The
      // advance stays the default Next, so pressing it is never *required*.
      id: 'addInstruments',
      route: '/reports/gem-strategy',
      anchorId: TOUR_ANCHORS.gemSettingsAssets,
      placement: 'auto',
      allowInteraction: true,
      fallbackWhenMissing: true,
      anchorTimeoutMs: 8000,
    },
    {
      // Straight after the shortcut, since the five pickers are what it filled in
      // and what a user without the shortcut has to set by hand.
      id: 'roles',
      route: '/reports/gem-strategy',
      anchorId: TOUR_ANCHORS.gemSettingsRoles,
      placement: 'auto',
      allowInteraction: true,
    },
    {
      id: 'accounts',
      route: '/reports/gem-strategy',
      anchorId: TOUR_ANCHORS.gemSettingsAccounts,
      placement: 'auto',
      allowInteraction: true,
    },
    {
      id: 'timingAndCosts',
      route: '/reports/gem-strategy',
      anchorId: TOUR_ANCHORS.gemSettingsTimingAndCosts,
      placement: 'auto',
      allowInteraction: true,
    },
    {
      // Interactive but not required: saving here is what gives the report steps
      // something to show, and the copy says the tour finishes either way. The
      // advance is still the default Next, never the save itself.
      id: 'save',
      route: '/reports/gem-strategy',
      anchorId: TOUR_ANCHORS.gemSettingsSave,
      placement: 'top',
      allowInteraction: true,
    },
    {
      // The tab bar doubles as the way back to Overview: the engine cannot switch
      // an in-page tab itself, and every step after this one needs the Overview
      // panel mounted. Advancing on the overview grid appearing is what
      // guarantees that, rather than hoping the user picked the right tab.
      id: 'tabs',
      route: '/reports/gem-strategy',
      anchorId: TOUR_ANCHORS.gemStrategyTabs,
      placement: 'bottom',
      advance: { type: 'appear', anchorId: TOUR_ANCHORS.gemStrategyOverviewCards },
    },
    {
      id: 'summary',
      route: '/reports/gem-strategy',
      anchorId: TOUR_ANCHORS.gemStrategyOverviewCards,
      placement: 'auto',
    },
    {
      id: 'action',
      route: '/reports/gem-strategy',
      anchorId: TOUR_ANCHORS.gemStrategyChartAndAction,
      placement: 'auto',
    },
    {
      id: 'reasoning',
      route: '/reports/gem-strategy',
      anchorId: TOUR_ANCHORS.gemStrategyReasoning,
      placement: 'auto',
    },
    {
      // Route-agnostic, and no tab change: the user is already on Overview, and
      // an automatic switch could trip the unsaved-changes guard if they left an
      // edit behind.
      id: 'finish',
      anchorId: null,
    },
  ],
};

export const RELEASE_1_14_TOURS: readonly TourDefinition[] = [
  RELEASE_1_14_SECURITY_DETAIL_TOUR,
  RELEASE_1_14_GEM_STRATEGY_TOUR,
];
