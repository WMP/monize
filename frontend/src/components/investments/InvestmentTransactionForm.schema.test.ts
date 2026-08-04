import { describe, it, expect } from 'vitest';
import { buildInvestmentTransactionSchema } from './InvestmentTransactionForm';

/**
 * The form's own suite mocks `zodResolver` to `{ values: data, errors: {} }`, so
 * every rule in this schema is unverified there -- a submit with no price at all
 * passes it. The rules are asserted here, against the schema itself.
 */
const schema = buildInvestmentTransactionSchema((key) => key);

const base = {
  accountId: 'a1',
  action: 'BUY' as const,
  transactionDate: '2024-01-15',
  securityId: 'sec-1',
  quantity: 10,
  price: 150,
};

const errorsOn = (input: Record<string, unknown>): string[] => {
  const result = schema.safeParse(input);
  if (result.success) return [];
  return result.error.issues.map((issue) => issue.path.join('.'));
};

describe('investment transaction schema', () => {
  it('accepts a priced BUY', () => {
    expect(errorsOn(base)).toEqual([]);
  });

  describe('an acquisition states what it cost', () => {
    // The backend refuses a BUY or REINVEST priced at zero or blank on every
    // path that writes one; without this the form let the save go out and come
    // back as a generic 400 toast, and on a legacy zero-price row the user had
    // no indication of which field was wrong.
    it('rejects a BUY with no price', () => {
      expect(errorsOn({ ...base, price: undefined })).toContain('price');
    });

    it('rejects a BUY priced at zero', () => {
      expect(errorsOn({ ...base, price: 0 })).toContain('price');
    });

    it('rejects a REINVEST priced at zero', () => {
      expect(errorsOn({ ...base, action: 'REINVEST', price: 0 })).toContain(
        'price',
      );
    });

    it('leaves the other actions that share the price field alone', () => {
      // SPLIT's new price is optional, and the amount-only actions borrow
      // `price` as the amount -- so the rule is keyed on the action rather than
      // tightened on the field.
      expect(
        errorsOn({
          ...base,
          action: 'SPLIT',
          price: 0,
          splitNewShares: 2,
          splitOldShares: 1,
        }),
      ).not.toContain('price');
      expect(
        errorsOn({ ...base, action: 'ADD_SHARES', price: 0 }),
      ).not.toContain('price');
      expect(errorsOn({ ...base, action: 'SELL', price: 0 })).not.toContain(
        'price',
      );
    });

    it('names the price field so the message lands on it', () => {
      const result = schema.safeParse({ ...base, price: 0 });
      expect(result.success).toBe(false);
      if (result.success) return;
      const issue = result.error.issues.find(
        (candidate) => candidate.path.join('.') === 'price',
      );
      expect(issue?.message).toBe('validation.acquisitionPriceRequired');
    });
  });
});
