import { describe, it, expect } from 'vitest';
import { readFileSync } from 'fs';
import { join } from 'path';
import { roundMoney } from '@/lib/format';
import {
  calculatePaymentForTerm,
  effectiveAnnualRate,
  getPeriodicRate,
  type ScheduleFrequency,
} from '@/lib/loan-schedule';
import {
  MORTGAGE_TYPE_TRAITS,
  amortizationMethodFor,
  flagsFromMortgageType,
  mortgageTypeFromFlags,
  type MortgageAmortizationMethod,
  type MortgageTypeTraits,
} from '@/lib/mortgage-type';
import { MORTGAGE_TYPES, type MortgageType } from '@/types/account';

/**
 * Each mortgage type's compounding, method and annualization are decided once
 * per layer (`MORTGAGE_TYPE_TRAITS` here and in
 * `backend/src/accounts/mortgage-type.util.ts`), and the two layers must agree
 * (INV-LOAN-003, INV-LOAN-007). They cannot import each other, so the truth
 * table lives in the backend's `mortgage-type-cases.json` and BOTH suites
 * assert it, as `loan-rate-timeline.contract.test.ts` does for its twin. A row
 * changed on either side is a row both must satisfy.
 */
const CASES_PATH = join(
  __dirname,
  '..',
  '..',
  '..',
  'backend',
  'src',
  'accounts',
  'mortgage-type-cases.json',
);

interface MortgageTypeCase {
  type: MortgageType;
  traits: MortgageTypeTraits;
  flags: { isCanadianMortgage: boolean; isVariableRate: boolean };
  example: {
    principal: number;
    annualRate: number;
    periodsPerYear: number;
    totalPayments: number;
    periodicRate: number;
    firstPrincipal: number;
    firstInterest: number;
    effectiveAnnualRate: number;
  };
}

interface MortgageTypeCases {
  comment: string;
  types: MortgageTypeCase[];
  fromFlags: {
    isCanadianMortgage: boolean;
    isVariableRate: boolean;
    type: MortgageType;
  }[];
}

const cases: MortgageTypeCases = JSON.parse(readFileSync(CASES_PATH, 'utf8'));

/** The cadence a case's payments-per-year names; the cases use these two. */
const FREQUENCY_BY_PERIODS: Record<number, ScheduleFrequency> = {
  12: 'MONTHLY',
  26: 'BIWEEKLY',
};

/**
 * The first installment's principal by method, the backend contract spec's
 * restatement of spec table 4.3 at the first due date, where the debt is the
 * principal. The LINEAR and INTEREST_ONLY engine branches land in P2-F1.
 */
const FIRST_PRINCIPAL: Record<
  MortgageAmortizationMethod,
  (args: {
    principal: number;
    annualRate: number;
    periodicRate: number;
    totalPayments: number;
    frequency: ScheduleFrequency;
    type: MortgageType;
  }) => number
> = {
  ANNUITY: ({ principal, annualRate, periodicRate, totalPayments, frequency, type }) =>
    roundMoney(
      calculatePaymentForTerm(principal, annualRate, totalPayments, frequency, type) -
        roundMoney(principal * periodicRate),
    ),
  LINEAR: ({ principal, totalPayments }) => roundMoney(principal / totalPayments),
  INTEREST_ONLY: () => 0,
};

describe('mortgage-type-cases.json, shared with the backend', () => {
  it('reads the backend truth table', () => {
    expect(cases.comment).toContain('INV-LOAN-007');
    expect(cases.fromFlags).toHaveLength(4);
  });

  it('has exactly one case per type', () => {
    expect(cases.types.map((c) => c.type).sort()).toEqual([...MORTGAGE_TYPES].sort());
  });

  it.each(cases.types.map((c) => [c.type, c] as const))(
    '%s: traits match MORTGAGE_TYPE_TRAITS',
    (type, c) => {
      expect(MORTGAGE_TYPE_TRAITS[type]).toEqual(c.traits);
    },
  );

  it.each(cases.types.map((c) => [c.type, c] as const))(
    '%s: flagsFromMortgageType writes the case flags',
    (type, c) => {
      expect(flagsFromMortgageType(type)).toEqual(c.flags);
    },
  );

  it.each(cases.fromFlags.map((c) => [c.isCanadianMortgage, c.isVariableRate, c.type] as const))(
    'mortgageTypeFromFlags(%s, %s) is %s',
    (isCanadianMortgage, isVariableRate, type) => {
      expect(mortgageTypeFromFlags(isCanadianMortgage, isVariableRate)).toBe(type);
    },
  );

  it.each(cases.types.map((c) => [c.type, c.example] as const))(
    '%s: the example reproduces through the type-keyed functions',
    (type, example) => {
      const frequency = FREQUENCY_BY_PERIODS[example.periodsPerYear];
      expect(frequency).toBeDefined();
      const periodicRate = getPeriodicRate(example.annualRate, example.periodsPerYear, type);
      expect(periodicRate).toBeCloseTo(example.periodicRate, 15);
      expect(roundMoney(example.principal * periodicRate)).toBe(example.firstInterest);
      expect(
        FIRST_PRINCIPAL[amortizationMethodFor(type)]({
          principal: example.principal,
          annualRate: example.annualRate,
          periodicRate,
          totalPayments: example.totalPayments,
          frequency,
          type,
        }),
      ).toBe(example.firstPrincipal);
      // The backend rounds the EAR to 2dp for its API; this layer returns the
      // raw percentage and each surface picks its precision.
      expect(
        Math.round(effectiveAnnualRate(example.annualRate, example.periodsPerYear, type) * 100) /
          100,
      ).toBe(example.effectiveAnnualRate);
    },
  );
});
