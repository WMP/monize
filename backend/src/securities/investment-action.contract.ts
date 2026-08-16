import {
  StateDefinition,
  StateFlowContract,
  StateFieldMode,
} from "../common/financial-invariants/state-flow.contract";
import { InvestmentAction } from "./entities/investment-transaction.entity";

export const INVESTMENT_ACTION_FIELDS = [
  "securityId",
  "fundingAccountId",
  "quantity",
  "price",
  "commission",
  "totalAmount",
  "exchangeRate",
  "linkedTransactionId",
  "cashTransactionId",
] as const;

export type InvestmentActionField = (typeof INVESTMENT_ACTION_FIELDS)[number];

export type InvestmentShareEffect = "increase" | "decrease" | "ratio" | "none";
export type InvestmentCashEffect = "debit" | "credit" | "none";
export type InvestmentCashFormula = "buy" | "sell" | "distribution" | "none";
export type InvestmentQuantitySemantics =
  | "shares"
  | "split-ratio"
  | "optional-multiplier";
export type InvestmentActionEffect =
  | "cash-debit"
  | "cash-credit"
  | "shares-increase"
  | "shares-decrease"
  | "shares-ratio"
  | "no-cash"
  | "no-share-change";

export interface InvestmentActionState extends StateDefinition<
  InvestmentAction,
  InvestmentActionField,
  InvestmentActionEffect
> {
  shareEffect: InvestmentShareEffect;
  cashEffect: InvestmentCashEffect;
  cashFormula: InvestmentCashFormula;
  quantitySemantics: InvestmentQuantitySemantics;
  supportsDirectCreate: boolean;
  supportsEmbeddedSplit: boolean;
  requiresSecurityWhenEmbedded: boolean;
  requiresPositiveAcquisitionPrice: boolean;
  contributesTransactionPrice: boolean;
  quantityOnly: boolean;
  requiresPairedLeg: boolean;
}

const BASE_FIELDS: Record<InvestmentActionField, StateFieldMode> = {
  securityId: "optional",
  fundingAccountId: "fixed-null",
  quantity: "optional",
  price: "optional",
  commission: "fixed-zero",
  totalAmount: "fixed-zero",
  exchangeRate: "fixed-one",
  linkedTransactionId: "fixed-null",
  cashTransactionId: "fixed-null",
};

function fields(
  overrides: Partial<Record<InvestmentActionField, StateFieldMode>>,
): Record<InvestmentActionField, StateFieldMode> {
  return { ...BASE_FIELDS, ...overrides };
}

/**
 * The executable financial meaning of every InvestmentAction.
 *
 * `fields` describes the canonical destination state after an action transition:
 * values marked fixed-* must be cleared/reset rather than retained from the
 * previous action. The service transition normalizer is a follow-up consumer;
 * today the registry is already authoritative for share replay, embedded-split
 * eligibility, quantity-only classification and cash-impact formulas.
 */
export const INVESTMENT_ACTION_FLOW = {
  name: "investment-action",
  fields: INVESTMENT_ACTION_FIELDS,
  states: {
    [InvestmentAction.BUY]: {
      state: InvestmentAction.BUY,
      fields: fields({
        securityId: "required",
        fundingAccountId: "optional",
        quantity: "required",
        price: "required",
        commission: "optional",
        totalAmount: "derived",
        exchangeRate: "derived",
        cashTransactionId: "derived",
      }),
      effects: ["cash-debit", "shares-increase"],
      shareEffect: "increase",
      cashEffect: "debit",
      cashFormula: "buy",
      quantitySemantics: "shares",
      supportsDirectCreate: true,
      supportsEmbeddedSplit: true,
      requiresSecurityWhenEmbedded: true,
      requiresPositiveAcquisitionPrice: true,
      contributesTransactionPrice: true,
      quantityOnly: false,
      requiresPairedLeg: false,
    },
    [InvestmentAction.SELL]: {
      state: InvestmentAction.SELL,
      fields: fields({
        securityId: "required",
        fundingAccountId: "optional",
        quantity: "required",
        price: "required",
        commission: "optional",
        totalAmount: "derived",
        exchangeRate: "derived",
        cashTransactionId: "derived",
      }),
      effects: ["cash-credit", "shares-decrease"],
      shareEffect: "decrease",
      cashEffect: "credit",
      cashFormula: "sell",
      quantitySemantics: "shares",
      supportsDirectCreate: true,
      supportsEmbeddedSplit: true,
      requiresSecurityWhenEmbedded: true,
      requiresPositiveAcquisitionPrice: false,
      contributesTransactionPrice: true,
      quantityOnly: false,
      requiresPairedLeg: false,
    },
    [InvestmentAction.DIVIDEND]: {
      state: InvestmentAction.DIVIDEND,
      fields: fields({
        securityId: "optional",
        fundingAccountId: "optional",
        quantity: "optional",
        price: "required",
        totalAmount: "derived",
        exchangeRate: "derived",
        cashTransactionId: "derived",
      }),
      effects: ["cash-credit", "no-share-change"],
      shareEffect: "none",
      cashEffect: "credit",
      cashFormula: "distribution",
      quantitySemantics: "optional-multiplier",
      supportsDirectCreate: true,
      supportsEmbeddedSplit: true,
      requiresSecurityWhenEmbedded: true,
      requiresPositiveAcquisitionPrice: false,
      contributesTransactionPrice: false,
      quantityOnly: false,
      requiresPairedLeg: false,
    },
    [InvestmentAction.INTEREST]: {
      state: InvestmentAction.INTEREST,
      fields: fields({
        securityId: "optional",
        fundingAccountId: "optional",
        quantity: "optional",
        price: "required",
        totalAmount: "derived",
        exchangeRate: "derived",
        cashTransactionId: "derived",
      }),
      effects: ["cash-credit", "no-share-change"],
      shareEffect: "none",
      cashEffect: "credit",
      cashFormula: "distribution",
      quantitySemantics: "optional-multiplier",
      supportsDirectCreate: true,
      supportsEmbeddedSplit: true,
      requiresSecurityWhenEmbedded: false,
      requiresPositiveAcquisitionPrice: false,
      contributesTransactionPrice: false,
      quantityOnly: false,
      requiresPairedLeg: false,
    },
    [InvestmentAction.CAPITAL_GAIN]: {
      state: InvestmentAction.CAPITAL_GAIN,
      fields: fields({
        securityId: "optional",
        fundingAccountId: "optional",
        quantity: "optional",
        price: "required",
        totalAmount: "derived",
        exchangeRate: "derived",
        cashTransactionId: "derived",
      }),
      effects: ["cash-credit", "no-share-change"],
      shareEffect: "none",
      cashEffect: "credit",
      cashFormula: "distribution",
      quantitySemantics: "optional-multiplier",
      supportsDirectCreate: true,
      supportsEmbeddedSplit: true,
      requiresSecurityWhenEmbedded: true,
      requiresPositiveAcquisitionPrice: false,
      contributesTransactionPrice: false,
      quantityOnly: false,
      requiresPairedLeg: false,
    },
    [InvestmentAction.SPLIT]: {
      state: InvestmentAction.SPLIT,
      fields: fields({
        securityId: "required",
        quantity: "required",
        price: "optional",
      }),
      effects: ["no-cash", "shares-ratio"],
      shareEffect: "ratio",
      cashEffect: "none",
      cashFormula: "none",
      quantitySemantics: "split-ratio",
      supportsDirectCreate: true,
      supportsEmbeddedSplit: false,
      requiresSecurityWhenEmbedded: false,
      requiresPositiveAcquisitionPrice: false,
      contributesTransactionPrice: false,
      quantityOnly: false,
      requiresPairedLeg: false,
    },
    [InvestmentAction.TRANSFER_IN]: {
      state: InvestmentAction.TRANSFER_IN,
      fields: fields({
        securityId: "required",
        quantity: "required",
        price: "optional",
        linkedTransactionId: "required",
      }),
      effects: ["no-cash", "shares-increase"],
      shareEffect: "increase",
      cashEffect: "none",
      cashFormula: "none",
      quantitySemantics: "shares",
      supportsDirectCreate: false,
      supportsEmbeddedSplit: false,
      requiresSecurityWhenEmbedded: false,
      requiresPositiveAcquisitionPrice: false,
      contributesTransactionPrice: true,
      quantityOnly: false,
      requiresPairedLeg: true,
    },
    [InvestmentAction.TRANSFER_OUT]: {
      state: InvestmentAction.TRANSFER_OUT,
      fields: fields({
        securityId: "required",
        quantity: "required",
        price: "optional",
        linkedTransactionId: "required",
      }),
      effects: ["no-cash", "shares-decrease"],
      shareEffect: "decrease",
      cashEffect: "none",
      cashFormula: "none",
      quantitySemantics: "shares",
      supportsDirectCreate: false,
      supportsEmbeddedSplit: false,
      requiresSecurityWhenEmbedded: false,
      requiresPositiveAcquisitionPrice: false,
      contributesTransactionPrice: true,
      quantityOnly: false,
      requiresPairedLeg: true,
    },
    [InvestmentAction.REINVEST]: {
      state: InvestmentAction.REINVEST,
      fields: fields({
        securityId: "required",
        quantity: "required",
        price: "required",
        commission: "optional",
        exchangeRate: "derived",
      }),
      effects: ["no-cash", "shares-increase"],
      shareEffect: "increase",
      cashEffect: "none",
      cashFormula: "none",
      quantitySemantics: "shares",
      supportsDirectCreate: true,
      supportsEmbeddedSplit: true,
      requiresSecurityWhenEmbedded: true,
      requiresPositiveAcquisitionPrice: true,
      contributesTransactionPrice: true,
      quantityOnly: false,
      requiresPairedLeg: false,
    },
    [InvestmentAction.ADD_SHARES]: {
      state: InvestmentAction.ADD_SHARES,
      fields: fields({
        securityId: "required",
        quantity: "required",
        price: "fixed-null",
      }),
      effects: ["no-cash", "shares-increase"],
      shareEffect: "increase",
      cashEffect: "none",
      cashFormula: "none",
      quantitySemantics: "shares",
      supportsDirectCreate: true,
      supportsEmbeddedSplit: false,
      requiresSecurityWhenEmbedded: false,
      requiresPositiveAcquisitionPrice: false,
      contributesTransactionPrice: false,
      quantityOnly: true,
      requiresPairedLeg: false,
    },
    [InvestmentAction.REMOVE_SHARES]: {
      state: InvestmentAction.REMOVE_SHARES,
      fields: fields({
        securityId: "required",
        quantity: "required",
        price: "fixed-null",
      }),
      effects: ["no-cash", "shares-decrease"],
      shareEffect: "decrease",
      cashEffect: "none",
      cashFormula: "none",
      quantitySemantics: "shares",
      supportsDirectCreate: true,
      supportsEmbeddedSplit: false,
      requiresSecurityWhenEmbedded: false,
      requiresPositiveAcquisitionPrice: false,
      contributesTransactionPrice: false,
      quantityOnly: true,
      requiresPairedLeg: false,
    },
  },
  // Unlinked investment rows may be edited between actions. Paired transfer and
  // embedded-split restrictions are separate flow boundaries checked by their
  // owning services; the destination state contract still applies to all pairs.
  transitions: { kind: "all-pairs" },
} satisfies StateFlowContract<
  InvestmentAction,
  InvestmentActionField,
  InvestmentActionEffect,
  InvestmentActionState
>;

export function getInvestmentActionState(
  action: InvestmentAction | string,
): InvestmentActionState | undefined {
  return (
    INVESTMENT_ACTION_FLOW.states as Partial<
      Record<string, InvestmentActionState>
    >
  )[action];
}

export function investmentActionsWhere(
  predicate: (state: InvestmentActionState) => boolean,
): InvestmentAction[] {
  return Object.values(InvestmentAction).filter((action) =>
    predicate(INVESTMENT_ACTION_FLOW.states[action]),
  );
}

export function calculateContractCashImpact(
  action: InvestmentAction,
  quantity: number,
  price: number,
  commission: number,
): number {
  const q = Number(quantity) || 0;
  const p = Number(price) || 0;
  const c = Number(commission) || 0;

  switch (INVESTMENT_ACTION_FLOW.states[action].cashFormula) {
    case "buy":
      return -(q * p + c);
    case "sell":
      return q * p - c;
    case "distribution":
      return (q || 1) * p;
    case "none":
      return 0;
  }
}
