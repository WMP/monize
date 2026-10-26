import { TOUR_ANCHORS } from '../anchors';
import type { TourDefinition } from '../types';

/** Minor line these tours belong to; matched against the running major.minor. */
export const RELEASE_1_20_MINOR = '1.20';

/**
 * Warranties: the three ways a warranty is created and every place it shows up
 * afterwards. A warranty never moves money; it hangs off a purchase.
 *
 * The order is where a reader finds the feature (Tools), the page and its
 * status cards, the two ways in from that page (Add warranty, Import CSV), how
 * the register shows a purchase that has one, the way in from the register
 * (the New Transaction window's Warranties line), and finally the two places a
 * warranty finds the reader again: the opt-in dashboard widget and the expiry
 * reminders.
 *
 * **No row is anchored.** The shield repeats on every row that has a
 * warranty, and one anchor across rows would break the anchor-uniqueness rule
 * and move under sorting and filtering, so that step is an anchorless coach
 * mark that leaves the register in view.
 *
 * **The New Transaction detour** opens the form as the introduction tour does
 * (`click` on the button, advancing when the form appears) and `requires`
 * `transactionEntry` for the same reason: with no account there is no form to
 * walk. The line is hidden for a joint account, which the form may default to,
 * so that step falls back to a centered card. The steps inside the form are
 * `skipOnBack`, so Back never lands on an anchor that closed with the form.
 * Being passive, the line's own Add warranty is covered by the step's blocker:
 * pressing it would save the transaction and leave for the Warranties page.
 *
 * **Gated on `ownerView`.** A delegate with the warranties section sees the
 * page read-only (no Add, no Import) and no Warranties line in the form, so a
 * tour about creating warranties has nothing to show them.
 *
 * The Tools step is `skipOnMobile`, as the other Tools steps are: the phone
 * drawer is not anchored. It carries `openToolsMenu` because it points inside
 * the menu, not at the closed trigger.
 */
export const RELEASE_1_20_WARRANTIES_TOUR: TourDefinition = {
  id: 'release-1.20.0/warranties',
  area: 'transactions',
  version: RELEASE_1_20_MINOR,
  i18nPrefix: 'release.v1_20_0.warranties',
  requiresData: 'ownerView',
  steps: [
    {
      // Route-agnostic welcome: shows wherever the tour was launched, so it
      // never fights a closing What's New modal's history.back().
      id: 'welcome',
      anchorId: null,
    },
    {
      // The Warranties entry inside the open Tools menu.
      id: 'warrantiesLink',
      route: '/dashboard',
      anchorId: TOUR_ANCHORS.navWarranties,
      openToolsMenu: true,
      unobtrusive: true,
      placement: 'right',
      skipOnMobile: true,
    },
    {
      // The status cards render in every state of the page (a skeleton while
      // loading, "Not loaded" on a failure), so a user with no warranties
      // still has something to point at.
      id: 'overview',
      route: '/warranties',
      anchorId: TOUR_ANCHORS.warrantiesSummary,
      placement: 'bottom',
      unobtrusive: true,
    },
    {
      id: 'addWarranty',
      route: '/warranties',
      anchorId: TOUR_ANCHORS.warrantiesAddButton,
      placement: 'bottom',
    },
    {
      id: 'importCsv',
      route: '/warranties',
      anchorId: TOUR_ANCHORS.warrantiesImportButton,
      placement: 'bottom',
    },
    {
      id: 'inRegister',
      route: '/transactions',
      anchorId: null,
      unobtrusive: true,
    },
    {
      // Interactive: clicking New Transaction opens the form; the step advances
      // once the form panel appears.
      id: 'newTransaction',
      requires: 'transactionEntry',
      route: '/transactions',
      anchorId: TOUR_ANCHORS.transactionsNewButton,
      placement: 'bottom',
      advance: { type: 'appear', anchorId: TOUR_ANCHORS.transactionForm },
    },
    {
      id: 'warrantiesLine',
      requires: 'transactionEntry',
      route: '/transactions',
      anchorId: TOUR_ANCHORS.transactionWarrantiesLine,
      placement: 'auto',
      skipOnBack: true,
      // Hidden while the form's account is a joint one; say why instead.
      fallbackWhenMissing: true,
      anchorTimeoutMs: 2500,
    },
    {
      // Spotlights the form's own Cancel/Create pair; advance when it closes.
      id: 'closeForm',
      requires: 'transactionEntry',
      route: '/transactions',
      anchorId: TOUR_ANCHORS.transactionFormActions,
      placement: 'top',
      advance: { type: 'disappear', anchorId: TOUR_ANCHORS.transactionForm },
      skipOnBack: true,
    },
    {
      // The widget is off by default, so the step points at Customize, where
      // it is turned on, rather than at a card most users do not have.
      id: 'dashboardWidget',
      route: '/dashboard',
      anchorId: TOUR_ANCHORS.dashboardCustomize,
      placement: 'bottom',
      unobtrusive: true,
    },
    {
      id: 'reminders',
      route: '/dashboard',
      anchorId: TOUR_ANCHORS.notificationBell,
      placement: 'bottom',
    },
  ],
};

export const RELEASE_1_20_TOURS: readonly TourDefinition[] = [
  RELEASE_1_20_WARRANTIES_TOUR,
];
