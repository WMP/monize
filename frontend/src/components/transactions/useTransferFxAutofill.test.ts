import { describe, it, expect, vi, beforeEach } from 'vitest';
import { renderHook, act } from '@/test/render';
import { useState } from 'react';
import { useTransferFxAutofill } from './useTransferFxAutofill';

const mockGetRateForDate = vi.fn();
vi.mock('@/lib/exchange-rates', () => ({
  exchangeRatesApi: {
    getRateForDate: (...args: unknown[]) => mockGetRateForDate(...args),
  },
}));

interface Options {
  from?: string | null;
  to?: string | null;
  date?: string;
  amount?: number;
  target?: number;
}

/** The hook over real state, the way the transfer form holds both fields. */
function setup(options: Options = {}) {
  const {
    from = 'CAD',
    to = 'USD',
    date = '2026-10-29',
    amount: initialAmount = 0,
    target: initialTarget,
  } = options;
  return renderHook(
    ({ fromCurrency, toCurrency, txDate }) => {
      const [amount, setAmount] = useState<number | undefined>(initialAmount);
      const [targetAmount, setTargetAmount] = useState<number | undefined>(initialTarget);
      const handlers = useTransferFxAutofill({
        fromCurrency,
        toCurrency,
        date: txDate,
        amount,
        targetAmount,
        setAmount,
        setTargetAmount,
      });
      return { amount, targetAmount, ...handlers };
    },
    { initialProps: { fromCurrency: from, toCurrency: to, txDate: date } },
  );
}

async function flushRate() {
  await act(async () => {
    await vi.advanceTimersByTimeAsync(350);
  });
}

describe('useTransferFxAutofill', () => {
  beforeEach(() => {
    vi.useFakeTimers();
    mockGetRateForDate.mockReset();
    mockGetRateForDate.mockResolvedValue(0.73);
  });

  it('fetches the rate for the transfer pair on the transaction date', async () => {
    setup();
    await flushRate();
    expect(mockGetRateForDate).toHaveBeenCalledWith('CAD', 'USD', '2026-10-29');
  });

  it('does not fetch a rate for a same-currency transfer', async () => {
    setup({ from: null, to: null });
    await flushRate();
    expect(mockGetRateForDate).not.toHaveBeenCalled();
  });

  it('fills the received amount while the transfer amount is typed', async () => {
    const { result } = setup();
    await flushRate();

    act(() => result.current.handleAmountChange(1));
    expect(result.current.targetAmount).toBe(0.73);
    // Still auto-filled, so the next keystroke re-derives it.
    act(() => result.current.handleAmountChange(100));
    expect(result.current.amount).toBe(100);
    expect(result.current.targetAmount).toBe(73);
  });

  it('fills the transfer amount from a typed received amount', async () => {
    const { result } = setup();
    await flushRate();

    act(() => result.current.handleTargetAmountChange(73));
    expect(result.current.targetAmount).toBe(73);
    expect(result.current.amount).toBe(100);
  });

  it('never re-prices a received amount the user corrected', async () => {
    const { result } = setup();
    await flushRate();

    act(() => result.current.handleAmountChange(100));
    expect(result.current.targetAmount).toBe(73);
    // The bank's fee: the user corrects the received figure.
    act(() => result.current.handleTargetAmountChange(72.5));
    expect(result.current.amount).toBe(100);
    // A later edit of the sent amount leaves the corrected figure alone.
    act(() => result.current.handleAmountChange(110));
    expect(result.current.amount).toBe(110);
    expect(result.current.targetAmount).toBe(72.5);
  });

  it('leaves both values alone when both are already filled (an edited transfer)', async () => {
    const { result } = setup({ amount: 100, target: 72 });
    await flushRate();
    expect(result.current.targetAmount).toBe(72);

    act(() => result.current.handleAmountChange(120));
    expect(result.current.targetAmount).toBe(72);
    act(() => result.current.handleTargetAmountChange(80));
    expect(result.current.amount).toBe(120);
  });

  it('fills an empty received amount when the rate arrives after the amount', async () => {
    const { result } = setup();
    act(() => result.current.handleAmountChange(200));
    expect(result.current.targetAmount).toBeUndefined();

    await flushRate();
    expect(result.current.targetAmount).toBe(146);
  });

  it('re-derives an auto-filled amount when the date changes the rate', async () => {
    const { result, rerender } = setup();
    await flushRate();
    act(() => result.current.handleAmountChange(100));
    expect(result.current.targetAmount).toBe(73);

    mockGetRateForDate.mockResolvedValue(0.75);
    rerender({ fromCurrency: 'CAD', toCurrency: 'USD', txDate: '2026-10-28' });
    await flushRate();
    expect(mockGetRateForDate).toHaveBeenLastCalledWith('CAD', 'USD', '2026-10-28');
    expect(result.current.targetAmount).toBe(75);
  });

  it('clears an auto-filled side when its source is cleared', async () => {
    const { result } = setup();
    await flushRate();
    act(() => result.current.handleAmountChange(100));
    act(() => result.current.handleAmountChange(undefined));
    expect(result.current.amount).toBe(0);
    expect(result.current.targetAmount).toBeUndefined();
  });

  it('fills nothing when no rate is known', async () => {
    mockGetRateForDate.mockResolvedValue(null);
    const { result } = setup();
    await flushRate();
    act(() => result.current.handleAmountChange(100));
    expect(result.current.targetAmount).toBeUndefined();
  });

  it('fills nothing when the rate lookup fails', async () => {
    mockGetRateForDate.mockRejectedValue(new Error('Request failed'));
    const { result } = setup();
    await flushRate();
    act(() => result.current.handleTargetAmountChange(50));
    expect(result.current.amount).toBe(0);
  });
});
