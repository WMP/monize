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
 * The order is the order a reader sets the feature up: the credentials, the
 * connect button, the connection card, linking a bank account to a Monize
 * account, the import preview, the consent that has to be renewed, and finally
 * the notifications about it in Settings.
 *
 * **Three anchors always render, four need a connection.** The credentials
 * block, the connect header and the connection list wrap every state of their
 * part of the page (loading, failed, empty, populated), so those steps need no
 * data. The connection card's actions and the first bank account's link picker
 * and sync actions exist only once a bank is connected (and, for the sync
 * actions, linked), so their steps are `fallbackWhenMissing` and say what the
 * reader will see once there is a bank. The dialogs (connect a bank, link a
 * bank account) and the preview modal are opened by the reader, so they are
 * described inside the step of the control that opens them, never anchored.
 *
 * **Gated on `ownerView`.** The bank sync endpoints refuse a delegate session
 * and the Settings hub shows a delegate only the security view, so the whole
 * tour is hidden from the offer surfaces for a delegate. No step needs its own
 * requirement.
 *
 * The notifications step reuses the channel matrix anchor of the 1.16 tour,
 * which is attached once on /settings; its Bank connections and Bank sync
 * results rows are what the step names.
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
      // The Enable Banking application block: spinner, failure or card.
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
      id: 'consent',
      route: '/settings/bank-sync',
      anchorId: TOUR_ANCHORS.bankSyncConnectionActions,
      placement: 'auto',
      fallbackWhenMissing: true,
      anchorTimeoutMs: 1500,
    },
    {
      id: 'notifications',
      route: '/settings',
      anchorId: TOUR_ANCHORS.notificationChannelMatrix,
      placement: 'auto',
      allowInteraction: true,
    },
  ],
};

export const RELEASE_1_18_TOURS: readonly TourDefinition[] = [
  RELEASE_1_18_BANK_SYNC_TOUR,
];
