import { TOUR_ANCHORS } from '../anchors';
import type { TourDefinition } from '../types';

/** Minor line these tours belong to; matched against the running major.minor. */
export const RELEASE_1_18_MINOR = '1.18';

/**
 * Bank sync (Settings > Bank sync): importing the booked transactions of bank
 * accounts through Open Banking, with the user's own Enable Banking
 * application.
 *
 * Bank sync is not in the 1.17.0 release notes and `package.json` is at 1.17.0,
 * so the next minor line is the one that ships it. The tour is offered once the
 * app runs a 1.18 build.
 *
 * The order is the order a reader sets the feature up: where the settings are
 * (the header's Settings button, then the Bank sync card on the Settings hub),
 * the setup help for Enable Banking (an outside web service the reader
 * registers an application with once), the credentials, the connect button, the
 * connection card, linking a bank account to a Monize account, the import
 * preview, the consent that has to be renewed, and finally the notifications
 * about it in Settings.
 *
 * **Finding the page.** The header step is route-agnostic and passive: a click
 * on Settings navigates, and a `click` advance would race its own navigation.
 * The hub step names the engine's `/settings` and advances by route when the
 * reader opens the Bank sync card. It is `skipOnMobile` for the header step
 * only, because the phone has a drawer and no header button.
 *
 * **The help panel is held open** by `openBankSyncHelp` on the two steps that
 * point inside it, because it folds behind a toggle once credentials are saved.
 *
 * **Anchors always render for the first part, a bank is needed for the rest.**
 * The credentials block, the connect header and the connection list wrap every
 * state of their part of the page (loading, failed, empty, populated), so those
 * steps need no data. The connection card's header (the consent) and the first
 * bank account's link picker and sync actions exist only once a bank is
 * connected (and, for the sync actions, linked), so their steps are
 * `fallbackWhenMissing` and say what the reader will see once there is a bank.
 * The dialogs (connect a bank, link a bank account) and the preview modal are
 * opened by the reader, so they are described inside the step of the control
 * that opens them, never anchored.
 *
 * **Gated on `ownerView`.** The bank sync endpoints refuse a delegate session
 * and the Settings hub shows a delegate only the security view, so the whole
 * tour is hidden from the offer surfaces for a delegate. No step needs its own
 * requirement.
 *
 * The two notification steps each point at one row of the channel matrix (Bank
 * connections, Bank sync results), not at the whole matrix of the 1.16 tour.
 */
export const RELEASE_1_18_BANK_SYNC_TOUR: TourDefinition = {
  id: 'release-1.18.0/bank-sync',
  area: 'settings',
  version: RELEASE_1_18_MINOR,
  i18nPrefix: 'release.v1_18_0.bankSync',
  requiresData: 'ownerView',
  steps: [
    {
      // Route-agnostic welcome: shows wherever the tour was launched, so it
      // never fights a closing What's New modal's history.back().
      id: 'welcome',
      anchorId: null,
    },
    {
      // Where Settings is. Passive: the button navigates, and the next step
      // names the route, so the engine does the walking.
      id: 'openSettings',
      anchorId: TOUR_ANCHORS.navSettings,
      placement: 'bottom',
      skipOnMobile: true,
      fallbackWhenMissing: true,
      anchorTimeoutMs: 1500,
    },
    {
      // The Bank sync card on the hub. Opening it navigates, so the advance is
      // the route, never a click. Absent in demo mode, where the page is
      // restricted, hence the fallback.
      id: 'settingsHub',
      route: '/settings',
      anchorId: TOUR_ANCHORS.settingsBankSyncCard,
      placement: 'auto',
      advance: { type: 'route', route: '/settings/bank-sync' },
      fallbackWhenMissing: true,
      anchorTimeoutMs: 4000,
    },
    {
      // What Enable Banking is, and that it is a website the reader registers
      // with. The panel is folded once credentials exist, so the step opens it.
      id: 'helpWhat',
      route: '/settings/bank-sync',
      anchorId: TOUR_ANCHORS.bankSyncHelpWhat,
      placement: 'auto',
      openBankSyncHelp: true,
      unobtrusive: true,
    },
    {
      // The ordered list of what to do on the Enable Banking website, with the
      // values to paste (the Redirect URL among them).
      id: 'helpSteps',
      route: '/settings/bank-sync',
      anchorId: TOUR_ANCHORS.bankSyncHelpSteps,
      placement: 'auto',
      openBankSyncHelp: true,
      unobtrusive: true,
    },
    {
      // The Enable Banking application block: spinner, failure or card. No
      // `openBankSyncHelp`: the card is the subject now, and the help folds
      // again when credentials exist.
      id: 'credentials',
      route: '/settings/bank-sync',
      anchorId: TOUR_ANCHORS.bankSyncCredentials,
      placement: 'auto',
      unobtrusive: true,
    },
    {
      // The heading row with Connect a bank, enabled or not.
      id: 'connect',
      route: '/settings/bank-sync',
      anchorId: TOUR_ANCHORS.bankSyncConnectHeader,
      placement: 'bottom',
    },
    {
      // The list, which also holds the empty state.
      id: 'connections',
      route: '/settings/bank-sync',
      anchorId: TOUR_ANCHORS.bankSyncConnections,
      placement: 'auto',
      unobtrusive: true,
    },
    {
      id: 'link',
      route: '/settings/bank-sync',
      anchorId: TOUR_ANCHORS.bankSyncAccountLink,
      placement: 'auto',
      fallbackWhenMissing: true,
      anchorTimeoutMs: 1500,
    },
    {
      id: 'preview',
      route: '/settings/bank-sync',
      anchorId: TOUR_ANCHORS.bankSyncAccountActions,
      placement: 'auto',
      fallbackWhenMissing: true,
      anchorTimeoutMs: 1500,
    },
    {
      // The card's header row: status, Expires soon, valid until, Renew consent.
      id: 'consent',
      route: '/settings/bank-sync',
      anchorId: TOUR_ANCHORS.bankSyncConnectionConsent,
      placement: 'bottom',
      fallbackWhenMissing: true,
      anchorTimeoutMs: 1500,
    },
    {
      // One row of the matrix: Bank connections, the consent reminders.
      id: 'notifications',
      route: '/settings',
      anchorId: TOUR_ANCHORS.notificationBankConnectionsRow,
      placement: 'auto',
      allowInteraction: true,
    },
    {
      // The next row: Bank sync results, the outcome of the daily sync.
      id: 'notificationsSync',
      route: '/settings',
      anchorId: TOUR_ANCHORS.notificationBankSyncResultsRow,
      placement: 'auto',
      allowInteraction: true,
    },
  ],
};

export const RELEASE_1_18_TOURS: readonly TourDefinition[] = [
  RELEASE_1_18_BANK_SYNC_TOUR,
];
