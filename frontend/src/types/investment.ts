import { Tag } from './tag';

export type InvestmentAction =
  | 'BUY'
  | 'SELL'
  | 'DIVIDEND'
  | 'INTEREST'
  | 'CAPITAL_GAIN'
  | 'SPLIT'
  | 'TRANSFER_IN'
  | 'TRANSFER_OUT'
  | 'REINVEST'
  | 'ADD_SHARES'
  | 'REMOVE_SHARES';

export type QuoteProviderName = 'yahoo' | 'msn';

export interface Security {
  id: string;
  symbol: string;
  name: string;
  securityType: string | null;
  exchange: string | null;
  currencyCode: string;
  description?: string | null;
  tags?: Tag[];
  isActive: boolean;
  isFavourite: boolean;
  skipPriceUpdates: boolean;
  sector: string | null;
  industry: string | null;
  sectorWeightings: { sector: string; weight: number }[] | null;
  /** Manual ETF/fund country breakdown; weight is a decimal 0-1 (like sectorWeightings). */
  countryWeightings: { name: string; weight: number }[] | null;
  /** Manual ETF/fund asset-class breakdown (free-text names); weight is a decimal 0-1. */
  assetWeightings: { name: string; weight: number }[] | null;
  /** The issuer's or product's page; auto-filled from Yahoo for shares. */
  website: string | null;
  /** The investor-relations page; manual, no provider supplies one. */
  irWebsite: string | null;
  quoteProvider: QuoteProviderName | null;
  msnInstrumentId: string | null;
  /**
   * Where and when the instrument trades, as reported by the provider. The
   * session times are local to `marketTimezone` ("HH:mm:ss"). All three are
   * null until a price refresh reports them, and for providers that do not.
   */
  marketTimezone?: string | null;
  marketOpenTime?: string | null;
  marketCloseTime?: string | null;
  /** Source of the most recent price row for this security (e.g. "yahoo_finance", "msn_finance", "manual"), or null if no prices exist. */
  lastPriceSource?: string | null;
  createdAt: string;
  updatedAt: string;
}

export interface SectorWeightingItem {
  sector: string;
  directValue: number;
  etfValue: number;
  totalValue: number;
  percentage: number;
}

export interface SectorWeightingResult {
  items: SectorWeightingItem[];
  totalPortfolioValue: number;
  totalDirectValue: number;
  totalEtfValue: number;
  unclassifiedValue: number;
}

export interface CountryWeightingItem {
  country: string;
  directValue: number;
  etfValue: number;
  totalValue: number;
  percentage: number;
}

export interface CountryWeightingResult {
  items: CountryWeightingItem[];
  totalPortfolioValue: number;
  totalDirectValue: number;
  totalEtfValue: number;
  unclassifiedValue: number;
}

export interface AssetClassWeightingItem {
  assetClass: string;
  directValue: number;
  etfValue: number;
  totalValue: number;
  percentage: number;
}

export interface AssetClassWeightingResult {
  items: AssetClassWeightingItem[];
  totalPortfolioValue: number;
  totalDirectValue: number;
  totalEtfValue: number;
  /**
   * Value with no asset-class classification: fund value beyond the manual
   * weightings plus securities whose type says nothing definite. Rendered as
   * the "Other" slice.
   */
  unclassifiedValue: number;
}

export interface Holding {
  id: string;
  accountId: string;
  securityId: string;
  quantity: number;
  averageCost: number | null;
  security: Security;
  createdAt: string;
  updatedAt: string;
}

export interface HoldingWithMarketValue {
  id: string;
  accountId: string;
  securityId: string;
  symbol: string;
  name: string;
  securityType: string;
  currencyCode: string;
  quantity: number;
  averageCost: number;
  /** Cost basis in the security's native currency. */
  costBasis: number;
  /**
   * Cost basis in the holding account's currency, calculated using the
   * historical exchange rates stored on the original BUY transactions.
   */
  costBasisAccountCurrency: number | null;
  currentPrice: number | null;
  marketValue: number | null;
  gainLoss: number | null;
  gainLossPercent: number | null;
}

export interface AccountHoldings {
  accountId: string;
  accountName: string;
  currencyCode: string;
  cashAccountId: string | null;
  cashBalance: number;
  holdings: HoldingWithMarketValue[];
  // `null` when a holding in this account had no price, no establishable cost
  // basis, or no exchange rate to the account's currency.
  totalCostBasis: number | null;
  totalMarketValue: number | null;
  totalGainLoss: number | null;
  totalGainLossPercent: number | null;
  netInvested: number;
}

/**
 * Mirrors the backend `PortfolioSummary`. Every `total*` field is `null` when
 * any component of it is unknown -- an unpriced holding, a cost basis that
 * could not be established, or a currency pair with no exchange rate. A `0` is
 * a real zero (an empty portfolio is worth nothing, which is known), so the two
 * must not be conflated when rendering: see the "An unknown value must not
 * render as a measured zero" rule in `frontend/CLAUDE.md`.
 */
export interface PortfolioSummary {
  totalCashValue: number | null;
  totalHoldingsValue: number | null;
  totalCostBasis: number | null;
  totalNetInvested: number | null;
  totalPortfolioValue: number | null;
  totalGainLoss: number | null;
  totalGainLossPercent: number | null;
  timeWeightedReturn: number | null;
  cagr: number | null;
  holdings: HoldingWithMarketValue[];
  holdingsByAccount: AccountHoldings[];
  allocation: AllocationItem[];  // Included to avoid duplicate API call
  /** Currency pairs with no available rate, e.g. `["USD->CAD"]`. */
  unavailableFxPairs?: string[];
  /**
   * Sum of the holdings that could be valued. Show it only under a label that
   * says it is a partial figure -- never in place of a total.
   */
  knownHoldingsValueSubtotal?: number;
}

export interface AllocationItem {
  name: string;
  symbol: string | null;
  type: 'cash' | 'security' | 'tag' | 'untagged' | 'country' | 'assetClass' | 'other';
  value: number;
  percentage: number;
  color?: string;
  currencyCode?: string;
}

export interface AssetAllocation {
  allocation: AllocationItem[];
  /** `null` when the portfolio value could not be established. */
  totalValue: number | null;
}

export interface InvestmentTransaction {
  id: string;
  accountId: string;
  securityId: string | null;
  fundingAccountId: string | null;
  action: InvestmentAction;
  transactionDate: string;
  quantity: number | null;
  price: number | null;
  commission: number | null;
  totalAmount: number;
  exchangeRate: number;
  description: string | null;
  // Set on security-transfer legs; points at the paired TRANSFER_IN/OUT leg.
  linkedTransactionId: string | null;
  security: Security | null;
  fundingAccount: {
    id: string;
    name: string;
  } | null;
  createdAt: string;
  updatedAt: string;
}

export interface SecurityHistoryAccount {
  accountId: string;
  accountName: string;
  isClosed: boolean;
  currentQuantity: number;
}

export interface SecurityHistoryTransaction {
  id: string;
  transactionDate: string;
  accountId: string;
  accountName: string;
  action: InvestmentAction;
  quantity: number | null;
  price: number | null;
  commission: number;
  totalAmount: number;
  description: string | null;
  runningQuantityAccount: number;
  runningQuantityAll: number;
}

export interface SecurityTransactionHistory {
  securityId: string;
  symbol: string;
  name: string;
  currencyCode: string;
  isActive: boolean;
  accounts: SecurityHistoryAccount[];
  transactions: SecurityHistoryTransaction[];
  currentQuantityAll: number;
}

/**
 * The position in one account holding a security.
 *
 * Every amount is in the **security's own currency** -- what its price and
 * average cost are quoted in -- except `costBasisAccountCurrency`, which is the
 * portfolio's historical-rate conversion and is named for it. Nullable
 * throughout: a position held in a closed account, or a dust residual, is known
 * to exist from the transaction history but has no figures in the portfolio
 * calculation, and a zero there would be a claim rather than an absence.
 */
export interface SecurityDetailAccountPosition {
  accountId: string;
  accountName: string;
  accountCurrencyCode: string | null;
  isClosed: boolean;
  quantity: number;
  /** Average cost per unit, in the security's currency. */
  averageCost: number | null;
  costBasis: number | null;
  costBasisAccountCurrency: number | null;
  marketValue: number | null;
  gainLoss: number | null;
  gainLossPercent: number | null;
}

/**
 * The aggregate position across every account, for the summary cards. All
 * amounts are in the security's currency.
 */
export interface SecurityDetailPosition {
  quantity: number;
  averageCost: number | null;
  currentPrice: number | null;
  costBasis: number | null;
  marketValue: number | null;
  gainLoss: number | null;
  gainLossPercent: number | null;
}

/** Lifetime totals for the Position info card, in the security's currency. */
export interface SecurityDetailActivity {
  firstTransactionDate: string | null;
  lastTransactionDate: string | null;
  totalInvested: number;
  totalSold: number;
  dividends: number;
  fees: number;
  /**
   * Realized gain in `realizedGainCurrency` -- the holding account's currency,
   * which is how the canonical replay denominates it. Null when the security was
   * sold from accounts of more than one currency, because those gains cannot be
   * added into a single figure.
   */
  realizedGain: number | null;
  realizedGainCurrency: string | null;
  /** Currencies the security was sold from, for naming them when they differ. */
  realizedGainCurrencies: string[];
  /**
   * Sales the replay found. Distinguishes "never sold" (zero) from "sold across
   * currencies, so the gains cannot be added" -- both of which leave
   * `realizedGain` null.
   */
  realizedSaleCount: number;
  transactionCount: number;
}

/** One headline filed against a security. */
export interface SecurityNewsItem {
  id: string;
  title: string;
  publisher: string | null;
  link: string;
  /** ISO timestamp, or null when the provider gave none. */
  publishedAt: string | null;
  /** `STORY` or `VIDEO`. */
  type: string | null;
  /**
   * Path on our own API, never the publisher's CDN: the backend fetches the
   * image so the reader's browser does not have to contact a third party.
   */
  thumbnailUrl: string | null;
  /** Every symbol the item was filed under, which is more than just this one. */
  relatedTickers: string[];
}

export interface SecurityNewsResult {
  /**
   * Which provider supplied the headlines, or null when the security's quote
   * provider supplies none. Distinguishes "nothing published" from "cannot ask".
   */
  provider: 'yahoo' | 'msn' | null;
  items: SecurityNewsItem[];
}

/** The kinds of document a security can carry. Mirrors the backend enum. */
export const SECURITY_DOCUMENT_TYPES = [
  'FACTSHEET',
  'KIID',
  'PROSPECTUS',
  'ANNUAL_REPORT',
  'SEMI_ANNUAL_REPORT',
  'TAX',
  'RESEARCH',
  'OTHER',
] as const;

export type SecurityDocumentType = (typeof SECURITY_DOCUMENT_TYPES)[number];

/** A document recorded against a security. */
export interface SecurityDocument {
  id: string;
  securityId: string;
  documentType: SecurityDocumentType;
  name: string;
  /** The date on the document, not when it was recorded. Null where it has none. */
  documentDate: string | null;
  url: string;
  notes: string | null;
  createdAt: string;
  updatedAt: string;
}

export interface CreateSecurityDocumentData {
  documentType?: SecurityDocumentType;
  name: string;
  /**
   * Explicit `null` clears the stored date on an edit. `undefined` omits the
   * field, which on a PATCH means "leave it alone" -- the difference is what
   * makes clearing possible at all.
   */
  documentDate?: string | null;
  url: string;
  notes?: string | null;
}

export interface SecurityDetail {
  security: Security;
  position: SecurityDetailPosition;
  accounts: SecurityDetailAccountPosition[];
  activity: SecurityDetailActivity;
  hasTransactions: boolean;
  isPositionClosed: boolean;
}

export interface CreateInvestmentTransactionData {
  accountId: string;
  securityId?: string;
  fundingAccountId?: string;
  action: InvestmentAction;
  transactionDate: string;
  quantity?: number;
  price?: number;
  commission?: number;
  exchangeRate?: number;
  description?: string;
}

export interface TopMover {
  securityId: string;
  symbol: string;
  name: string;
  currencyCode: string;
  currentPrice: number;
  previousPrice: number;
  dailyChange: number;
  dailyChangePercent: number;
  marketValue: number | null;
}

export interface SecurityPrice {
  id: number;
  securityId: string;
  priceDate: string;
  openPrice: number | null;
  highPrice: number | null;
  lowPrice: number | null;
  closePrice: number;
  /**
   * Split- and dividend-adjusted close, i.e. the total-return series. Stored by
   * the backend from provider data and returned by the prices endpoint; null for
   * a security whose provider does not supply it (MSN today).
   *
   * Use it, falling back to `closePrice`, wherever a *return* is computed --
   * `COALESCE(adjusted_close, close_price)` is what the backend's own
   * calculations do. Keep `closePrice` for anything that shows the quote itself.
   */
  adjustedClose: number | null;
  volume: number | null;
  source: string | null;
  /**
   * The instant the provider says this quote was struck. Distinct from
   * `priceDate` (the calendar day) and from `createdAt` (when the row was
   * first written -- a same-day refresh updates it in place, so createdAt does
   * not advance). Null for manual entries, rows derived from transactions, and
   * anything stored before the column existed.
   */
  quotedAt: string | null;
  createdAt: string;
}

export interface CreateSecurityPriceData {
  priceDate: string;
  closePrice: number;
  openPrice?: number;
  highPrice?: number;
  lowPrice?: number;
  volume?: number;
}

export interface CreateSecurityData {
  symbol: string;
  name: string;
  securityType?: string;
  exchange?: string;
  currencyCode: string;
  description?: string;
  /** Empty string clears the stored address; the backend normalises the rest. */
  website?: string | null;
  irWebsite?: string | null;
  tagIds?: string[];
  quoteProvider?: QuoteProviderName | null;
  msnInstrumentId?: string;
  isFavourite?: boolean;
  /** Manual ETF/fund country breakdown; weight is a decimal 0-1 (like sectorWeightings). */
  countryWeightings?: { name: string; weight: number }[];
  /** Manual ETF/fund asset-class breakdown (free-text names); weight is a decimal 0-1. */
  assetWeightings?: { name: string; weight: number }[];
}

/** A favourite security decorated with its latest price and daily change. */
export interface FavouriteSecurityQuote {
  securityId: string;
  symbol: string;
  name: string;
  currencyCode: string;
  currentPrice: number | null;
  previousPrice: number | null;
  dailyChange: number;
  dailyChangePercent: number;
}

export interface InvestmentTransactionPaginationInfo {
  page: number;
  limit: number;
  total: number;
  totalPages: number;
  hasMore: boolean;
}

export interface PaginatedInvestmentTransactions {
  data: InvestmentTransaction[];
  pagination: InvestmentTransactionPaginationInfo;
}

export interface RealizedGainEntry {
  transactionId: string;
  transactionDate: string;
  accountId: string;
  accountName: string | null;
  accountCurrencyCode: string | null;
  securityId: string;
  symbol: string | null;
  securityName: string | null;
  securityCurrencyCode: string | null;
  quantity: number;
  price: number;
  commission: number;
  proceeds: number;
  costBasis: number;
  realizedGain: number;
}

/**
 * Per-(account, security, month) capital gain entry combining realized SELL
 * gains with the unrealized mark-to-market change on the position. All values
 * are in the holding account's currency.
 */
export interface CapitalGainEntry {
  month: string;
  accountId: string;
  accountName: string | null;
  accountCurrencyCode: string | null;
  securityId: string;
  symbol: string | null;
  securityName: string | null;
  securityCurrencyCode: string | null;
  startQuantity: number;
  endQuantity: number;
  startValue: number;
  endValue: number;
  buys: number;
  sells: number;
  realizedGain: number;
  unrealizedGain: number;
  totalCapitalGain: number;
}
