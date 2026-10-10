import { assertNever } from "../domain/assert-never";
import {
  BusinessDayCalendar,
  nthBusinessDayBefore,
} from "../domain/business-day-calendar";
import { BondTerms } from "../domain/bond-terms";
import { addDays, compareYMD } from "../domain/calendar-date";
import { ExactDecimal } from "../domain/exact-decimal";
import { SchedulePeriod } from "../domain/period-schedule";
import { roundMoney, nominalOf } from "./accrual";
import { EarlyRedemptionRefusal } from "./bond-engine-types";

/** Why a request on `asOf` is refused by the window rules, or null when it is allowed. */
export function windowRefusal(
  terms: BondTerms,
  calendars: ReadonlyMap<string, BusinessDayCalendar>,
  purchaseDate: string,
  asOf: string,
  period: SchedulePeriod | null,
  maturity: string,
): EarlyRedemptionRefusal | null {
  if (period === null || compareYMD(asOf, maturity) >= 0) return "MATURED";
  const redemption = terms.redemption;
  switch (redemption.type) {
    case "MATURITY_ONLY":
      return "NOT_REDEEMABLE";
    case "ON_DEMAND": {
      if (
        compareYMD(
          asOf,
          addDays(purchaseDate, redemption.earliestDaysAfterPurchase),
        ) < 0
      ) {
        return "TOO_EARLY";
      }
      if (
        compareYMD(
          asOf,
          addDays(maturity, -redemption.latestDaysBeforeMaturity),
        ) > 0
      ) {
        return "TOO_LATE";
      }
      for (const blackout of redemption.blackouts) {
        switch (blackout.type) {
          case "RECORD_DAY_BEFORE_COUPON": {
            const calendar = calendars.get(blackout.calendarId);
            if (!calendar) return "TERMS_INCOMPLETE";
            if (
              asOf ===
              nthBusinessDayBefore(calendar, period.end, blackout.businessDays)
            ) {
              return "RECORD_DAY";
            }
            break;
          }
          default:
            return assertNever(blackout.type);
        }
      }
      return null;
    }
    default:
      return assertNever(redemption);
  }
}

/** Per-bond proceeds of an early redemption: value less penalties, then the floor. */
export function proceedsPerBond(
  terms: BondTerms,
  valueBeforePenalty: ExactDecimal,
  periodIndex: number,
): ExactDecimal {
  const redemption = terms.redemption;
  if (redemption.type !== "ON_DEMAND")
    return roundMoney(terms, valueBeforePenalty);
  const penalty = redemption.penalties.reduce((sum, p) => {
    switch (p.type) {
      case "FIXED_FEE_PER_UNIT":
        return sum.add(ExactDecimal.parse(p.amount));
      default:
        return assertNever(p.type);
    }
  }, ExactDecimal.ZERO);
  const net = roundMoney(terms, valueBeforePenalty.sub(penalty));
  const floor = redemption.proceedsFloor;
  if (floor === null) return net;
  switch (floor.type) {
    case "FACE_VALUE":
      return floor.appliesTo === "ALL_PERIODS" || periodIndex === 1
        ? ExactDecimal.max(net, nominalOf(terms))
        : net;
    default:
      return assertNever(floor.type);
  }
}

/** Every calendar id the terms refer to. */
export function referencedCalendarIds(terms: BondTerms): ReadonlySet<string> {
  const ids = new Set<string>([terms.schedule.calendarId]);
  const rule = terms.rateRule;
  if (
    rule.type !== "FIXED" &&
    rule.observation.type ===
      "STEP_VALUE_ON_NTH_BUSINESS_DAY_BEFORE_START_MONTH"
  ) {
    ids.add(rule.observation.calendarId);
  }
  if (terms.redemption.type === "ON_DEMAND") {
    terms.redemption.blackouts.forEach((b) => ids.add(b.calendarId));
  }
  return ids;
}
