import { roundMoney, roundToDecimals, sumMoney } from "../common/round.util";
import { GemAssetRole } from "./entities/gem-strategy-asset.entity";
import {
  EMPTY_COMPOSITION,
  GemCompositionBasis,
  GemCompositionDimension,
  GemSecurityComposition,
  GemWeighting,
  dimensionFor,
  matchHolding,
  requiredDimensionFor,
} from "./gem-composition.util";

/**
 * Pure arithmetic for "where does the real portfolio stand versus the signal".
 * Given the strategy accounts' holdings already valued in one currency, it
 * produces the compliance figure and the cost estimates the report shows -- no
 * database, no currency conversion (the service does both before calling in).
 *
 * The comparison covers **everything** held in those accounts, not only the
 * instruments the strategy assigned to a role: GEM asks for the whole portfolio
 * to sit in one asset, so a holding outside the strategy is exactly what makes
 * the portfolio non-compliant and exactly what a switch has to move.
 */

/**
 * One position in the strategy's accounts, valued in the report currency.
 *
 * Usually a security summed across the accounts, but idle brokerage cash is
 * one of these too (`isCash`). GEM asks for the whole strategy portfolio to sit
 * in one instrument, so cash sitting beside the target is exactly as
 * off-target as the wrong fund would be -- an account holding 5,000 of the
 * target and 5,000 in cash is half invested, not fully compliant.
 */
export interface GemHolding {
  /** Strategy role the security fills, or null when it fills none. */
  role: GemAssetRole | null;
  /** Null for cash, which is a balance rather than an instrument. */
  securityId: string | null;
  symbol: string | null;
  name: string | null;
  quantity: number;
  /**
   * Accounts this position sits in. A switch places one order per account, so
   * the same fund held in two of them is two sells, not one.
   *
   * Empty for cash, which is spent rather than sold.
   */
  accountIds: string[];
  /** Market value in the report currency, or null when the security has no price. */
  marketValue: number | null;
  /** Cost basis in the report currency, or null when it is unknown. */
  costBasis: number | null;
  /** The security's stored breakdowns, for the composition comparison. */
  composition?: GemSecurityComposition;
  /** True for a cash balance rather than an instrument. */
  isCash?: boolean;
}

/** A holding plus how much of it is estimated to sit in the target's markets. */
export interface GemMatchedHolding extends GemHolding {
  /**
   * Estimated share of this holding in the target's markets, 0-1, or **null
   * when it cannot be estimated** -- the target carries no breakdown to compare
   * with, or this holding carries none and cannot be placed in any market.
   *
   * Null rather than zero. Zero is a claim: "this fund holds nothing in those
   * markets", printed as a confident 0.00 beside a world tracker that may well
   * be a fifth in them. Not knowing is a different state and reads differently.
   */
  overlap: number | null;
  /**
   * The overlap is a floor rather than a measurement, because one side's
   * breakdown does not describe the whole fund. Shown as "at least"; see the
   * product decision in `matchHolding`.
   */
  overlapIsFloor: boolean;
  /**
   * True when this holding *is* the instrument the signal names -- the same
   * security, not a fund with similar exposure. What the strategy actually
   * asks for, and what decides whether the position is kept or sold.
   */
  isTargetInstrument: boolean;
  /** True when the ticker was compared because no breakdown was available. */
  matchedByInstrument: boolean;
  /** Which markets that share is made of, largest first. */
  matchedMarkets: GemWeighting[];
}

export interface GemPositionMath {
  /** Holdings above the dust threshold, largest position first. */
  holdings: GemMatchedHolding[];
  /** The largest holding: what the accounts are effectively in. */
  current: GemMatchedHolding | null;
  /**
   * Holdings a switch sells into the target, largest first. Each is sold
   * whole: see the note on `transferValue`. Cash is off target and funds the
   * purchase, so it is in here -- use `sold` for the sell side.
   */
  offTarget: GemMatchedHolding[];
  /**
   * The off-target positions a switch actually sells, largest first. Cash is
   * spent, not sold, so naming it as the thing to sell out of would ask the
   * user to place a trade that does not exist.
   */
  sold: GemMatchedHolding[];
  /** Whether contents or tickers decided the comparison. */
  basis: GemCompositionBasis;
  /** Breakdown the contents were compared on; null when tickers were used. */
  dimension: GemCompositionDimension | null;
  /**
   * The breakdown the target would need for a contents comparison of this
   * role -- what to fill in when `basis` is INSTRUMENT. Null with no target.
   */
  requiredDimension: GemCompositionDimension | null;
  /** Holdings that fell back to a ticker comparison for want of a breakdown. */
  instrumentMatchedCount: number;
  /**
   * Orders the sell side of a switch takes.
   *
   * One per **(account, security)** pair, not one per instrument. The holdings
   * are summed across the strategy's accounts so the comparison sees one
   * portfolio, and counting the summed rows counted a two-account strategy
   * holding two funds as two sells when it is four -- halving the estimate in
   * the field the user reads to decide whether the switch is worth making.
   *
   * Cash is off-target and funds the purchase, but it is not sold, so it costs
   * no commission and adds no order.
   */
  sellCount: number;
  /**
   * Orders the buy side takes: one per account that has something to put into
   * the target.
   *
   * An account already wholly in the target buys nothing -- there is no order
   * to place and no commission to pay -- so the count comes from `offTarget`,
   * which is exactly "holdings that free money", cash included. Counting every
   * account with anything in it charged a purchase to accounts with nothing to
   * do. Zero when the portfolio already complies; one, for the opening
   * purchase, when the accounts are empty and the account cannot be named.
   */
  buyCount: number;
  /**
   * Market value of everything in the accounts, or null when any position
   * could not be valued -- a partial sum is not the total, and it is read as
   * one both on screen and by the backtest's commission drag.
   */
  totalMarketValue: number | null;
  /**
   * Share of the priced non-cash securities that is the target instrument
   * itself, 0-100. Null when any of them could not be valued.
   *
   * **This is the strategy's actual instruction.** GEM says hold 100% of one
   * fund; a different fund with some exposure to the same market is not
   * partially holding it. Everything operational follows from this figure --
   * whether a change is required, what is sold, when the operation is done.
   */
  exactTargetPercent: number | null;
  /**
   * Estimated share of the priced non-cash securities exposed to the target's
   * markets, 0-100. Null when the comparison cannot be made -- the target has
   * no breakdown recorded, or a holding has none and cannot be placed.
   *
   * Informational only, and separate from `exactTargetPercent` because the two
   * answer different questions. A world tracker one fifth in emerging markets
   * gives a fifth of the exposure an EM fund would, and none of the compliance:
   * it is still sold whole when the switch runs, because the fifth cannot be
   * separated from the rest of the units. Reporting one number for both read as
   * "you are 20% of the way there", which is not true of an instruction to hold
   * one instrument.
   */
  marketExposurePercent: number | null;
  /** Whether the exposure estimate could be made at all. */
  marketExposureAvailable: boolean;
  /** The estimate is a lower bound: at least this much, possibly more. */
  marketExposureIsFloor: boolean;
  changeRequired: boolean;
  /**
   * What a switch moves: the **full** market value of every holding that is
   * not entirely in the target's markets. Partial overlap does not reduce it --
   * selling part of a mixed fund sells part of its on-target sleeve too, so a
   * pro-rated sale never reaches the 100% allocation the signal asks for.
   */
  transferValue: number | null;
  /**
   * Gain (positive) or loss (negative) the sale realizes: the sold positions
   * only, since cash realizes nothing. Null when any of them lacks a price or
   * a cost basis -- a partial gain is not the gain that will be taxed.
   */
  realizedGainLoss: number | null;
}

/**
 * Quantities below this are treated as no position: a residual fraction left by
 * a sale should not make the account look invested. Matches the dust threshold
 * the portfolio views use.
 */
const DUST_QUANTITY = 0.0001;

export function buildPositionMath(
  holdings: GemHolding[],
  targetRole: GemAssetRole | null,
  /** The instrument the signal names, with the breakdowns it is described by. */
  target: {
    securityId: string | null;
    composition: GemSecurityComposition;
  } = { securityId: null, composition: EMPTY_COMPOSITION },
): GemPositionMath {
  const sized = holdings
    .filter((holding) =>
      // A cash balance nobody could value is not dust -- it is a balance of
      // unknown size, and dropping it would let the totals below report the
      // securities alone as the whole portfolio.
      holding.isCash && holding.marketValue === null
        ? true
        : Number.isFinite(holding.quantity) &&
          Math.abs(holding.quantity) >= DUST_QUANTITY,
    )
    .sort((a, b) => (b.marketValue ?? 0) - (a.marketValue ?? 0));

  // What the strategy is asking for is exposure to the target's markets, so the
  // comparison runs on the breakdown the target is described by. With no
  // description there is nothing to compare and every holding is judged by its
  // ticker, exactly as before.
  const dimension = dimensionFor(target.composition, targetRole);
  /**
   * Is this holding the instrument the signal names?
   *
   * By security id, because that is what "hold 100% of EMIM" means. The role is
   * accepted too, but only as the same statement said another way: a holding
   * carries a role precisely because the configuration points that role at its
   * security.
   */
  const isTargetInstrument = (holding: GemHolding): boolean =>
    !holding.isCash &&
    targetRole !== null &&
    (holding.role === targetRole ||
      (target.securityId !== null && holding.securityId === target.securityId));

  const valued: GemMatchedHolding[] = sized.map((holding) => {
    // Cash is in no market at all: an exposure of zero here is a fact, not a
    // gap in the data. Saying it was "matched by instrument" would be wrong in
    // the other direction -- there is no missing breakdown to fill in, and none
    // would help.
    if (holding.isCash) {
      return {
        ...holding,
        overlap: 0,
        overlapIsFloor: false,
        isTargetInstrument: false,
        matchedByInstrument: false,
        matchedMarkets: [],
      };
    }
    const isTarget = isTargetInstrument(holding);
    if (!targetRole) {
      return {
        ...holding,
        // No target, so there are no markets to be exposed to: unknown, not
        // zero, because zero would be an answer to a question nobody asked.
        overlap: null,
        overlapIsFloor: false,
        isTargetInstrument: false,
        matchedByInstrument: false,
        matchedMarkets: [],
      };
    }
    // The target instrument is 100% exposed to its own markets by definition,
    // whatever breakdowns either side happens to carry.
    if (isTarget) {
      return {
        ...holding,
        overlap: 1,
        overlapIsFloor: false,
        isTargetInstrument: true,
        matchedByInstrument: dimension === null,
        matchedMarkets: [],
      };
    }
    // No dimension to compare on means the exposure of a *different* fund
    // cannot be estimated at all. It used to fall back to the ticker, which
    // returns zero for everything that is not the target -- four confident
    // 0.00 rows beside four funds nobody had measured.
    if (dimension === null) {
      return {
        ...holding,
        overlap: null,
        overlapIsFloor: false,
        isTargetInstrument: false,
        matchedByInstrument: true,
        matchedMarkets: [],
      };
    }
    const match = matchHolding({
      isTarget: false,
      holding: holding.composition ?? EMPTY_COMPOSITION,
      target: target.composition,
      dimension,
    });
    return {
      ...holding,
      // A holding with no breakdown of its own cannot be placed either.
      overlap: match.byInstrument ? null : match.overlap,
      overlapIsFloor: !match.byInstrument && match.partial,
      isTargetInstrument: false,
      matchedByInstrument: match.byInstrument,
      matchedMarkets: match.matched,
    };
  });

  const knownValues = valued
    .map((holding) => holding.marketValue)
    .filter((value): value is number => value !== null);
  const unpricedCount = valued.length - knownValues.length;
  // "What these accounts hold" is a total, so it is either the total or it is
  // unknown. Summing the priced part and labelling it the whole understates
  // the portfolio -- and it is what the backtest sizes its commission drag
  // against, so the error does not stay in one number.
  //
  // Empty accounts are the one case where the total is a known zero: holding
  // nothing is not the same as not knowing what is held, and the contract's
  // truth table is explicit that `0` and `null` must never stand in for each
  // other. It reached the transfer card as "Amount to move: Unknown" for a
  // portfolio that had been sold down to nothing, where the answer is nothing.
  const totalMarketValue =
    valued.length === 0
      ? 0
      : unpricedCount === 0
        ? sumMoney(knownValues)
        : null;

  /**
   * The largest holding, or null when that cannot be decided.
   *
   * The sort ranks an unpriced holding as zero, which is a convenience for
   * ordering and a claim when the top of that list is printed as "largest
   * position". A portfolio of VOO at 10,000 and 3,000 units of a fund with no
   * price row admitted it could not be valued on one line and stated the
   * largest position confidently on the next.
   */
  const current =
    valued.length === 0 || unpricedCount > 0 ? null : (valued[0] ?? null);

  /**
   * The denominator both percentages are measured against: the securities.
   *
   * Cash is out of it. It is off target and it funds the purchase, but "how
   * much of my equity allocation is in the right fund" is not a question idle
   * cash belongs in the bottom of -- a portfolio wholly in the target with a
   * dividend just paid in would otherwise read as less than fully invested in
   * a fund it is entirely invested in.
   */
  const securities = valued.filter((holding) => !holding.isCash);
  const securitiesValue = securities.some(
    (holding) => holding.marketValue === null,
  )
    ? null
    : sumMoney(securities.map((holding) => holding.marketValue as number));

  /**
   * What the strategy actually asks for: the share held in the named
   * instrument itself.
   *
   * An unpriced holding makes it unknown rather than shrinking the
   * denominator. Dropping one from the bottom while counting it as zero in the
   * top moves the figure in the dangerous direction: 10,000 in the target plus
   * one unpriced position came out at exactly 100%, and the report then said
   * there was nothing to do about a position it could not see.
   */
  const exactTargetPercent =
    targetRole && securitiesValue !== null && securitiesValue > 0
      ? roundToDecimals(
          (sumMoney(
            securities
              .filter((holding) => holding.isTargetInstrument)
              .map((holding) => holding.marketValue as number),
          ) /
            securitiesValue) *
            100,
          2,
        )
      : null;

  /**
   * The informational half: how much of the same market the portfolio is
   * exposed to, however it got there.
   *
   * Every security has to be placeable for this to mean anything. One holding
   * nobody can measure and the sum is not "the exposure" -- it is the exposure
   * of the part that happened to carry a breakdown, printed where the reader
   * expects a total. That is the same understatement `totalMarketValue` refuses
   * to make, so this refuses too: unknown, not a smaller number.
   */
  const marketExposureAvailable =
    targetRole !== null &&
    securitiesValue !== null &&
    securitiesValue > 0 &&
    securities.every((holding) => holding.overlap !== null);
  /**
   * The aggregate is a floor when any holding's share is one. Mixing a floor
   * into a sum makes the sum a floor -- the parts nobody described can only
   * add to it -- and printing that as a measurement is the one thing the
   * product decision in `matchHolding` does not allow.
   */
  const marketExposureIsFloor =
    marketExposureAvailable &&
    securities.some((holding) => holding.overlapIsFloor);
  const marketExposurePercent = marketExposureAvailable
    ? roundToDecimals(
        (sumMoney(
          securities.map(
            (holding) =>
              (holding.marketValue as number) * (holding.overlap as number),
          ),
        ) /
          (securitiesValue as number)) *
          100,
        2,
      )
    : null;

  /**
   * Everything that is not the target instrument, sold whole.
   *
   * Membership is exact-instrument, not exposure. A world tracker a fifth in
   * emerging markets is not a fifth of the way to holding EMIM: the fifth
   * cannot be separated from the rest of the units, so keeping the fund keeps
   * four fifths of the wrong thing, and GEM asks for one instrument. The
   * overlap is an explanation of what the portfolio is exposed to today, never
   * a reason to keep a position.
   */
  const offTarget = targetRole
    ? valued.filter((holding) => !holding.isTargetInstrument)
    : [];
  const sold = offTarget.filter((holding) => !holding.isCash);
  const sellCount = sold.reduce(
    (orders, holding) => orders + Math.max(1, holding.accountIds.length),
    0,
  );
  /**
   * Where the target has to be bought: the accounts holding something that is
   * not it. Selling a fund frees money in the account it was held in, and cash
   * is spent where it sits, so both sides of that come from `offTarget`.
   *
   * An account already wholly in the target is deliberately absent: it places
   * no order. The one case with no such account and still a purchase to make
   * is empty accounts -- nothing is held anywhere, so which account buys is
   * unknown, and the opening purchase counts as the single order it is.
   */
  const buyAccountIds = new Set(
    offTarget.flatMap((holding) => holding.accountIds),
  );
  const buyCount =
    buyAccountIds.size > 0
      ? buyAccountIds.size
      : targetRole && valued.length === 0
        ? 1
        : 0;

  /**
   * With no target there is nothing to be compliant with. Otherwise: anything
   * off target means a change -- something to sell, or idle cash that has to be
   * put to work even when every security is already the right one -- and so does
   * holding nothing at all, where the change is the opening purchase.
   *
   * There is deliberately no percentage tolerance here. One was written in
   * (`exactTargetPercent < 99.5`) and could never fire: `offTarget` is empty
   * exactly when every valued security *is* the target, and then the percentage
   * is either 100 or null, so the first clause had already decided. Making it
   * fire would mean letting the percentage overrule `offTarget`, and that is
   * worse than dead code: a portfolio 99.7% in the target would report "nothing
   * to do" while the same call computes a sell order for the stray 0.3%, and a
   * fully-invested account with a dividend just paid in would report nothing to
   * do about cash the report is simultaneously telling the user to deploy --
   * cash is excluded from the percentage's denominator on purpose.
   */
  const changeRequired = targetRole
    ? offTarget.length > 0 || valued.length === 0
    : false;
  // The executable trade, therefore, is the whole of each off-target position.
  //
  // A sum that quietly skips what it could not value is not the amount that
  // moves -- it is a smaller one, printed in the place the user reads to decide
  // how much cash the switch frees. One unpriced holding makes the figure
  // unknown, and the report says so rather than understating it.
  // Nothing off target is nothing to move: a known zero, not an unknown.
  const transferValue = offTarget.some(
    (holding) => holding.marketValue === null,
  )
    ? null
    : sumMoney(offTarget.map((holding) => holding.marketValue as number));

  // Selling the position whole realizes the whole result on it -- pro-rating
  // this by the overlap understated the tax on exactly the switches where the
  // estimate matters, since a long-held world tracker carries most of the gain.
  //
  // Only the sold positions count: cash realizes nothing, and because its
  // "cost" equals its value it would otherwise answer for the holdings whose
  // cost is unknown -- turning an unknowable result into a confident zero, and
  // the tax with it. A single sold position without a cost basis makes the
  // whole estimate unknown; a partial gain is not the gain that will be taxed.
  const realizedGainLoss =
    sold.length === 0
      ? // Nothing is sold, so nothing is realized -- whether the purchase is
        // funded by cash, or there is nothing to do at all. Both are zero, and
        // returning null for the second told a user with empty accounts that
        // the tax on a switch moving nothing could not be worked out.
        0
      : sold.every(
            (holding) =>
              holding.marketValue !== null && holding.costBasis !== null,
          )
        ? sumMoney(
            sold.map(
              (holding) =>
                (holding.marketValue as number) - (holding.costBasis as number),
            ),
          )
        : null;

  return {
    holdings: valued,
    current,
    offTarget,
    basis: dimension === null ? "INSTRUMENT" : "COMPOSITION",
    dimension,
    requiredDimension: requiredDimensionFor(targetRole),
    instrumentMatchedCount: valued.filter(
      (holding) => holding.matchedByInstrument,
    ).length,
    sold,
    sellCount,
    buyCount,
    totalMarketValue,
    exactTargetPercent,
    marketExposurePercent,
    marketExposureAvailable,
    marketExposureIsFloor,
    changeRequired,
    transferValue,
    realizedGainLoss,
  };
}

/**
 * Tax on an estimated realized gain. A loss owes nothing, and without a
 * configured rate the estimate is unknown rather than zero.
 */
export function estimateTax(
  realizedGainLoss: number | null,
  taxRatePercent: number | null,
): number | null {
  if (realizedGainLoss === null || taxRatePercent === null) return null;
  if (realizedGainLoss <= 0) return 0;
  return roundMoney((realizedGainLoss * taxRatePercent) / 100);
}

/**
 * Commission the switch costs: the configured per-order amount times the
 * number of orders it takes. Selling out of three instruments and buying one is
 * four orders, not one, so charging a single commission understated a switch
 * out of a spread-out portfolio by exactly the amount that makes switching
 * expensive.
 *
 * Orders, not instruments. A strategy run in two brokerage accounts, each
 * holding the same two funds, places four sells and two buys -- six orders, not
 * the three a per-instrument count gave. Both sides are counted where they
 * happen, in `buildPositionMath`.
 *
 * A portfolio that already complies places no orders and costs nothing, so
 * zero orders is a real answer here and not a floor to be raised: forcing a
 * purchase charged a commission for a switch nobody is being asked to make.
 * Without a configured commission the estimate stays unknown rather than
 * becoming zero.
 */
export function estimateCommission(
  commissionAmount: number | null,
  sellCount: number,
  buyCount: number,
): number | null {
  if (commissionAmount === null) return null;
  const orders = Math.max(0, sellCount) + Math.max(0, buyCount);
  return roundMoney(commissionAmount * orders);
}
