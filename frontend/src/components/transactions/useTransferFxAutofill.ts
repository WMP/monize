'use client';

import { useEffect, useRef, useState } from 'react';
import { exchangeRatesApi } from '@/lib/exchange-rates';
import { roundToCents } from '@/lib/format';

interface UseTransferFxAutofillArgs {
  /** Source account currency; null when the transfer is not cross-currency. */
  fromCurrency: string | null;
  /** Destination account currency; null when the transfer is not cross-currency. */
  toCurrency: string | null;
  /** Transaction date, `YYYY-MM-DD`; the rate is the one for this day. */
  date: string | undefined;
  /** Current "Transfer Amount", in `fromCurrency`. */
  amount: number | undefined;
  /** Current "Amount Received", in `toCurrency`. */
  targetAmount: number | undefined;
  setAmount: (value: number) => void;
  setTargetAmount: (value: number | undefined) => void;
}

const isFilled = (value: number | undefined): value is number =>
  value !== undefined && value > 0;

/**
 * Fills the other side of a cross-currency transfer from the day's rate.
 *
 * A side is only written while it is empty or still holds a figure this hook
 * put there: once the user types into a side it is theirs, so a received
 * amount corrected for the bank's FX fee is never re-priced by a later edit of
 * the sent amount (or a date change). With both sides typed by the user
 * nothing is filled at all.
 *
 * The rate comes from `exchangeRatesApi.getRateForDate(from, to, date)`, the
 * same lookup the foreign-currency entry panel uses; `from * rate = to`. A
 * failed lookup or a missing rate fills nothing, rather than guessing.
 */
export function useTransferFxAutofill({
  fromCurrency,
  toCurrency,
  date,
  amount,
  targetAmount,
  setAmount,
  setTargetAmount,
}: UseTransferFxAutofillArgs) {
  // The rate is kept with the pair and date it was fetched for, so a rate for
  // a previous date or account is never applied to the current one.
  const [fetched, setFetched] = useState<{ key: string; rate: number | null } | null>(null);
  // Which side currently holds a figure derived from the rate, not typed.
  const amountAutoRef = useRef(false);
  const targetAutoRef = useRef(false);
  // Latest values for the fetch callback, which must not re-run on edits.
  const latestRef = useRef({ amount, targetAmount, setAmount, setTargetAmount });
  useEffect(() => {
    latestRef.current = { amount, targetAmount, setAmount, setTargetAmount };
  });

  const key =
    fromCurrency && toCurrency && fromCurrency !== toCurrency && date
      ? `${fromCurrency}:${toCurrency}:${date}`
      : null;
  const rate = key !== null && fetched?.key === key ? fetched.rate : null;

  // A rate arriving (or changing with the date or an account) re-derives a
  // side this hook filled, or fills an empty side from the other.
  const applyRate = (value: number) => {
    const current = latestRef.current;
    if (isFilled(current.amount) && (targetAutoRef.current || !isFilled(current.targetAmount))) {
      targetAutoRef.current = true;
      current.setTargetAmount(roundToCents(current.amount * value));
    } else if (
      isFilled(current.targetAmount) &&
      (amountAutoRef.current || !isFilled(current.amount))
    ) {
      amountAutoRef.current = true;
      current.setAmount(roundToCents(current.targetAmount / value));
    }
  };

  useEffect(() => {
    if (key === null) return;
    let cancelled = false;
    const handle = setTimeout(() => {
      exchangeRatesApi
        .getRateForDate(fromCurrency as string, toCurrency as string, date as string)
        .then((value) => {
          if (cancelled) return;
          const known = value && value > 0 ? value : null;
          setFetched({ key, rate: known });
          if (known !== null) applyRate(known);
        })
        .catch(() => {
          if (!cancelled) setFetched({ key, rate: null });
        });
    }, 300);
    return () => {
      cancelled = true;
      clearTimeout(handle);
    };
    // fromCurrency/toCurrency/date are all encoded in `key`.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [key]);

  const handleAmountChange = (value: number | undefined) => {
    amountAutoRef.current = false;
    setAmount(value ?? 0);
    if (rate === null) return;
    if (!targetAutoRef.current && isFilled(targetAmount)) return;
    if (isFilled(value)) {
      targetAutoRef.current = true;
      setTargetAmount(roundToCents(value * rate));
    } else if (targetAutoRef.current) {
      targetAutoRef.current = false;
      setTargetAmount(undefined);
    }
  };

  const handleTargetAmountChange = (value: number | undefined) => {
    targetAutoRef.current = false;
    setTargetAmount(value);
    if (rate === null) return;
    if (!amountAutoRef.current && isFilled(amount)) return;
    if (isFilled(value)) {
      amountAutoRef.current = true;
      setAmount(roundToCents(value / rate));
    } else if (amountAutoRef.current) {
      amountAutoRef.current = false;
      setAmount(0);
    }
  };

  return { handleAmountChange, handleTargetAmountChange };
}
