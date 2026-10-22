import { Injectable } from "@nestjs/common";
import { DataSource } from "typeorm";
import { withScopedDb } from "../common/db/scoped-db";
import { UserPreference } from "../users/entities/user-preference.entity";
import { ExchangeRateService } from "../currencies/exchange-rate.service";
import { convertWithRateLookup } from "../common/currency-conversion.util";
import { preferredCurrency } from "../common/default-currency.util";

export interface RawCategoryAggregate {
  category_id: string | null;
  currency_code: string;
  total: string;
}

export interface RawPayeeAggregate {
  payee_id: string | null;
  payee_name: string | null;
  currency_code: string;
  total: string;
}

export interface RawMonthlyAggregate {
  month: string;
  currency_code: string;
  income: string;
  expenses: string;
}

/** One income/expense bucket, keyed by the date the bucket opens. */
export interface RawPeriodAggregate {
  period_start: string;
  currency_code: string;
  income: string;
  expenses: string;
}

export interface RawMonthlyCategoryAggregate {
  month: string;
  category_id: string | null;
  currency_code: string;
  total: string;
}

export type RateMap = Map<string, number>;

@Injectable()
export class ReportCurrencyService {
  constructor(
    private dataSource: DataSource,
    private exchangeRateService: ExchangeRateService,
  ) {}

  async getDefaultCurrency(userId: string): Promise<string> {
    const pref = await withScopedDb(this.dataSource, (m) =>
      m.getRepository(UserPreference).findOne({
        where: { userId },
      }),
    );
    return preferredCurrency(pref);
  }

  async buildRateMap(_defaultCurrency: string): Promise<RateMap> {
    const rates = await this.exchangeRateService.getLatestRates();
    const rateMap: RateMap = new Map();
    for (const rate of rates) {
      rateMap.set(
        `${rate.fromCurrency}->${rate.toCurrency}`,
        Number(rate.rate),
      );
    }
    return rateMap;
  }

  /**
   * Convert, or answer `null` when there is no rate.
   *
   * The only conversion door a report has. A missing rate is unknown, never 1:1
   * and never the unconverted amount under the reporting currency's name
   * (INV-FX-001): the caller excludes the row from every figure and records the
   * currency in a {@link ConversionGaps}.
   */
  tryConvertAmount(
    amount: number,
    fromCurrency: string,
    defaultCurrency: string,
    rateMap: RateMap,
  ): number | null {
    // Flat latest-rate lookup; the direct/inverse decision is shared with
    // net worth via convertWithRateLookup so the two surfaces stay consistent.
    return convertWithRateLookup(
      amount,
      fromCurrency,
      defaultCurrency,
      (f, t) => rateMap.get(`${f}->${t}`),
    );
  }
}

/**
 * What a report could not convert, kept apart from the arithmetic so every
 * report answers the same two questions the same way: which currencies had no
 * rate, and how many aggregate rows that cost.
 *
 * An excluded row is not a smaller number: it could have changed which
 * categories, payees or bills appear at all. So a headline total is withheld
 * (`null`) whenever anything was excluded, and the part that did convert goes in
 * a separately named `known*` field.
 */
export class ConversionGaps {
  private currencies: readonly string[] = [];
  private excluded = 0;

  /** Record one aggregate row left out because `currency` has no rate. */
  record(currency: string): void {
    if (!this.currencies.includes(currency)) {
      this.currencies = [...this.currencies, currency];
    }
    this.excluded += 1;
  }

  /** Source currencies with no usable rate, sorted and unique. */
  get missingCurrencies(): string[] {
    return [...this.currencies].sort();
  }

  get excludedCount(): number {
    return this.excluded;
  }

  get isComplete(): boolean {
    return this.excluded === 0;
  }

  /** The headline total, or `null` when any row was excluded. */
  headline(knownTotal: number): number | null {
    return this.isComplete ? knownTotal : null;
  }
}
