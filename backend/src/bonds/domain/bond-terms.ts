import { isValidYMD } from "./calendar-date";
import { ExactDecimal } from "./exact-decimal";

export type StepObservation = {
  readonly type: "STEP_VALUE_ON_NTH_BUSINESS_DAY_BEFORE_START_MONTH";
  readonly businessDays: number;
  readonly calendarId: string;
};

export type MonthlyObservation = {
  readonly type: "MONTHLY_VALUE_MONTHS_BEFORE_START";
  readonly months: number;
};

export type ObservationRule = StepObservation | MonthlyObservation;

interface BenchmarkRuleFields {
  readonly benchmarkId: string;
  /** Null: period 1 is derived like every other period. */
  readonly firstPeriodRate: string | null;
  readonly benchmarkFloor: string | null;
  readonly observation: ObservationRule;
}

export type RateRule =
  | { readonly type: "FIXED"; readonly annualRate: string }
  | ({
      readonly type: "BENCHMARK_PLUS_SPREAD";
      readonly spread: string;
    } & BenchmarkRuleFields)
  | ({
      readonly type: "INFLATION_PLUS_MARGIN_AS_RATE";
      readonly margin: string;
    } & BenchmarkRuleFields);

export type Capitalization =
  | { readonly type: "NONE" }
  | {
      readonly type: "COMPOUND_AT_PERIOD_END";
      readonly baseRounding: "PER_PERIOD" | "NONE";
    };

export type Blackout = {
  readonly type: "RECORD_DAY_BEFORE_COUPON";
  readonly businessDays: number;
  readonly calendarId: string;
};

export type Penalty =
  | {
      readonly type: "FIXED_FEE_PER_UNIT";
      readonly amount: string;
    }
  | {
      /** The interest accrued since the period start is not paid. */
      readonly type: "FORFEIT_ACCRUED_SINCE_LAST_PAYMENT";
    };

export type ProceedsFloor = {
  readonly type: "FACE_VALUE";
  readonly appliesTo: "ALL_PERIODS" | "FIRST_PERIOD";
};

export type Redemption =
  | { readonly type: "MATURITY_ONLY" }
  | {
      readonly type: "ON_DEMAND";
      readonly earliestDaysAfterPurchase: number;
      readonly latestDaysBeforeMaturity: number;
      readonly blackouts: readonly Blackout[];
      readonly penalties: readonly Penalty[];
      readonly proceedsFloor: ProceedsFloor | null;
    };

export interface BondTerms {
  readonly schemaVersion: 1;
  readonly instrument: {
    readonly issuerCountryCode: string;
    readonly issuerCode: string;
    readonly programCode: string;
    readonly seriesCode: string;
    readonly currency: string;
    readonly marketability: "RETAIL_REDEEMABLE";
    readonly faceValue: string;
  };
  readonly saleWindow: { readonly from: string; readonly to: string } | null;
  readonly schedule: {
    readonly anchor: "LOT_PURCHASE_DATE";
    readonly periodMonths: number;
    readonly periodCount: number;
    readonly rollDay: "ANCHOR_DAY_CLAMPED";
    readonly calendarId: string;
  };
  readonly accrual: { readonly type: "ACTUAL_DAYS_IN_PERIOD" };
  readonly principalRule: { readonly type: "FIXED_NOMINAL" };
  readonly rateRule: RateRule;
  readonly capitalization: Capitalization;
  readonly redemption: Redemption;
  readonly rounding: { readonly moneyDecimals: 2; readonly mode: "HALF_UP" };
  readonly source: {
    readonly provider: string;
    readonly url: string;
    readonly document: string;
  };
}

export type BondTermsErrorCode = "INVALID" | "UNSUPPORTED_PRIMITIVE";

export class BondTermsError extends Error {
  constructor(
    readonly field: string,
    detail: string,
    readonly code: BondTermsErrorCode = "INVALID",
  ) {
    super(`Invalid bond terms: ${field}: ${detail}`);
    this.name = "BondTermsError";
  }
}

type Json = Record<string, unknown>;

function object(
  value: unknown,
  path: string,
  allowed: readonly string[],
): Json {
  if (typeof value !== "object" || value === null || Array.isArray(value)) {
    throw new BondTermsError(path, "must be an object");
  }
  const record = value as Json;
  for (const key of Object.keys(record)) {
    if (!allowed.includes(key))
      throw new BondTermsError(`${path}.${key}`, "unknown field");
  }
  for (const key of allowed) {
    if (!(key in record)) throw new BondTermsError(`${path}.${key}`, "missing");
  }
  return record;
}

/** Reads the `type` discriminant; an unknown one is an unsupported primitive. */
function primitive<T extends string>(
  value: unknown,
  path: string,
  known: readonly T[],
): T {
  if (typeof value !== "object" || value === null || Array.isArray(value)) {
    throw new BondTermsError(path, "must be an object");
  }
  const type = (value as Json).type;
  if (typeof type !== "string")
    throw new BondTermsError(`${path}.type`, "must be a string");
  if (!known.includes(type as T)) {
    throw new BondTermsError(
      `${path}.type`,
      `unsupported primitive ${JSON.stringify(type)}; supported: ${known.join(", ")}`,
      "UNSUPPORTED_PRIMITIVE",
    );
  }
  return type as T;
}

function oneOf<T extends string>(
  value: unknown,
  path: string,
  options: readonly T[],
): T {
  if (typeof value !== "string" || !options.includes(value as T)) {
    throw new BondTermsError(path, `must be one of ${options.join(", ")}`);
  }
  return value as T;
}

function exact<T>(value: unknown, path: string, expected: T): T {
  if (value !== expected)
    throw new BondTermsError(path, `must be ${JSON.stringify(expected)}`);
  return expected;
}

function text(value: unknown, path: string): string {
  if (typeof value !== "string" || value.trim() === "") {
    throw new BondTermsError(path, "must be a non-empty string");
  }
  return value;
}

function code(value: unknown, path: string, pattern: RegExp): string {
  if (typeof value !== "string" || !pattern.test(value)) {
    throw new BondTermsError(path, `must match ${pattern}`);
  }
  return value;
}

function integer(value: unknown, path: string, min: number): number {
  if (!Number.isSafeInteger(value) || (value as number) < min) {
    throw new BondTermsError(path, `must be an integer >= ${min}`);
  }
  return value as number;
}

/** A non-negative decimal string; a JSON number is refused (INV-BOND-003). */
function decimal(value: unknown, path: string): string {
  if (typeof value !== "string") {
    throw new BondTermsError(path, "must be a decimal string, not a number");
  }
  let parsed: ExactDecimal;
  try {
    parsed = ExactDecimal.parse(value);
  } catch {
    throw new BondTermsError(path, `not a decimal string: ${value}`);
  }
  if (parsed.isNegative())
    throw new BondTermsError(path, "must not be negative");
  return value;
}

function nullable<T>(value: unknown, read: (v: unknown) => T): T | null {
  return value === null ? null : read(value);
}

function date(value: unknown, path: string): string {
  if (!isValidYMD(value))
    throw new BondTermsError(path, "must be a YYYY-MM-DD date");
  return value;
}

function parseObservation(value: unknown, path: string): ObservationRule {
  const type = primitive(value, path, [
    "STEP_VALUE_ON_NTH_BUSINESS_DAY_BEFORE_START_MONTH",
    "MONTHLY_VALUE_MONTHS_BEFORE_START",
  ] as const);
  if (type === "MONTHLY_VALUE_MONTHS_BEFORE_START") {
    const o = object(value, path, ["type", "months"]);
    return { type, months: integer(o.months, `${path}.months`, 1) };
  }
  const o = object(value, path, ["type", "businessDays", "calendarId"]);
  return {
    type,
    businessDays: integer(o.businessDays, `${path}.businessDays`, 1),
    calendarId: text(o.calendarId, `${path}.calendarId`),
  };
}

function parseRateRule(value: unknown, path: string): RateRule {
  const type = primitive(value, path, [
    "FIXED",
    "BENCHMARK_PLUS_SPREAD",
    "INFLATION_PLUS_MARGIN_AS_RATE",
  ] as const);
  if (type === "FIXED") {
    const r = object(value, path, ["type", "annualRate"]);
    return { type, annualRate: decimal(r.annualRate, `${path}.annualRate`) };
  }
  const addend = type === "BENCHMARK_PLUS_SPREAD" ? "spread" : "margin";
  const r = object(value, path, [
    "type",
    "benchmarkId",
    addend,
    "firstPeriodRate",
    "benchmarkFloor",
    "observation",
  ]);
  const common: BenchmarkRuleFields = {
    benchmarkId: text(r.benchmarkId, `${path}.benchmarkId`),
    firstPeriodRate: nullable(r.firstPeriodRate, (v) =>
      decimal(v, `${path}.firstPeriodRate`),
    ),
    benchmarkFloor: nullable(r.benchmarkFloor, (v) =>
      decimal(v, `${path}.benchmarkFloor`),
    ),
    observation: parseObservation(r.observation, `${path}.observation`),
  };
  return type === "BENCHMARK_PLUS_SPREAD"
    ? { type, spread: decimal(r.spread, `${path}.spread`), ...common }
    : { type, margin: decimal(r.margin, `${path}.margin`), ...common };
}

function parseCapitalization(value: unknown, path: string): Capitalization {
  const type = primitive(value, path, [
    "NONE",
    "COMPOUND_AT_PERIOD_END",
  ] as const);
  if (type === "NONE") {
    object(value, path, ["type"]);
    return { type };
  }
  const c = object(value, path, ["type", "baseRounding"]);
  return {
    type,
    baseRounding: oneOf(c.baseRounding, `${path}.baseRounding`, [
      "PER_PERIOD",
      "NONE",
    ] as const),
  };
}

function list<T>(
  value: unknown,
  path: string,
  read: (item: unknown, at: string) => T,
): T[] {
  if (!Array.isArray(value)) throw new BondTermsError(path, "must be an array");
  return value.map((item, i) => read(item, `${path}[${i}]`));
}

function parseRedemption(value: unknown, path: string): Redemption {
  const type = primitive(value, path, ["MATURITY_ONLY", "ON_DEMAND"] as const);
  if (type === "MATURITY_ONLY") {
    object(value, path, ["type"]);
    return { type };
  }
  const r = object(value, path, [
    "type",
    "earliestDaysAfterPurchase",
    "latestDaysBeforeMaturity",
    "blackouts",
    "penalties",
    "proceedsFloor",
  ]);
  return {
    type,
    earliestDaysAfterPurchase: integer(
      r.earliestDaysAfterPurchase,
      `${path}.earliestDaysAfterPurchase`,
      0,
    ),
    latestDaysBeforeMaturity: integer(
      r.latestDaysBeforeMaturity,
      `${path}.latestDaysBeforeMaturity`,
      0,
    ),
    blackouts: list(r.blackouts, `${path}.blackouts`, (item, at): Blackout => {
      const t = primitive(item, at, ["RECORD_DAY_BEFORE_COUPON"] as const);
      const b = object(item, at, ["type", "businessDays", "calendarId"]);
      return {
        type: t,
        businessDays: integer(b.businessDays, `${at}.businessDays`, 1),
        calendarId: text(b.calendarId, `${at}.calendarId`),
      };
    }),
    penalties: list(r.penalties, `${path}.penalties`, (item, at): Penalty => {
      const t = primitive(item, at, [
        "FIXED_FEE_PER_UNIT",
        "FORFEIT_ACCRUED_SINCE_LAST_PAYMENT",
      ] as const);
      if (t === "FORFEIT_ACCRUED_SINCE_LAST_PAYMENT") {
        object(item, at, ["type"]);
        return { type: t };
      }
      const p = object(item, at, ["type", "amount"]);
      return { type: t, amount: decimal(p.amount, `${at}.amount`) };
    }),
    proceedsFloor: nullable(r.proceedsFloor, (v): ProceedsFloor => {
      const at = `${path}.proceedsFloor`;
      const t = primitive(v, at, ["FACE_VALUE"] as const);
      const f = object(v, at, ["type", "appliesTo"]);
      return {
        type: t,
        appliesTo: oneOf(f.appliesTo, `${at}.appliesTo`, [
          "ALL_PERIODS",
          "FIRST_PERIOD",
        ] as const),
      };
    }),
  };
}

const FIELDS = [
  "schemaVersion",
  "instrument",
  "saleWindow",
  "schedule",
  "accrual",
  "principalRule",
  "rateRule",
  "capitalization",
  "redemption",
  "rounding",
  "source",
] as const;

/** Strict validator for a stored terms document (spec 2.1, schemaVersion 1). */
export function parseBondTerms(json: unknown): BondTerms {
  const t = object(json, "terms", FIELDS);
  exact(t.schemaVersion, "terms.schemaVersion", 1);

  const i = object(t.instrument, "terms.instrument", [
    "issuerCountryCode",
    "issuerCode",
    "programCode",
    "seriesCode",
    "currency",
    "marketability",
    "faceValue",
  ]);
  const faceValue = decimal(i.faceValue, "terms.instrument.faceValue");
  if (ExactDecimal.parse(faceValue).isZero()) {
    throw new BondTermsError("terms.instrument.faceValue", "must be positive");
  }

  const s = object(t.schedule, "terms.schedule", [
    "anchor",
    "periodMonths",
    "periodCount",
    "rollDay",
    "calendarId",
  ]);
  const periodMonths = integer(
    s.periodMonths,
    "terms.schedule.periodMonths",
    1,
  );
  if (periodMonths > 12 || 12 % periodMonths !== 0) {
    throw new BondTermsError("terms.schedule.periodMonths", "must divide 12");
  }

  const rounding = object(t.rounding, "terms.rounding", [
    "moneyDecimals",
    "mode",
  ]);
  const source = object(t.source, "terms.source", [
    "provider",
    "url",
    "document",
  ]);

  const terms: BondTerms = {
    schemaVersion: 1,
    instrument: {
      issuerCountryCode: code(
        i.issuerCountryCode,
        "terms.instrument.issuerCountryCode",
        /^[A-Z]{2}$/,
      ),
      issuerCode: text(i.issuerCode, "terms.instrument.issuerCode"),
      programCode: text(i.programCode, "terms.instrument.programCode"),
      seriesCode: text(i.seriesCode, "terms.instrument.seriesCode"),
      currency: code(i.currency, "terms.instrument.currency", /^[A-Z]{3}$/),
      marketability: oneOf(i.marketability, "terms.instrument.marketability", [
        "RETAIL_REDEEMABLE",
      ] as const),
      faceValue,
    },
    saleWindow: nullable(t.saleWindow, (v) => {
      const w = object(v, "terms.saleWindow", ["from", "to"]);
      const from = date(w.from, "terms.saleWindow.from");
      const to = date(w.to, "terms.saleWindow.to");
      if (from > to)
        throw new BondTermsError("terms.saleWindow", "from is after to");
      return { from, to };
    }),
    schedule: {
      anchor: oneOf(s.anchor, "terms.schedule.anchor", [
        "LOT_PURCHASE_DATE",
      ] as const),
      periodMonths,
      periodCount: integer(s.periodCount, "terms.schedule.periodCount", 1),
      rollDay: oneOf(s.rollDay, "terms.schedule.rollDay", [
        "ANCHOR_DAY_CLAMPED",
      ] as const),
      calendarId: text(s.calendarId, "terms.schedule.calendarId"),
    },
    accrual: {
      type: primitive(t.accrual, "terms.accrual", [
        "ACTUAL_DAYS_IN_PERIOD",
      ] as const),
    },
    principalRule: {
      type: primitive(t.principalRule, "terms.principalRule", [
        "FIXED_NOMINAL",
      ] as const),
    },
    rateRule: parseRateRule(t.rateRule, "terms.rateRule"),
    capitalization: parseCapitalization(
      t.capitalization,
      "terms.capitalization",
    ),
    redemption: parseRedemption(t.redemption, "terms.redemption"),
    rounding: {
      moneyDecimals: exact(
        rounding.moneyDecimals,
        "terms.rounding.moneyDecimals",
        2,
      ),
      mode: exact(rounding.mode, "terms.rounding.mode", "HALF_UP"),
    },
    source: {
      provider: text(source.provider, "terms.source.provider"),
      url: text(source.url, "terms.source.url"),
      document: text(source.document, "terms.source.document"),
    },
  };
  object(t.accrual, "terms.accrual", ["type"]);
  object(t.principalRule, "terms.principalRule", ["type"]);
  assertConsistent(terms);
  return terms;
}

/** Generic consistency between primitives, never a per-product rule. */
function assertConsistent(terms: BondTerms): void {
  const { redemption, capitalization } = terms;
  if (
    redemption.type === "ON_DEMAND" &&
    capitalization.type !== "NONE" &&
    redemption.blackouts.length > 0
  ) {
    throw new BondTermsError(
      "terms.redemption.blackouts",
      "a record day exists only for a bond that pays a coupon (capitalization NONE)",
    );
  }
}
