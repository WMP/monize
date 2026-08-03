import { BadRequestException } from "@nestjs/common";
import { roundMoney } from "../common/round.util";
import { roundFxRate } from "../common/fx-entry.util";
import { tr } from "../i18n/translate";

/**
 * The conversion contract of a transfer between two accounts.
 *
 * A transfer is two ledger rows, and when the accounts hold different
 * currencies the destination row's amount is not the source row's amount. The
 * request therefore has to carry the conversion, and it used to be allowed not
 * to: `CreateTransferDto.exchangeRate` defaulted to `1` and the destination
 * amount was computed as `amount * 1`, so 100.00 USD moved into a EUR account
 * arrived as 100.00 EUR. Nothing rejected it, the destination balance was wrong
 * by the whole FX spread, and for a recurring transfer the error compounded
 * every month.
 *
 * `1` is not a neutral default here: for two different currencies it is a claim
 * that they are at par. A missing conversion is unknown, and an unknown
 * conversion means the transfer cannot be written -- see
 * `docs/financial-calculation-contract.md`.
 *
 * Rate direction is fixed and stated once: **destination units per one source
 * unit**. `toAmount = amount * exchangeRate`.
 */
export interface TransferConversionInput {
  /** Source magnitude, non-negative (the source leg is written negated). */
  amount: number;
  /** Currency of the source account. */
  fromCurrencyCode: string;
  /** Currency of the destination account. */
  toCurrencyCode: string;
  /** Destination units per one source unit, if the caller supplied one. */
  exchangeRate?: number | null;
  /** Destination magnitude, if the caller supplied one. */
  toAmount?: number | null;
}

export interface TransferConversion {
  /** Source magnitude at storage precision. */
  amount: number;
  /** Destination magnitude at storage precision. */
  toAmount: number;
  /**
   * Rate stored on the destination leg, at rate precision (10 dp). Always
   * consistent with `amount` and `toAmount`: derived from an explicit
   * `toAmount` when only that was given, so the persisted leg cannot claim a
   * rate its own two amounts contradict.
   */
  exchangeRate: number;
}

const sameCurrency = (a: string, b: string): boolean =>
  (a ?? "").toUpperCase() === (b ?? "").toUpperCase();

const isSupplied = (value: number | null | undefined): value is number =>
  value !== undefined && value !== null && Number.isFinite(Number(value));

/**
 * Resolve and validate a transfer's conversion, or refuse the transfer.
 *
 * Same currency: the conversion is known to be 1:1, and a caller contradicting
 * that (a rate other than 1, or a destination amount other than the source
 * amount) is rejected rather than quietly obeyed -- it means the client and the
 * accounts disagree about what currency is involved.
 *
 * Different currencies: the caller must supply a positive rate, a destination
 * amount, or both. Both must agree at storage precision. Supplying neither is
 * refused; that is the case that used to write a 1:1 leg.
 *
 * Shared by `createTransfer`, `previewCreateTransfer`, and both `updateTransfer`
 * paths so every surface accepts and rejects exactly the same payloads.
 */
export function resolveTransferConversion(
  input: TransferConversionInput,
): TransferConversion {
  const amount = roundMoney(Number(input.amount));
  const rateSupplied = isSupplied(input.exchangeRate);
  const rate = rateSupplied ? Number(input.exchangeRate) : null;
  const toAmountSupplied = isSupplied(input.toAmount);
  const toAmount = toAmountSupplied ? roundMoney(Number(input.toAmount)) : null;

  if (sameCurrency(input.fromCurrencyCode, input.toCurrencyCode)) {
    // 1:1 is a known rate between an account and itself in currency terms, not
    // a fallback. A caller asserting otherwise is confused about one of the two
    // accounts, so say so instead of writing a leg that disagrees with its own
    // account's currency.
    if (rateSupplied && rate !== 1) {
      throw new BadRequestException(
        tr(
          "errors.transactions.transferRateOnSameCurrency",
          `A transfer between two ${input.fromCurrencyCode} accounts cannot carry an exchange rate of ${rate}.`,
          { currency: input.fromCurrencyCode, rate: String(rate) },
        ),
      );
    }
    if (toAmountSupplied && toAmount !== amount) {
      throw new BadRequestException(
        tr(
          "errors.transactions.transferToAmountOnSameCurrency",
          `A transfer between two ${input.fromCurrencyCode} accounts must receive the amount it sends (${amount}), not ${toAmount}.`,
          {
            currency: input.fromCurrencyCode,
            amount: String(amount),
            toAmount: String(toAmount),
          },
        ),
      );
    }
    return { amount, toAmount: amount, exchangeRate: 1 };
  }

  if (!rateSupplied && !toAmountSupplied) {
    throw new BadRequestException(
      tr(
        "errors.transactions.transferConversionRequired",
        `This transfer moves ${input.fromCurrencyCode} into a ${input.toCurrencyCode} account, so it needs an exchange rate or the amount received. Without one the two currencies would be treated as equal.`,
        { from: input.fromCurrencyCode, to: input.toCurrencyCode },
      ),
    );
  }

  if (rateSupplied && rate! <= 0) {
    throw new BadRequestException(
      tr(
        "errors.transactions.transferRateNotPositive",
        "An exchange rate must be greater than zero.",
      ),
    );
  }

  if (toAmountSupplied && toAmount! < 0) {
    throw new BadRequestException(
      tr(
        "errors.transactions.transferToAmountNegative",
        "The amount received must not be negative.",
      ),
    );
  }

  // A zero transfer moves nothing, so the destination is a known zero -- but the
  // rate still cannot be derived from it, and storing 1 on a cross-currency leg
  // is the same lie in miniature. Require the rate explicitly.
  if (amount === 0) {
    if (toAmountSupplied && toAmount !== 0) {
      throw new BadRequestException(
        tr(
          "errors.transactions.transferZeroAmountReceives",
          `A transfer of zero ${input.fromCurrencyCode} cannot receive ${toAmount} ${input.toCurrencyCode}.`,
          {
            from: input.fromCurrencyCode,
            to: input.toCurrencyCode,
            toAmount: String(toAmount),
          },
        ),
      );
    }
    if (!rateSupplied) {
      throw new BadRequestException(
        tr(
          "errors.transactions.transferConversionRequired",
          `This transfer moves ${input.fromCurrencyCode} into a ${input.toCurrencyCode} account, so it needs an exchange rate or the amount received. Without one the two currencies would be treated as equal.`,
          { from: input.fromCurrencyCode, to: input.toCurrencyCode },
        ),
      );
    }
    return { amount: 0, toAmount: 0, exchangeRate: roundFxRate(rate!) };
  }

  if (rateSupplied && toAmountSupplied) {
    const derived = roundMoney(amount * rate!);
    if (derived !== toAmount) {
      throw new BadRequestException(
        tr(
          "errors.transactions.transferConversionInconsistent",
          `The exchange rate ${rate} converts ${amount} ${input.fromCurrencyCode} to ${derived} ${input.toCurrencyCode}, not ${toAmount}.`,
          {
            rate: String(rate),
            amount: String(amount),
            from: input.fromCurrencyCode,
            derived: String(derived),
            to: input.toCurrencyCode,
            toAmount: String(toAmount),
          },
        ),
      );
    }
    return { amount, toAmount: toAmount!, exchangeRate: roundFxRate(rate!) };
  }

  if (rateSupplied) {
    return {
      amount,
      toAmount: roundMoney(amount * rate!),
      exchangeRate: roundFxRate(rate!),
    };
  }

  // Only a destination amount: derive the rate it implies, so the stored leg is
  // self-consistent. Leaving the rate at 1 while the amounts differ is how a
  // later amount-only edit rescaled 100 -> 90 back to 1:1.
  return {
    amount,
    toAmount: toAmount!,
    exchangeRate: roundFxRate(toAmount! / amount),
  };
}

export interface TransferUpdateConversionInput {
  /** Currency of the source account after the edit. */
  fromCurrencyCode: string;
  /** Currency of the destination account after the edit. */
  toCurrencyCode: string;
  /** Currency the stored source leg is denominated in. */
  storedFromCurrencyCode: string;
  /** Currency the stored destination leg is denominated in. */
  storedToCurrencyCode: string;
  /** Magnitude of the stored source leg (positive). */
  storedAmount: number;
  /** Magnitude of the stored destination leg (positive). */
  storedToAmount: number;
  /** Rate recorded on the stored destination leg. */
  storedExchangeRate: number;
  requestedAmount?: number | null;
  requestedExchangeRate?: number | null;
  requestedToAmount?: number | null;
}

/**
 * Resolve the conversion an edit should leave behind.
 *
 * The dangerous case is an amount-only edit of a cross-currency transfer: the
 * old code rescaled the destination leg by the rate stored on it, and that rate
 * was `1` for every cross-currency transfer ever created through the affected
 * paths -- so "change 100.00 to 200.00" turned a 90.00 EUR destination into
 * 200.00 EUR. Rescaling by a rate that was never recorded is guessing, so an
 * amount change without a conversion is refused instead.
 *
 * An edit that touches nothing about the money keeps the stored pair verbatim,
 * so a legacy row can still have its date, description or payee corrected.
 */
export function resolveTransferUpdateConversion(
  input: TransferUpdateConversionInput,
): TransferConversion {
  const newAmount = isSupplied(input.requestedAmount)
    ? roundMoney(Number(input.requestedAmount))
    : roundMoney(Number(input.storedAmount));

  const conversionSupplied =
    isSupplied(input.requestedExchangeRate) ||
    isSupplied(input.requestedToAmount);

  if (conversionSupplied) {
    return resolveTransferConversion({
      amount: newAmount,
      fromCurrencyCode: input.fromCurrencyCode,
      toCurrencyCode: input.toCurrencyCode,
      exchangeRate: input.requestedExchangeRate,
      toAmount: input.requestedToAmount,
    });
  }

  if (sameCurrency(input.fromCurrencyCode, input.toCurrencyCode)) {
    return resolveTransferConversion({
      amount: newAmount,
      fromCurrencyCode: input.fromCurrencyCode,
      toCurrencyCode: input.toCurrencyCode,
    });
  }

  const pairUnchanged =
    sameCurrency(input.fromCurrencyCode, input.storedFromCurrencyCode) &&
    sameCurrency(input.toCurrencyCode, input.storedToCurrencyCode);
  const amountUnchanged = newAmount === roundMoney(Number(input.storedAmount));

  if (pairUnchanged && amountUnchanged) {
    return {
      amount: newAmount,
      toAmount: roundMoney(Number(input.storedToAmount)),
      exchangeRate: roundFxRate(Number(input.storedExchangeRate) || 1),
    };
  }

  throw new BadRequestException(
    tr(
      "errors.transactions.transferConversionRequiredOnEdit",
      `This transfer moves ${input.fromCurrencyCode} into a ${input.toCurrencyCode} account. Changing its amount or accounts needs an exchange rate or the amount received, because the previous conversion no longer applies.`,
      { from: input.fromCurrencyCode, to: input.toCurrencyCode },
    ),
  );
}
