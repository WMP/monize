import { formatCurrency } from "../common/format-currency.util";
import { DEFAULT_LOCALE, isSupportedLocale } from "../i18n/config";
import { EmailT, englishEmailT } from "../i18n/email-translator";
import { i18nFormatter } from "../i18n/i18n-formatter";
import {
  Notification,
  NotificationType,
} from "../notification-center/entities/notification.entity";
import { NOTIFICATION_EMAIL_MESSAGES } from "./notification-email-messages";

type Copy = Pick<Notification, "title" | "message">;
type Source = Pick<Notification, "type" | "title" | "message"> & {
  data?: Record<string, unknown> | null;
};
type Data = Record<string, unknown>;
type Key = keyof typeof NOTIFICATION_EMAIL_MESSAGES;

function strings<K extends string>(
  data: Data,
  ...keys: K[]
): data is Data & Record<K, string> {
  return keys.every((key) => typeof data[key] === "string" && data[key] !== "");
}

function numbers<K extends string>(
  data: Data,
  ...keys: K[]
): data is Data & Record<K, number> {
  return keys.every(
    (key) => typeof data[key] === "number" && Number.isFinite(data[key]),
  );
}

function hasCurrency(data: Data): data is Data & { currencyCode: string } {
  return strings(data, "currencyCode") && /^[A-Z]{3}$/.test(data.currencyCode);
}

/** Calendar dates stay in UTC; parsing never shifts them into the preceding day. */
function calendarDate(value: unknown): Date | null {
  if (typeof value !== "string" || !/^\d{4}-\d{2}-\d{2}$/.test(value))
    return null;
  const date = new Date(`${value}T00:00:00Z`);
  return Number.isFinite(date.getTime()) &&
    date.toISOString().slice(0, 10) === value
    ? date
    : null;
}

/**
 * Render at the delivery boundary, without changing the stored English copy.
 * Old/restored rows lacking facts fall back as a whole: no invented zero, currency,
 * risk state or date. User names and diagnostic errors remain literal data; the
 * HTML templates escape the finished title and message exactly once.
 */
export function notificationEmailCopy(
  row: Source,
  t: EmailT = englishEmailT,
  lang = DEFAULT_LOCALE,
  now = new Date(),
): Copy {
  return (
    composeLocalizedNotificationCopy(row, t, lang, now) ?? {
      title: row.title,
      message: row.message,
    }
  );
}

export function composeLocalizedNotificationCopy(
  row: Pick<Source, "type" | "data">,
  t: EmailT,
  lang: string,
  now = new Date(),
): Copy | null {
  if (!row.data || typeof row.data !== "object" || Array.isArray(row.data)) {
    return null;
  }
  const data = row.data;
  const locale =
    isSupportedLocale(lang) && lang !== "xx" ? lang : DEFAULT_LOCALE;
  const text = (key: Key, args: Data = {}): string =>
    t(
      `emails.notificationCopy.${key}`,
      i18nFormatter(NOTIFICATION_EMAIL_MESSAGES[key], args),
      args,
    );
  const pair = (title: Key, message: Key, args: Data = {}): Copy => ({
    title: text(title, args),
    message: text(message, args),
  });
  const number = (value: number, decimals = 1): string =>
    new Intl.NumberFormat(locale, {
      minimumFractionDigits: decimals,
      maximumFractionDigits: decimals,
    }).format(value);
  const money = (value: number, currency: string): string =>
    formatCurrency(value, currency, locale);
  const dateLabel = (date: Date): string =>
    new Intl.DateTimeFormat(locale, {
      dateStyle: "medium",
      timeZone: "UTC",
    }).format(date);

  switch (row.type) {
    case NotificationType.BALANCE_BELOW_THRESHOLD:
    case NotificationType.BALANCE_ABOVE_THRESHOLD: {
      if (
        !strings(data, "accountName") ||
        !numbers(data, "balance", "threshold") ||
        !hasCurrency(data)
      )
        return null;
      const high = row.type === NotificationType.BALANCE_ABOVE_THRESHOLD;
      return pair(
        high ? "balanceThreshold.titleHigh" : "balanceThreshold.titleLow",
        high ? "balanceThreshold.messageHigh" : "balanceThreshold.messageLow",
        {
          account: data.accountName,
          balance: money(data.balance, data.currencyCode),
          threshold: money(data.threshold, data.currencyCode),
        },
      );
    }
    case NotificationType.PORTFOLIO_MOVEMENT: {
      if (
        !numbers(data, "changePercent") ||
        !["up", "down"].includes(String(data.direction))
      )
        return null;
      const down = data.direction === "down";
      return pair(
        down ? "portfolioMovement.titleDown" : "portfolioMovement.titleUp",
        down ? "portfolioMovement.messageDown" : "portfolioMovement.messageUp",
        { percent: number(Math.abs(data.changePercent), 2) },
      );
    }
    case NotificationType.GEM_SIGNAL_CHANGED: {
      if (!strings(data, "strategyName")) return null;
      const strategy = data.strategyName;
      if (data.kind === "risk") {
        if (
          !["RISK_ON", "RISK_OFF"].includes(String(data.fromState)) ||
          !["RISK_ON", "RISK_OFF"].includes(String(data.toState))
        )
          return null;
        const state = (value: unknown): string =>
          text(value === "RISK_ON" ? "gemSignal.riskOn" : "gemSignal.riskOff");
        return pair("gemSignal.riskTitle", "gemSignal.riskMessage", {
          strategy,
          state: state(data.toState),
          fromState: state(data.fromState),
          toState: state(data.toState),
        });
      }
      if (data.kind !== "allocation") return null;
      const roleKeys: Record<string, Key> = {
        US_EQUITY: "gemSignal.roles.US_EQUITY",
        EX_US_EQUITY: "gemSignal.roles.EX_US_EQUITY",
        EM_EQUITY: "gemSignal.roles.EM_EQUITY",
        SAFE: "gemSignal.roles.SAFE",
        RISK_FREE: "gemSignal.roles.RISK_FREE",
      };
      const roleKey =
        typeof data.toRole === "string" &&
        Object.prototype.hasOwnProperty.call(roleKeys, data.toRole)
          ? roleKeys[data.toRole]
          : undefined;
      const target = strings(data, "toSymbol")
        ? data.toSymbol
        : roleKey
          ? text(roleKey)
          : null;
      if (target)
        return pair(
          "gemSignal.allocationTitle",
          "gemSignal.allocationMessage",
          { strategy, target },
        );
      // An explicitly absent winner is a valid producer state; missing fields
      // on an older row are not proof of that state.
      if (data.toRole === null && data.toSymbol === null)
        return pair(
          "gemSignal.allocationTitle",
          "gemSignal.allocationMessageUnknown",
          { strategy },
        );
      return null;
    }
    case NotificationType.BILL_DUE: {
      const due = calendarDate(data.dueDate);
      if (
        !due ||
        !strings(data, "payeeName") ||
        !Number.isFinite(now.getTime())
      )
        return null;
      const today = Date.UTC(
        now.getUTCFullYear(),
        now.getUTCMonth(),
        now.getUTCDate(),
      );
      const days = Math.round((due.getTime() - today) / 86_400_000);
      const title: Key =
        days < 0
          ? "billDue.titleOverdue"
          : days === 0
            ? "billDue.titleToday"
            : days === 1
              ? "billDue.titleTomorrow"
              : "billDue.titleInDays";
      const args = {
        payee: data.payeeName,
        days: number(days, 0),
        date: dateLabel(due),
      };
      if (data.amount === null || data.amountComplete === false)
        return pair(title, "billDue.amountUnavailable", args);
      if (!numbers(data, "amount") || !hasCurrency(data)) return null;
      return pair(title, "billDue.amountDue", {
        ...args,
        amount: money(data.amount, data.currencyCode),
      });
    }
    case NotificationType.BACKUP_FAILED:
      if (data.system !== true || !strings(data, "error")) return null;
      if (
        !strings(data, "affectedUserEmail") &&
        !strings(data, "affectedUserId")
      )
        return null;
      return pair("system.backupFailed.title", "system.backupFailed.message", {
        user: data.affectedUserEmail || data.affectedUserId,
        error: data.error,
      });
    case NotificationType.BACKUP_PARTIAL: {
      if (
        data.system !== true ||
        (!strings(data, "affectedUserEmail") &&
          !strings(data, "affectedUserId"))
      )
        return null;
      const user = data.affectedUserEmail || data.affectedUserId;
      if (data.reason === "attachments") {
        if (
          !numbers(
            data,
            "missingAttachments",
            "inconsistentAttachments",
            "expectedAttachments",
          )
        )
          return null;
        return pair(
          "system.backupPartial.title",
          "system.backupPartial.messageAttachments",
          {
            user,
            missing: number(data.missingAttachments, 0),
            inconsistent: number(data.inconsistentAttachments, 0),
            expected: number(data.expectedAttachments, 0),
          },
        );
      }
      if (!strings(data, "error")) return null;
      if (data.reason === "promotion")
        return pair(
          "system.backupPartial.title",
          "system.backupPartial.messagePromotion",
          { user, error: data.error },
        );
      if (data.reason === "retention")
        return pair(
          "system.backupPartial.title",
          "system.backupPartial.messageRetention",
          { user, error: data.error },
        );
      return null;
    }
    case NotificationType.ENCRYPTION_KEY_MISSING:
      return data.system === true
        ? pair(
            "system.encryptionKeyMissing.title",
            "system.encryptionKeyMissing.message",
          )
        : null;
    case NotificationType.SMTP_FAILURE:
      return data.system === true && strings(data, "lastError")
        ? pair("system.smtpFailure.title", "system.smtpFailure.message", {
            error: data.lastError,
          })
        : null;
    case NotificationType.PROVIDER_OUTAGE:
    case NotificationType.PROVIDER_RECOVERED:
      if (data.system !== true || !strings(data, "providerLabel")) return null;
      return row.type === NotificationType.PROVIDER_OUTAGE
        ? pair("system.providerOutage.title", "system.providerOutage.message", {
            provider: data.providerLabel,
          })
        : pair(
            "system.providerRecovered.title",
            "system.providerRecovered.message",
            { provider: data.providerLabel },
          );
    case NotificationType.SCHEDULED_POST_FAILED: {
      const due = calendarDate(data.dueDate);
      if (
        data.system !== true ||
        !due ||
        !strings(data, "scheduledName", "error")
      )
        return null;
      return pair(
        "system.scheduledPostFailed.title",
        "system.scheduledPostFailed.message",
        { name: data.scheduledName, date: dateLabel(due), error: data.error },
      );
    }
    case NotificationType.OVER_BUDGET:
    case NotificationType.THRESHOLD_CRITICAL:
    case NotificationType.THRESHOLD_WARNING: {
      if (
        !strings(data, "categoryName") ||
        !numbers(data, "amount", "limit", "percent") ||
        !hasCurrency(data)
      )
        return null;
      return pair(
        row.type === NotificationType.OVER_BUDGET
          ? "budget.overTitle"
          : row.type === NotificationType.THRESHOLD_CRITICAL
            ? "budget.criticalTitle"
            : "budget.warningTitle",
        row.type === NotificationType.OVER_BUDGET
          ? "budget.overMessage"
          : "budget.thresholdMessage",
        {
          category: data.categoryName,
          amount: money(data.amount, data.currencyCode),
          limit: money(data.limit, data.currencyCode),
          percent: number(data.percent),
        },
      );
    }
    case NotificationType.PROJECTED_OVERSPEND:
      if (
        !strings(data, "categoryName") ||
        !numbers(data, "projectedTotal", "budgeted") ||
        !hasCurrency(data)
      )
        return null;
      return pair("budget.projectedTitle", "budget.projectedMessage", {
        category: data.categoryName,
        projected: money(data.projectedTotal, data.currencyCode),
        budgeted: money(data.budgeted, data.currencyCode),
      });
    case NotificationType.FLEX_GROUP_WARNING:
      if (
        !strings(data, "flexGroup") ||
        !numbers(data, "totalSpent", "totalBudgeted", "percent") ||
        !hasCurrency(data)
      )
        return null;
      return {
        title: text("budget.flexTitle", {
          group: data.flexGroup,
          percent: number(data.percent, 0),
        }),
        message: text("budget.flexMessage", {
          group: data.flexGroup,
          spent: money(data.totalSpent, data.currencyCode),
          budgeted: money(data.totalBudgeted, data.currencyCode),
          percent: number(data.percent),
        }),
      };
    case NotificationType.INCOME_SHORTFALL:
      if (
        !numbers(data, "actualIncome", "expectedIncome", "ratio") ||
        !hasCurrency(data)
      )
        return null;
      return pair("budget.incomeTitle", "budget.incomeMessage", {
        actual: money(data.actualIncome, data.currencyCode),
        expected: money(data.expectedIncome, data.currencyCode),
        ratio: number(data.ratio, 0),
      });
    case NotificationType.POSITIVE_MILESTONE:
      if (!numbers(data, "periodProgress", "percentUsed")) return null;
      return pair("budget.milestoneTitle", "budget.milestoneMessage", {
        progress: number(data.periodProgress, 0),
        percent: number(data.percentUsed),
      });
    case NotificationType.SEASONAL_SPIKE:
      if (
        !strings(data, "categoryName") ||
        !numbers(data, "highMonth", "typicalIncrease") ||
        !Number.isInteger(data.highMonth) ||
        data.highMonth < 1 ||
        data.highMonth > 12
      )
        return null;
      return pair("budget.seasonalTitle", "budget.seasonalMessage", {
        category: data.categoryName,
        month: new Intl.DateTimeFormat(locale, {
          month: "long",
          timeZone: "UTC",
        }).format(new Date(Date.UTC(2000, data.highMonth - 1, 1))),
        increase: number(data.typicalIncrease),
      });
    case NotificationType.PACE_WARNING:
      // Legacy enum member with no producer or structured-data contract.
      return null;
    default: {
      // Adding an enum member requires an explicit localization decision here.
      const unhandled: never = row.type;
      void unhandled;
      return null;
    }
  }
}
