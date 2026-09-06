'use client';

import { useFormatter, useTranslations } from 'next-intl';
import { useRouter } from 'next/navigation';
import { useNumberFormat } from '@/hooks/useNumberFormat';
import { useDateFormat } from '@/hooks/useDateFormat';
import type { NotificationFilters } from '@/lib/notification-filters';
import { hasActiveNotificationFilters } from '@/lib/notification-filters';
import { Badge } from '@/components/ui/Badge';
import { EmptyState } from '@/components/ui/EmptyState';
import type { NotificationFilterCategory, Notification, NotificationSeverity } from '@/types/notification';
import { safeNotificationTarget } from '@/lib/notification-target';
import { RemindMeButton } from './RemindMeButton';

/**
 * The structured payload a `BILL_DUE` notification carries, so the reader sees it in
 * their own language.
 *
 * A stored sentence cannot be translated after the fact: the row is written by a
 * cron under no request locale, and the missing-rate case is exactly the one a
 * non-English reader hits (issue #1247). `title`/`message` stay on the row as
 * the English fallback for a consumer with no catalog -- the email digest, an
 * API client -- and the UI composes both from these fields instead.
 */
interface BillDueAlertData {
  payeeName?: string;
  amount?: number | null;
  amountComplete?: boolean;
  dueDate?: string;
  currencyCode?: string;
}

/**
 * The structured payload a system notification carries (`data.system === true`),
 * following the same rule as `BillDueAlertData`: the row stores English
 * fallbacks, the UI composes localized copy from these facts. Fields are
 * per-type; every one is optional so an older or foreign row falls back to
 * its stored text rather than rendering a hole.
 */
interface SystemAlertData {
  system?: boolean;
  affectedUserId?: string;
  affectedUserEmail?: string | null;
  reason?: string;
  missingAttachments?: number;
  inconsistentAttachments?: number;
  expectedAttachments?: number;
  providerLabel?: string;
  since?: string;
  lastError?: string | null;
  scheduledName?: string;
  dueDate?: string;
  error?: string;
}

/**
 * Where clicking an notification takes the reader, per type. `null` means the click
 * marks it read and closes the dropdown, nothing more -- there is no page
 * that says more than the notification itself (the provider pair), or no page to
 * point at (a budget notification whose budgetId is null, which used to push the
 * broken route /budgets/null).
 */
function notificationRoute(notification: Notification): string | null {
  // The server's answer wins: the producer knows which budget, bill or security
  // the row is about, and the client only knows its type. Rows written before
  // `target` existed carry none, and during a rolling deploy the list holds both
  // shapes at once -- so the table below is the fallback, not the rule.
  const target = safeNotificationTarget(notification.target);
  if (target) return target;

  switch (notification.type) {
    case 'BILL_DUE':
    case 'SCHEDULED_POST_FAILED':
      return '/bills';
    case 'BACKUP_FAILED':
    case 'BACKUP_PARTIAL':
    case 'ENCRYPTION_KEY_MISSING':
    case 'SMTP_FAILURE':
      return '/settings';
    case 'PROVIDER_OUTAGE':
    case 'PROVIDER_RECOVERED':
      return null;
    default:
      return notification.budgetId ? `/budgets/${notification.budgetId}` : null;
  }
}

/**
 * The structured payload of a system notification, or null for anything else --
 * including a row written before the payload existed, which falls back to
 * its stored English.
 */
function systemAlertData(notification: Notification): SystemAlertData | null {
  const data = notification.data as SystemAlertData | undefined;
  if (!data || data.system !== true) return null;
  return data;
}

interface NotificationListProps {
  /** The notifications matching the active filter -- the owner filters, this renders. */
  notifications: Notification[];
  isLoading: boolean;
  onMarkRead: (notificationId: string) => void;
  onMarkAllRead: () => void;
  onDismiss: (notificationId: string) => void;
  onUndoDismiss: (notificationId: string) => void;
  dismissingIds: Set<string>;
  collapsingIds: Set<string>;
  onClose: () => void;
  filters: NotificationFilters;
  onFiltersChange: (filters: NotificationFilters) => void;
  /** Asks the owner to confirm and dismiss everything matching `filters`. */
  onDeleteAll: () => void;
}

const SEVERITY_FILTER_OPTIONS: readonly NotificationSeverity[] = [
  'critical',
  'warning',
  'info',
  'success',
];

const CATEGORY_FILTER_OPTIONS: readonly NotificationFilterCategory[] = [
  'financial',
  'system',
];

const FILTER_CHIP_CLASS =
  'flex-shrink-0 transition-colors motion-reduce:transition-none';

function severityStyles(severity: NotificationSeverity): {
  bg: string;
  text: string;
  border: string;
  dot: string;
} {
  switch (severity) {
    case 'critical':
      return {
        bg: 'bg-red-50 dark:bg-red-900/20',
        text: 'text-red-700 dark:text-red-300',
        border: 'border-red-200 dark:border-red-800',
        dot: 'bg-red-500',
      };
    case 'warning':
      return {
        bg: 'bg-amber-50 dark:bg-amber-900/20',
        text: 'text-amber-700 dark:text-amber-300',
        border: 'border-amber-200 dark:border-amber-800',
        dot: 'bg-amber-500',
      };
    case 'success':
      return {
        bg: 'bg-green-50 dark:bg-green-900/20',
        text: 'text-green-700 dark:text-green-300',
        border: 'border-green-200 dark:border-green-800',
        dot: 'bg-green-500',
      };
    default:
      return {
        bg: 'bg-blue-50 dark:bg-blue-900/20',
        text: 'text-blue-700 dark:text-blue-300',
        border: 'border-blue-200 dark:border-blue-800',
        dot: 'bg-blue-500',
      };
  }
}

function severityLabel(severity: NotificationSeverity, t: (key: string) => string): string {
  switch (severity) {
    case 'critical':
      return t('severity.critical');
    case 'warning':
      return t('severity.warning');
    case 'success':
      return t('severity.success');
    default:
      return t('severity.info');
  }
}

/**
 * Whether this notification carries enough structured data to be composed locally.
 * An older row (written before the fields existed) falls back to its stored
 * English -- absent is "no information", not a licence to render nothing.
 */
function billDueData(notification: Notification): BillDueAlertData | null {
  if (notification.type !== 'BILL_DUE') return null;
  const data = notification.data as BillDueAlertData | undefined;
  if (!data || typeof data.dueDate !== 'string') return null;
  return data;
}

/**
 * Whole days from today to `dueDate`, on the reader's own clock.
 *
 * Counted at render time rather than read from the row: an notification lives until it
 * is dismissed, so a stored "in 3 days" goes on saying three days for as long
 * as the notification is on screen.
 */
function daysUntil(dueDate: string): number {
  const due = new Date(`${dueDate}T00:00:00`);
  const today = new Date();
  today.setHours(0, 0, 0, 0);
  return Math.round((due.getTime() - today.getTime()) / 86_400_000);
}

export function NotificationList({
  notifications,
  isLoading,
  onMarkRead,
  onMarkAllRead,
  onDismiss,
  onUndoDismiss,
  dismissingIds,
  collapsingIds,
  onClose,
  filters,
  onFiltersChange,
  onDeleteAll,
}: NotificationListProps) {
  const t = useTranslations('notifications');
  /**
   * The row's timestamp, in the reader's language.
   *
   * `Intl.RelativeTimeFormat` through next-intl rather than a hand-written
   * `${n}h ago`: this is the one string on every row, and it was the one string
   * the rename left in English while the title and body beside it were composed
   * in the reader's locale. It also gets future dates right in every language
   * ("in 2 days"), which the hand-written version spelled out per branch.
   */
  const format = useFormatter();
  const router = useRouter();
  const { formatCurrency } = useNumberFormat();
  /**
   * A due date rendered in the reader's own date-format preference
   * (`DD.MM.YYYY`, `MM/DD/YYYY`, ...), never the stored `YYYY-MM-DD`. The row
   * carries the date as a calendar string, so it goes through `formatDate` --
   * the same helper every register and report uses -- rather than being
   * interpolated raw, which showed a Polish reader `2026-09-15` in place of
   * `15.09.2026`.
   */
  const { formatDate } = useDateFormat();

  /**
   * A bill-due notification's headline, in the reader's language. `null` for anything
   * else -- and for an older row whose data predates these fields -- so the
   * caller falls back to the stored English.
   */
  const billDueTitle = (notification: Notification): string | null => {
    const data = billDueData(notification);
    if (!data) return null;
    const payee = data.payeeName ?? '';
    const days = daysUntil(data.dueDate!);
    if (days < 0) return t('billDue.titleOverdue', { payee });
    if (days === 0) return t('billDue.titleToday', { payee });
    if (days === 1) return t('billDue.titleTomorrow', { payee });
    return t('billDue.titleInDays', { payee, days });
  };

  /**
   * What the bill will cost and when, or an explicit statement that the amount
   * cannot be worked out. Never the persisted snapshot, and never a blank where
   * a figure belongs (issue #1247).
   */
  const billDueMessage = (notification: Notification): string | null => {
    const data = billDueData(notification);
    if (!data) return null;
    if (data.amount == null || data.amountComplete === false) {
      return t('billDue.amountUnavailable', { date: formatDate(data.dueDate!) });
    }
    return t('billDue.amountDue', {
      amount: formatCurrency(data.amount, data.currencyCode),
      date: formatDate(data.dueDate!),
    });
  };

  /**
   * A system notification's headline in the reader's language, or null for other
   * types and for rows without the structured payload (stored English wins).
   */
  const systemAlertTitle = (notification: Notification): string | null => {
    const data = systemAlertData(notification);
    if (!data) return null;
    switch (notification.type) {
      case 'BACKUP_FAILED':
        return t('system.backupFailed.title');
      case 'BACKUP_PARTIAL':
        return t('system.backupPartial.title');
      case 'ENCRYPTION_KEY_MISSING':
        return t('system.encryptionKeyMissing.title');
      case 'SMTP_FAILURE':
        return t('system.smtpFailure.title');
      case 'PROVIDER_OUTAGE':
        return data.providerLabel
          ? t('system.providerOutage.title', { provider: data.providerLabel })
          : null;
      case 'PROVIDER_RECOVERED':
        return data.providerLabel
          ? t('system.providerRecovered.title', { provider: data.providerLabel })
          : null;
      case 'SCHEDULED_POST_FAILED':
        return data.scheduledName
          ? t('system.scheduledPostFailed.title', { name: data.scheduledName })
          : null;
      default:
        return null;
    }
  };

  /** The system notification's body, same contract as `systemAlertTitle`. */
  const systemAlertMessage = (notification: Notification): string | null => {
    const data = systemAlertData(notification);
    if (!data) return null;
    const user = data.affectedUserEmail ?? data.affectedUserId ?? '';
    switch (notification.type) {
      case 'BACKUP_FAILED':
        return user
          ? t('system.backupFailed.message', { user, error: data.error ?? '' })
          : null;
      case 'BACKUP_PARTIAL': {
        if (!user) return null;
        if (data.reason === 'attachments') {
          // Both counts, because a run can be partial for either reason
          // alone: rendering only `missing` told the reader "0 attachments
          // could not be included" for a run whose attachments were all
          // present and inconsistent with their metadata.
          if (
            data.missingAttachments === undefined ||
            data.inconsistentAttachments === undefined ||
            data.expectedAttachments === undefined
          ) {
            return null;
          }
          return t('system.backupPartial.messageAttachments', {
            user,
            missing: data.missingAttachments,
            inconsistent: data.inconsistentAttachments,
            expected: data.expectedAttachments,
          });
        }
        // The cause is the actionable half of these two (a permission, a full
        // volume), so it travels into the copy rather than being dropped.
        if (data.reason === 'promotion' && data.error !== undefined) {
          return t('system.backupPartial.messagePromotion', {
            user,
            error: data.error,
          });
        }
        if (data.reason === 'retention' && data.error !== undefined) {
          return t('system.backupPartial.messageRetention', {
            user,
            error: data.error,
          });
        }
        return null;
      }
      case 'ENCRYPTION_KEY_MISSING':
        return t('system.encryptionKeyMissing.message');
      case 'SMTP_FAILURE':
        return t('system.smtpFailure.message', { error: data.lastError ?? '' });
      case 'PROVIDER_OUTAGE':
        return data.providerLabel
          ? t('system.providerOutage.message', { provider: data.providerLabel })
          : null;
      case 'PROVIDER_RECOVERED':
        return data.providerLabel
          ? t('system.providerRecovered.message', { provider: data.providerLabel })
          : null;
      case 'SCHEDULED_POST_FAILED':
        return data.dueDate
          ? t('system.scheduledPostFailed.message', {
              date: formatDate(data.dueDate),
              error: data.error ?? '',
            })
          : null;
      default:
        return null;
    }
  };

  /**
   * A GEM recommendation-change row, composed in the reader's language from the
   * `data` facts the producer wrote (`docs/specs/gem-signal-change-notifications.md`).
   * Returns null for any other type, falling back to the stored English.
   */
  const gemSignalData = (
    notification: Notification,
  ): {
    kind?: string;
    strategyName?: string;
    fromState?: string;
    toState?: string;
    toSymbol?: string | null;
    toRole?: string | null;
  } | null => {
    if (notification.type !== 'GEM_SIGNAL_CHANGED') return null;
    return (notification.data ?? {}) as {
      kind?: string;
      strategyName?: string;
      fromState?: string;
      toState?: string;
      toSymbol?: string | null;
      toRole?: string | null;
    };
  };

  const stateLabel = (state: string | undefined): string =>
    state === 'RISK_ON' ? t('gemSignal.riskOn') : t('gemSignal.riskOff');

  const gemSignalTitle = (notification: Notification): string | null => {
    const data = gemSignalData(notification);
    if (!data) return null;
    const strategy = data.strategyName ?? '';
    return data.kind === 'risk'
      ? t('gemSignal.riskTitle', { strategy, state: stateLabel(data.toState) })
      : t('gemSignal.allocationTitle', { strategy });
  };

  const gemSignalMessage = (notification: Notification): string | null => {
    const data = gemSignalData(notification);
    if (!data) return null;
    const strategy = data.strategyName ?? '';
    if (data.kind === 'risk') {
      return t('gemSignal.riskMessage', {
        strategy,
        fromState: stateLabel(data.fromState),
        toState: stateLabel(data.toState),
      });
    }
    return t('gemSignal.allocationMessage', {
      strategy,
      target: data.toSymbol ?? data.toRole ?? '',
    });
  };

  /**
   * A daily portfolio-movement row, composed from the producer's `data`
   * (`docs/specs/portfolio-movement-notifications.md`). The percent is already
   * signed by direction; the copy names each direction so it reads naturally in
   * every locale.
   */
  const portfolioMovementData = (
    notification: Notification,
  ): { direction?: string; changePercent?: number } | null => {
    if (notification.type !== 'PORTFOLIO_MOVEMENT') return null;
    return (notification.data ?? {}) as {
      direction?: string;
      changePercent?: number;
    };
  };

  const portfolioMovementTitle = (notification: Notification): string | null => {
    const data = portfolioMovementData(notification);
    if (!data) return null;
    const percent = Math.abs(data.changePercent ?? 0);
    return data.direction === 'down'
      ? t('portfolioMovement.titleDown', { percent })
      : t('portfolioMovement.titleUp', { percent });
  };

  const portfolioMovementMessage = (notification: Notification): string | null => {
    const data = portfolioMovementData(notification);
    if (!data) return null;
    const percent = Math.abs(data.changePercent ?? 0);
    return data.direction === 'down'
      ? t('portfolioMovement.messageDown', { percent })
      : t('portfolioMovement.messageUp', { percent });
  };

  /**
   * A balance-threshold crossing row, composed from the producer's `data`
   * (`docs/specs/balance-threshold-notifications.md`). The amount is formatted
   * in the account's own currency (the crossing's currency).
   */
  const balanceThresholdData = (
    notification: Notification,
  ): {
    kind?: string;
    accountName?: string;
    balance?: number;
    threshold?: number;
    currencyCode?: string;
  } | null => {
    if (
      notification.type !== 'BALANCE_BELOW_THRESHOLD' &&
      notification.type !== 'BALANCE_ABOVE_THRESHOLD'
    ) {
      return null;
    }
    return (notification.data ?? {}) as {
      kind?: string;
      accountName?: string;
      balance?: number;
      threshold?: number;
      currencyCode?: string;
    };
  };

  const balanceThresholdTitle = (notification: Notification): string | null => {
    const data = balanceThresholdData(notification);
    if (!data) return null;
    const account = data.accountName ?? '';
    return notification.type === 'BALANCE_ABOVE_THRESHOLD'
      ? t('balanceThreshold.titleHigh', { account })
      : t('balanceThreshold.titleLow', { account });
  };

  const balanceThresholdMessage = (
    notification: Notification,
  ): string | null => {
    const data = balanceThresholdData(notification);
    if (!data) return null;
    const account = data.accountName ?? '';
    const money = (value: number | undefined): string =>
      value == null
        ? ''
        : formatCurrency(value, data.currencyCode);
    return notification.type === 'BALANCE_ABOVE_THRESHOLD'
      ? t('balanceThreshold.messageHigh', {
          account,
          balance: money(data.balance),
          threshold: money(data.threshold),
        })
      : t('balanceThreshold.messageLow', {
          account,
          balance: money(data.balance),
          threshold: money(data.threshold),
        });
  };

  const unreadCount = notifications.filter((a) => !a.isRead && !dismissingIds.has(a.id)).length;

  const handleAlertClick = (notification: Notification) => {
    if (!notification.isRead) {
      onMarkRead(notification.id);
    }
    onClose();
    const route = notificationRoute(notification);
    if (route) {
      router.push(route);
    }
  };

  const filtered = hasActiveNotificationFilters(filters);

  const toggleSeverity = (severity: NotificationSeverity) => {
    onFiltersChange({
      ...filters,
      severity: filters.severity === severity ? null : severity,
    });
  };

  const toggleCategory = (category: NotificationFilterCategory) => {
    onFiltersChange({
      ...filters,
      category: filters.category === category ? null : category,
    });
  };

  return (
    // Full-screen below `sm` (the phone treatment); the desktop dropdown keeps
    // its card shape via the sm:-scoped rounding, border and height cap.
    //
    // The height is `h-dvh`, never `bottom-0`/`inset-0`: the sliding AppHeader
    // this mounts inside always carries a `transform`, which makes the header
    // -- not the viewport -- the containing block for `position: fixed`, so a
    // bottom anchor caps the panel at the header's own ~56px box (it only
    // *looked* full when notification rows overflowed it). An explicit viewport
    // height grows past the containing block instead.
    <div
      className="fixed inset-x-0 top-0 h-dvh sm:absolute sm:inset-auto sm:right-0 sm:mt-1 sm:h-auto sm:w-[30rem] bg-white dark:bg-gray-800 sm:rounded-lg shadow-lg dark:shadow-gray-700/50 sm:border border-gray-200 dark:border-gray-700 z-50 sm:max-h-[28rem] flex flex-col"
      data-testid="notification-list"
    >
      {/* Header */}
      <div className="flex items-center justify-between gap-3 px-4 py-3 border-b border-gray-200 dark:border-gray-700">
        <h3 className="text-sm font-semibold text-gray-900 dark:text-gray-100">
          {t('title')}
          {unreadCount > 0 && (
            <span className="ml-2 text-xs font-normal text-gray-500 dark:text-gray-400">
              {t('unread', { count: unreadCount })}
            </span>
          )}
        </h3>
        <div className="flex items-center gap-3">
          {unreadCount > 0 && (
            <button
              onClick={onMarkAllRead}
              className="text-xs text-blue-600 dark:text-blue-400 hover:text-blue-800 dark:hover:text-blue-300"
              data-testid="mark-all-read"
            >
              {t('markAllRead')}
            </button>
          )}
          {notifications.length > 0 && (
            <button
              onClick={onDeleteAll}
              className="text-xs text-red-600 dark:text-red-400 hover:text-red-800 dark:hover:text-red-300"
              data-testid="delete-all-notifications"
            >
              {t('deleteAll')}
            </button>
          )}
          {/* On mobile the panel covers the screen, so clicking outside is
              impossible -- this is the only way out (ActionHistoryPanel's
              pattern). */}
          <button
            onClick={onClose}
            className="text-gray-400 hover:text-gray-600 dark:hover:text-gray-300 sm:hidden"
            aria-label={t('closeAriaLabel')}
            data-testid="close-notifications"
          >
            <svg
              xmlns="http://www.w3.org/2000/svg"
              fill="none"
              viewBox="0 0 24 24"
              strokeWidth={1.5}
              stroke="currentColor"
              className="w-5 h-5"
            >
              <path
                strokeLinecap="round"
                strokeLinejoin="round"
                d="M6 18 18 6M6 6l12 12"
              />
            </svg>
          </button>
        </div>
      </div>

      {/* Filters */}
      <div
        className="flex flex-col gap-1.5 px-4 py-2 border-b border-gray-200 dark:border-gray-700"
        data-testid="notification-filters"
      >
        <div className="flex items-center gap-1.5 overflow-x-auto scrollbar-hide">
          {SEVERITY_FILTER_OPTIONS.map((severity) => (
            <Badge
              key={severity}
              as="button"
              variant={filters.severity === severity ? 'blue' : 'gray'}
              onClick={() => toggleSeverity(severity)}
              aria-pressed={filters.severity === severity}
              className={FILTER_CHIP_CLASS}
              data-testid={`notification-filter-severity-${severity}`}
            >
              {severityLabel(severity, t)}
            </Badge>
          ))}
        </div>
        <div className="flex items-center gap-1.5 overflow-x-auto scrollbar-hide">
          {CATEGORY_FILTER_OPTIONS.map((category) => (
            <Badge
              key={category}
              as="button"
              variant={filters.category === category ? 'blue' : 'gray'}
              onClick={() => toggleCategory(category)}
              aria-pressed={filters.category === category}
              className={FILTER_CHIP_CLASS}
              data-testid={`notification-filter-category-${category}`}
            >
              {category === 'financial'
                ? t('filter.financial')
                : t('filter.system')}
            </Badge>
          ))}
        </div>
      </div>

      {/* Alert list. The body is a flex column so the loading and empty
          states can center themselves in the leftover height -- on the
          full-screen mobile panel that is most of the screen, while the
          desktop dropdown is content-sized and unaffected. */}
      <div className="overflow-y-auto overscroll-contain flex-1 flex flex-col">
        {isLoading && notifications.length === 0 ? (
          <div className="flex-1 flex flex-col justify-center px-4 py-8 text-center text-sm text-gray-500 dark:text-gray-400">
            {t('loading')}
          </div>
        ) : notifications.length === 0 ? (
          <div
            className="flex-1 flex flex-col justify-center px-4"
            data-testid="no-notifications"
          >
            <EmptyState
              icon={
                <svg
                  xmlns="http://www.w3.org/2000/svg"
                  fill="none"
                  viewBox="0 0 24 24"
                  strokeWidth={1.5}
                  stroke="currentColor"
                >
                  <path
                    strokeLinecap="round"
                    strokeLinejoin="round"
                    d="M14.857 17.082a23.848 23.848 0 0 0 5.454-1.31A8.967 8.967 0 0 1 18 9.75V9A6 6 0 0 0 6 9v.75a8.967 8.967 0 0 1-2.312 6.022c1.733.64 3.56 1.085 5.455 1.31m5.714 0a24.255 24.255 0 0 1-5.714 0m5.714 0a3 3 0 1 1-5.714 0"
                  />
                </svg>
              }
              title={filtered ? t('emptyFiltered') : t('empty')}
            />
          </div>
        ) : (
          <div>
            {notifications.map((notification) => {
              const styles = severityStyles(notification.severity);
              const isDismissing = dismissingIds.has(notification.id);
              const isCollapsing = collapsingIds.has(notification.id);
              return (
                <div
                  key={notification.id}
                  className={`transition-all duration-300 overflow-hidden ${
                    isCollapsing ? 'max-h-0 opacity-0' : 'max-h-28'
                  }`}
                >
                  {isDismissing ? (
                    <div
                      className="border-b border-gray-100 dark:border-gray-700/50 px-4 py-3 flex items-center justify-center"
                      data-testid={`undo-notification-${notification.id}`}
                    >
                      <button
                        onClick={() => onUndoDismiss(notification.id)}
                        className="text-sm font-medium text-blue-600 dark:text-blue-400 hover:text-blue-800 dark:hover:text-blue-300"
                        data-testid={`undo-dismiss-${notification.id}`}
                      >
                        {t('undo')}
                      </button>
                    </div>
                  ) : (
                    <div
                      className={`relative group border-b border-gray-100 dark:border-gray-700/50 ${
                        !notification.isRead ? 'bg-gray-50/50 dark:bg-gray-700/20' : ''
                      }`}
                    >
                      <button
                        onClick={() => handleAlertClick(notification)}
                        className="w-full text-left px-4 py-3 pr-16 hover:bg-gray-50 dark:hover:bg-gray-700/50 transition-colors"
                        data-testid={`notification-item-${notification.id}`}
                      >
                        <div className="flex items-start gap-3">
                          {/* Unread dot */}
                          <div className="mt-1.5 flex-shrink-0">
                            {!notification.isRead ? (
                              <div
                                className={`w-2 h-2 rounded-full ${styles.dot}`}
                                data-testid="unread-dot"
                              />
                            ) : (
                              <div className="w-2 h-2" />
                            )}
                          </div>

                          <div className="flex-1 min-w-0">
                            <div className="flex items-center gap-2 mb-0.5">
                              <span
                                className={`inline-flex items-center px-1.5 py-0.5 rounded text-[10px] font-semibold ${styles.bg} ${styles.text}`}
                                data-testid="severity-badge"
                              >
                                {severityLabel(notification.severity, t)}
                              </span>
                              <span className="text-[11px] text-gray-400 dark:text-gray-500">
                                {format.relativeTime(new Date(notification.createdAt))}
                              </span>
                            </div>
                            <p className="text-sm font-medium text-gray-900 dark:text-gray-100 truncate">
                              {billDueTitle(notification) ?? systemAlertTitle(notification) ?? gemSignalTitle(notification) ?? portfolioMovementTitle(notification) ?? balanceThresholdTitle(notification) ?? notification.title}
                            </p>
                            <p className="text-xs text-gray-500 dark:text-gray-400 line-clamp-2 mt-0.5">
                              {billDueMessage(notification) ?? systemAlertMessage(notification) ?? gemSignalMessage(notification) ?? portfolioMovementMessage(notification) ?? balanceThresholdMessage(notification) ?? notification.message}
                            </p>
                          </div>
                        </div>
                      </button>
                      {/* Action controls, siblings of the click button (never
                          nested inside it): remind/stop, then dismiss. */}
                      <div className="absolute top-2 right-2 flex items-center gap-1 sm:opacity-0 sm:group-hover:opacity-100 sm:focus-within:opacity-100 transition-opacity">
                        <RemindMeButton notification={notification} />
                        <button
                          onClick={(e) => {
                            e.stopPropagation();
                            onDismiss(notification.id);
                          }}
                          className="p-1 rounded-md text-gray-400 hover:text-gray-600 dark:hover:text-gray-200 hover:bg-gray-200 dark:hover:bg-gray-600 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-blue-500"
                          data-testid={`dismiss-notification-${notification.id}`}
                          aria-label={t('dismissAriaLabel')}
                        >
                          <svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 20 20" fill="currentColor" className="w-4 h-4">
                            <path d="M6.28 5.22a.75.75 0 0 0-1.06 1.06L8.94 10l-3.72 3.72a.75.75 0 1 0 1.06 1.06L10 11.06l3.72 3.72a.75.75 0 1 0 1.06-1.06L11.06 10l3.72-3.72a.75.75 0 0 0-1.06-1.06L10 8.94 6.28 5.22Z" />
                          </svg>
                        </button>
                      </div>
                    </div>
                  )}
                </div>
              );
            })}
          </div>
        )}
      </div>

    </div>
  );
}
