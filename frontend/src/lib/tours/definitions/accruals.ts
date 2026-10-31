import { TOUR_ANCHORS } from '../anchors';
import type { TourDefinition } from '../types';

/**
 * Accrual accounting: what it answers that Cash does not, where to turn it
 * on, and where it then shows up. Offered from Settings > Tours, like every
 * tour; the feature is opt-in and off by default, so this one is reachable
 * before a reader has anything the later steps could anchor on.
 *
 * **Off by default, on purpose.** Unlike a tour that requires existing data
 * (`transactionEntry`, `securitiesExist`), there is no `TourRequirement` for
 * "this preference is on" -- enabling it is the very thing step two walks the
 * reader through. So the tour has no `requiresData`, and the two steps that
 * depend on the feature being on (`basisControl` and the Settings step
 * itself) are built to survive either state: the Settings step always
 * anchors (the toggle renders whether it is checked or not), and the basis
 * switch step is `fallbackWhenMissing` with a centered stand-in for a reader
 * who has not flipped the toggle yet.
 *
 * **No row, no form detour.** The control that actually builds a recognition
 * schedule, `AccrualEditorTab`, lives inside an *existing* transaction's edit
 * form -- never a new one (`TransactionForm.tsx`'s `accrualEnabled &&
 * transaction &&` guard) -- so reaching it means opening some row from the
 * register, and no row is ever a tour anchor (the warranties tour's "No row
 * is anchored" rule: one id shared across sortable, filterable rows breaks
 * anchor uniqueness and moves under the reader). The `editTransaction` step
 * is a route-agnostic description instead, the same way the email-receipts
 * tour's `reviews` step describes the AI inbox without navigating into it.
 *
 * The order is why (welcome), how (Settings), where it then shows (the
 * Cash/Accrual switch every page with one carries), where it is set up (the
 * existing-transaction detour, described), and where the net figures land
 * (the System Accruals accounts, described -- it is reached from Accounts,
 * not anchored there either, since that link only renders once the feature
 * is on).
 */
export const ACCRUALS_TOUR: TourDefinition = {
  id: 'accruals/basics',
  area: 'transactions',
  i18nPrefix: 'accruals.basics',
  steps: [
    {
      // Route-agnostic: shows wherever the tour was launched.
      id: 'welcome',
      anchorId: null,
    },
    {
      id: 'enableToggle',
      route: '/settings',
      anchorId: TOUR_ANCHORS.settingsAccrualToggle,
      placement: 'bottom',
    },
    {
      // Renders only once the toggle above is on; a reader who has not
      // flipped it yet sees the centered stand-in instead.
      id: 'basisControl',
      route: '/transactions',
      anchorId: TOUR_ANCHORS.reportingBasisControl,
      placement: 'bottom',
      fallbackWhenMissing: true,
      anchorTimeoutMs: 2500,
    },
    {
      // Describes the editor rather than opening it: it lives inside an
      // existing transaction's own edit form, and no row is ever an anchor.
      id: 'editTransaction',
      anchorId: null,
    },
    {
      // Describes the System Accruals view rather than navigating to it: the
      // way in (a link on Accounts) only renders once the feature is on.
      id: 'netBalances',
      anchorId: null,
    },
  ],
};
