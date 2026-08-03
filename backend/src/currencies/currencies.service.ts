import {
  Injectable,
  Logger,
  ConflictException,
  NotFoundException,
  ForbiddenException,
  OnApplicationBootstrap,
} from "@nestjs/common";
import { tr } from "../i18n/translate";
import { DataSource, EntityManager } from "typeorm";
import { withScopedDb } from "../common/db/scoped-db";
import { withSystemContext } from "../common/db/with-context";
import { withElevatedDb } from "../common/db/elevated-db";
import { Currency } from "./entities/currency.entity";
import { UserCurrencyPreference } from "./entities/user-currency-preference.entity";
import { CreateCurrencyDto } from "./dto/create-currency.dto";
import { UpdateCurrencyDto } from "./dto/update-currency.dto";
import {
  CURRENCY_METADATA,
  resolveCurrencyMetadata,
  getCurrencyCatalog,
  type CurrencyMetadata,
} from "./currency-metadata";

export interface CurrencyLookupResult {
  code: string;
  name: string;
  symbol: string;
  decimalPlaces: number;
}

export interface CurrencyUsageMap {
  [code: string]: { accounts: number; securities: number };
}

export interface UserCurrencyView {
  code: string;
  name: string;
  symbol: string;
  decimalPlaces: number;
  isActive: boolean;
  isSystem: boolean;
  createdAt: Date;
}

// The currency every new user's preferences default to (see
// buildDefaultPreferences). It must exist because user_preferences.default_currency
// has a foreign key to currencies(code).
const DEFAULT_CURRENCY_CODE = "USD";

@Injectable()
export class CurrenciesService implements OnApplicationBootstrap {
  private readonly logger = new Logger(CurrenciesService.name);

  constructor(private dataSource: DataSource) {}

  /**
   * Currencies are created on demand rather than pre-seeded, but a brand-new
   * instance still needs the default-preference currency to exist: registration
   * writes user_preferences.default_currency = 'USD', which has a foreign key to
   * currencies(code). Guarantee that single currency on startup so the first
   * user can register before anyone picks a currency at onboarding. Idempotent.
   *
   * RLS: this is a bootstrap hook, so there is no request/user context for
   * `withScopedDb` to spend -- and the row it writes is a system currency owned
   * by nobody. It runs under `withSystemContext`, like the seeders (C3).
   */
  async onApplicationBootstrap(): Promise<void> {
    try {
      await withSystemContext(() =>
        this.ensureSystemCurrency(DEFAULT_CURRENCY_CODE),
      );
    } catch (err) {
      this.logger.warn(
        `Could not ensure default currency ${DEFAULT_CURRENCY_CODE} on startup: ${err?.message ?? err}`,
      );
    }
  }

  async create(
    userId: string,
    dto: CreateCurrencyDto,
  ): Promise<UserCurrencyView> {
    const code = dto.code.toUpperCase();

    // One transaction: every branch below is "look, then insert", so splitting
    // the read from the write would let a concurrent request slip between them.
    return withScopedDb(this.dataSource, async (manager) =>
      this.createWithin(manager, userId, dto, code),
    );
  }

  private async createWithin(
    manager: EntityManager,
    userId: string,
    dto: CreateCurrencyDto,
    code: string,
  ): Promise<UserCurrencyView> {
    const currencyRepo = manager.getRepository(Currency);

    const existing = await currencyRepo.findOne({
      where: { code },
    });

    if (existing) {
      // Check if this user already has this currency in their list
      const existingPref = await manager
        .getRepository(UserCurrencyPreference)
        .findOne({
          where: { userId, currencyCode: code },
        });
      if (existingPref) {
        // Distinguish an already-active currency from one the user previously
        // deactivated: the inactive case ships a machine-readable `errorCode`
        // so the UI can offer to reactivate it instead of leaving the user
        // stuck (the currency is hidden from their active list).
        if (!existingPref.isActive) {
          throw new ConflictException({
            message: tr(
              "errors.currencies.alreadyInListInactive",
              `Currency "${code}" is already in your list but currently inactive. Reactivate it to use it.`,
              { code },
            ),
            errorCode: "CURRENCY_INACTIVE",
            currencyCode: code,
          });
        }
        throw new ConflictException(
          tr(
            "errors.currencies.alreadyInList",
            `Currency "${code}" is already in your list`,
            { code },
          ),
        );
      }

      // Add preference row so user can see/use the existing currency
      await manager.query(
        `INSERT INTO user_currency_preferences (user_id, currency_code, is_active)
         VALUES ($1, $2, true)
         ON CONFLICT (user_id, currency_code) DO NOTHING`,
        [userId, code],
      );

      return this.buildUserCurrencyView(existing, true);
    }

    // Currency doesn't exist — create it as a user-created currency
    const currency = currencyRepo.create({
      ...dto,
      code,
      decimalPlaces: dto.decimalPlaces ?? 2,
      isActive: true,
      createdByUserId: userId,
    });
    await currencyRepo.save(currency);

    // Add preference row for the creator
    await manager.query(
      `INSERT INTO user_currency_preferences (user_id, currency_code, is_active)
       VALUES ($1, $2, true)
       ON CONFLICT (user_id, currency_code) DO NOTHING`,
      [userId, code],
    );

    return this.buildUserCurrencyView(currency, true);
  }

  async findAll(
    userId: string,
    includeInactive = false,
  ): Promise<UserCurrencyView[]> {
    let query = `
      SELECT c.code, c.name, c.symbol,
             c.decimal_places AS "decimalPlaces",
             COALESCE(ucp.is_active, c.is_active) AS "isActive",
             (c.created_by_user_id IS NULL) AS "isSystem",
             c.created_at AS "createdAt"
      FROM currencies c
      LEFT JOIN user_currency_preferences ucp
        ON ucp.currency_code = c.code AND ucp.user_id = $1
      WHERE (c.created_by_user_id IS NULL OR ucp.user_id IS NOT NULL)`;

    if (!includeInactive) {
      query += ` AND COALESCE(ucp.is_active, c.is_active) = true`;
    }

    query += ` ORDER BY c.code ASC`;

    // One transaction around the whole block: the lazy-create fallback re-runs
    // the same query and must see the row it just wrote. The nested
    // `ensureSystemCurrency` joins this transaction (scoped-db re-entrancy).
    return withScopedDb(this.dataSource, async (manager) => {
      const rows: UserCurrencyView[] = await manager.query(query, [userId]);

      // A fresh instance no longer pre-seeds a list of currencies; the user's
      // chosen currency is created when they pick it at onboarding. If they
      // skipped onboarding this list is empty on first use, so lazily create
      // their default-preference currency (with a proper symbol) here.
      if (rows.length === 0) {
        const prefRows: Array<{ default_currency: string | null }> =
          await manager.query(
            `SELECT default_currency FROM user_preferences WHERE user_id = $1`,
            [userId],
          );
        const defaultCurrency = prefRows[0]?.default_currency;
        if (defaultCurrency) {
          await this.ensureSystemCurrency(defaultCurrency);
          return manager.query(query, [userId]);
        }
      }

      return rows;
    });
  }

  /**
   * The catalog of known currencies (curated metadata) used to populate the
   * onboarding picker without pre-seeding every currency into the database.
   */
  getCatalog(): CurrencyLookupResult[] {
    return getCurrencyCatalog();
  }

  /**
   * Ensure a system currency row exists for `code`, creating it from the
   * curated/derived metadata (name, symbol, decimal places) when missing.
   * Idempotent and safe to call on every default-currency change. Used so we
   * create a currency on demand -- with a real symbol -- instead of seeding a
   * whole list up front.
   */
  async ensureSystemCurrency(code: string): Promise<void> {
    const upper = code.toUpperCase();
    await withScopedDb(this.dataSource, async (manager) => {
      const existing = await manager.getRepository(Currency).findOne({
        where: { code: upper },
      });
      if (existing) return;

      const meta = resolveCurrencyMetadata(upper);
      await manager.query(
        `INSERT INTO currencies (code, name, symbol, decimal_places, is_active, created_by_user_id)
       VALUES ($1, $2, $3, $4, true, NULL)
       ON CONFLICT (code) DO NOTHING`,
        [upper, meta.name, meta.symbol, meta.decimalPlaces],
      );
    });
  }

  async findOne(code: string): Promise<Currency> {
    const currency = await withScopedDb(this.dataSource, (manager) =>
      manager.getRepository(Currency).findOne({
        where: { code: code.toUpperCase() },
      }),
    );
    if (!currency) {
      throw new NotFoundException(
        tr("errors.currencies.notFound", `Currency "${code}" not found`, {
          code,
        }),
      );
    }
    return currency;
  }

  async update(
    userId: string,
    code: string,
    dto: UpdateCurrencyDto,
  ): Promise<UserCurrencyView> {
    // Read-modify-write: the ownership check, the metadata save and the
    // preference upsert are one unit. Nested calls join this transaction.
    return withScopedDb(this.dataSource, (manager) =>
      this.updateWithin(manager, userId, code, dto),
    );
  }

  private async updateWithin(
    manager: EntityManager,
    userId: string,
    code: string,
    dto: UpdateCurrencyDto,
  ): Promise<UserCurrencyView> {
    const currency = await this.findOne(code);

    // System currencies: cannot modify metadata
    if (currency.createdByUserId === null) {
      throw new ForbiddenException(
        tr(
          "errors.currencies.cannotModifySystem",
          "Cannot modify system currency metadata",
        ),
      );
    }

    // Non-system currencies: only the creator can modify metadata
    if (currency.createdByUserId !== userId) {
      throw new ForbiddenException(
        tr(
          "errors.currencies.cannotModifyOther",
          "Cannot modify another user's currency",
        ),
      );
    }

    // Handle isActive separately via preference row
    const { isActive, ...metadataUpdates } = dto;

    if (Object.keys(metadataUpdates).length > 0) {
      Object.assign(currency, metadataUpdates);
      await manager.getRepository(Currency).save(currency);
    }

    if (isActive !== undefined) {
      await this.upsertPreference(userId, currency.code, isActive);
    }

    const pref = await manager.getRepository(UserCurrencyPreference).findOne({
      where: { userId, currencyCode: currency.code },
    });

    return this.buildUserCurrencyView(
      currency,
      pref ? pref.isActive : currency.isActive,
    );
  }

  async deactivate(userId: string, code: string): Promise<UserCurrencyView> {
    const currency = await this.findOne(code);
    await this.upsertPreference(userId, currency.code, false);
    return this.buildUserCurrencyView(currency, false);
  }

  async activate(userId: string, code: string): Promise<UserCurrencyView> {
    const currency = await this.findOne(code);
    await this.upsertPreference(userId, currency.code, true);
    return this.buildUserCurrencyView(currency, true);
  }

  async remove(userId: string, code: string): Promise<void> {
    // The in-use checks and the two deletes are one read-modify-write: a
    // concurrent account referencing the currency between them would strand a
    // foreign key. Nested calls join this transaction.
    await withScopedDb(this.dataSource, (manager) =>
      this.removeWithin(manager, userId, code),
    );
  }

  private async removeWithin(
    manager: EntityManager,
    userId: string,
    code: string,
  ): Promise<void> {
    const upperCode = code.toUpperCase();
    const currency = await this.findOne(upperCode);

    // Check if in use by this user
    const inUse = await this.isInUse(userId, upperCode);
    if (inUse) {
      throw new ConflictException(
        tr(
          "errors.currencies.inUse",
          `Currency "${code}" is in use by your accounts, securities, or other records. Deactivate it instead.`,
          { code },
        ),
      );
    }

    const prefRepo = manager.getRepository(UserCurrencyPreference);

    // Remove this user's preference row
    await prefRepo.delete({
      userId,
      currencyCode: upperCode,
    });

    // Removing the shared `currencies` row is a separate, privileged act from
    // removing the caller's own preference, and it needs two things the previous
    // implementation did not have (P2-009):
    //
    // 1. Authorization. `currencies` is global reference data with no owner, and
    //    `created_by_user_id` is attribution -- but attribution is exactly the
    //    right authority for deletion, and there was no check at all, so any user
    //    who had merely activated a custom code could delete it out from under
    //    the person who created it.
    // 2. A genuinely global reference count. The "remaining preferences" count
    //    and the account/security/transaction probes ran in the caller's own
    //    scoped transaction, so under RLS they see only the caller's rows and
    //    report zero while another tenant is still using the code. The shared row
    //    then went away, and `user_currency_preferences.currency_code REFERENCES
    //    currencies(code) ON DELETE CASCADE` deleted that tenant's preference
    //    with it -- a cross-tenant write decided by a tenant-filtered read.
    //
    // Both checks and the DELETE stay in one transaction: a second transaction
    // for the count lets a concurrent user activate the code in between, and the
    // FK would then either strand or cascade.
    if (currency.createdByUserId === null) {
      // System currency: shared by everyone, never removed by a user request.
      return;
    }
    if (currency.createdByUserId !== userId) {
      // Not ours to retire. The caller's own preference is already gone, which
      // is the whole of what they asked for from their own point of view.
      return;
    }

    const stillReferenced = await withElevatedDb(
      manager,
      "count every tenant's references to a shared currency code before deleting it",
      async (elevated) => this.isReferencedByAnyone(elevated, upperCode),
    );
    if (!stillReferenced) {
      await manager.getRepository(Currency).remove(currency);
    }
  }

  /**
   * Whether ANY user still references `code` -- preferences included.
   *
   * Must run elevated: every table below is RLS-policied per user, so in an
   * ordinary tenant transaction this returns "no" for a code another tenant is
   * using. The caller supplies the elevated manager so the answer and the DELETE
   * it authorizes share one transaction.
   *
   * `user_currency_preferences` is part of the union, not a separate count: it is
   * the table the FK cascades into, so a preference row is exactly the reference
   * that must block the delete.
   */
  private async isReferencedByAnyone(
    manager: EntityManager,
    code: string,
  ): Promise<boolean> {
    const result = await manager.query(
      `SELECT EXISTS (
        SELECT 1 FROM user_currency_preferences WHERE currency_code = $1
        UNION ALL SELECT 1 FROM accounts WHERE currency_code = $1
        UNION ALL SELECT 1 FROM securities WHERE currency_code = $1
        UNION ALL SELECT 1 FROM transactions
          WHERE currency_code = $1 OR original_currency_code = $1
        UNION ALL SELECT 1 FROM scheduled_transactions
          WHERE currency_code = $1 OR original_currency_code = $1
        UNION ALL SELECT 1 FROM user_preferences WHERE default_currency = $1
      ) AS "inUse"`,
      [code.toUpperCase()],
    );
    return result[0]?.inUse === true;
  }

  async isInUse(userId: string, code: string): Promise<boolean> {
    const result = await withScopedDb(this.dataSource, (manager) =>
      manager.query(
        `SELECT EXISTS (
        SELECT 1 FROM accounts WHERE currency_code = $1 AND user_id = $2
        UNION ALL SELECT 1 FROM securities WHERE currency_code = $1 AND user_id = $2
        UNION ALL SELECT 1 FROM transactions t
          JOIN accounts a ON a.id = t.account_id
          WHERE (t.currency_code = $1 OR t.original_currency_code = $1)
            AND a.user_id = $2
        UNION ALL SELECT 1 FROM scheduled_transactions st
          WHERE (st.currency_code = $1 OR st.original_currency_code = $1)
            AND st.user_id = $2
        UNION ALL SELECT 1 FROM user_preferences WHERE default_currency = $1 AND user_id = $2
      ) AS "inUse"`,
        [code.toUpperCase(), userId],
      ),
    );
    return result[0]?.inUse === true;
  }

  async getUsage(userId: string): Promise<CurrencyUsageMap> {
    const rows: Array<{
      code: string;
      accounts: string;
      securities: string;
    }> = await withScopedDb(this.dataSource, (manager) =>
      manager.query(
        `SELECT c.code,
        COALESCE(a.cnt, 0)::text AS accounts,
        COALESCE(s.cnt, 0)::text AS securities
      FROM currencies c
      LEFT JOIN user_currency_preferences ucp
        ON ucp.currency_code = c.code AND ucp.user_id = $1
      LEFT JOIN (
        SELECT currency_code, COUNT(*) AS cnt
        FROM accounts WHERE is_closed = false AND user_id = $1
        GROUP BY currency_code
      ) a ON a.currency_code = c.code
      LEFT JOIN (
        SELECT currency_code, COUNT(*) AS cnt
        FROM securities WHERE is_active = true AND user_id = $1
        GROUP BY currency_code
      ) s ON s.currency_code = c.code
      WHERE c.created_by_user_id IS NULL OR ucp.user_id IS NOT NULL`,
        [userId],
      ),
    );

    const usage: CurrencyUsageMap = {};
    for (const row of rows) {
      usage[row.code] = {
        accounts: parseInt(row.accounts, 10),
        securities: parseInt(row.securities, 10),
      };
    }
    return usage;
  }

  async lookupCurrency(query: string): Promise<CurrencyLookupResult | null> {
    const trimmed = query.trim();
    if (trimmed.length < 2) return null;

    try {
      // 1. Check if query matches a currency code directly
      const upperQuery = trimmed.toUpperCase();
      const directMetadata = CURRENCY_METADATA[upperQuery];
      if (directMetadata) {
        return this.verifyAndReturnCurrency(upperQuery, directMetadata);
      }

      // 2. Search our metadata by name (handles country names, currency names, etc.)
      const metadataMatch = this.searchMetadataByText(trimmed);
      if (metadataMatch) {
        return this.verifyAndReturnCurrency(
          metadataMatch.code,
          metadataMatch.metadata,
        );
      }

      // 3. Fall back to Yahoo Finance search API for unknown currencies
      const searchUrl = `https://query1.finance.yahoo.com/v1/finance/search?q=${encodeURIComponent(trimmed)}&quotesCount=20&newsCount=0`;
      const searchResponse = await fetch(searchUrl, {
        headers: {
          "User-Agent":
            "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36",
        },
      });

      if (!searchResponse.ok) {
        this.logger.warn(
          `Yahoo Finance search returned ${searchResponse.status} for currency query: ${query}`,
        );
        return null;
      }

      const searchData = await searchResponse.json();
      const quotes = searchData.quotes || [];

      // Find currency-type results (forex pairs like EURUSD=X)
      const currencyQuotes = quotes.filter(
        (q: any) =>
          q.quoteType === "CURRENCY" || (q.symbol && q.symbol.includes("=X")),
      );

      if (currencyQuotes.length === 0) {
        return null;
      }

      // Extract the currency code from the first forex pair result
      const firstResult = currencyQuotes[0];
      const resultCode = this.extractCurrencyCode(
        firstResult.symbol,
        upperQuery,
      );

      const resultMetadata = CURRENCY_METADATA[resultCode];

      return {
        code: resultCode,
        name: resultMetadata?.name || resultCode,
        symbol: resultMetadata?.symbol || resultCode,
        decimalPlaces: resultMetadata?.decimalPlaces ?? 2,
      };
    } catch (error) {
      this.logger.error(`Failed to lookup currency: ${error.message}`);
      return null;
    }
  }

  // ── Private helpers ─────────────────────────────────────────────

  private async upsertPreference(
    userId: string,
    code: string,
    isActive: boolean,
  ): Promise<void> {
    await withScopedDb(this.dataSource, (manager) =>
      manager.query(
        `INSERT INTO user_currency_preferences (user_id, currency_code, is_active)
       VALUES ($1, $2, $3)
       ON CONFLICT (user_id, currency_code)
       DO UPDATE SET is_active = $3`,
        [userId, code.toUpperCase(), isActive],
      ),
    );
  }

  private buildUserCurrencyView(
    currency: Currency,
    isActive: boolean,
  ): UserCurrencyView {
    return {
      code: currency.code,
      name: currency.name,
      symbol: currency.symbol,
      decimalPlaces: currency.decimalPlaces,
      isActive,
      isSystem: currency.createdByUserId === null,
      createdAt: currency.createdAt,
    };
  }

  /**
   * Search CURRENCY_METADATA entries by name text (case-insensitive substring match).
   * Supports queries like "Malaysia", "Ringgit", "Canadian Dollar", "Japan", etc.
   */
  private searchMetadataByText(
    query: string,
  ): { code: string; metadata: CurrencyMetadata } | null {
    const lowerQuery = query.toLowerCase();

    // Exact name match first
    for (const [code, meta] of Object.entries(CURRENCY_METADATA)) {
      if (meta.name.toLowerCase() === lowerQuery) {
        return { code, metadata: meta };
      }
    }

    // Substring match (e.g., "Ringgit" matches "Malaysian Ringgit")
    const matches: Array<{
      code: string;
      metadata: CurrencyMetadata;
    }> = [];
    for (const [code, meta] of Object.entries(CURRENCY_METADATA)) {
      if (meta.name.toLowerCase().includes(lowerQuery)) {
        matches.push({ code, metadata: meta });
      }
    }

    return matches.length === 1 ? matches[0] : null;
  }

  /**
   * Verify a currency exists on Yahoo Finance and return our metadata name.
   */
  private async verifyAndReturnCurrency(
    code: string,
    metadata: CurrencyMetadata,
  ): Promise<CurrencyLookupResult> {
    try {
      const yahooSymbol = `${code}USD=X`;
      const url = `https://query1.finance.yahoo.com/v8/finance/chart/${encodeURIComponent(yahooSymbol)}?interval=1d&range=1d`;
      const response = await fetch(url, {
        headers: {
          "User-Agent":
            "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36",
        },
      });

      if (response.ok) {
        // Verified on Yahoo - use our metadata name (not Yahoo's forex pair name)
        return {
          code,
          name: metadata.name,
          symbol: metadata.symbol,
          decimalPlaces: metadata.decimalPlaces,
        };
      }
    } catch (err) {
      this.logger.debug(
        `Yahoo verification failed for ${code}, falling back to local metadata: ${err instanceof Error ? err.message : err}`,
      );
    }

    return {
      code,
      name: metadata.name,
      symbol: metadata.symbol,
      decimalPlaces: metadata.decimalPlaces,
    };
  }

  /**
   * Extract a currency code from a Yahoo Finance forex symbol like "EURUSD=X"
   */
  private extractCurrencyCode(symbol: string, originalQuery: string): string {
    // Remove =X suffix
    const pair = symbol.replace("=X", "");
    // Forex pairs are 6 chars: EURUSD -> EUR + USD
    if (pair.length === 6) {
      const base = pair.substring(0, 3);
      const quote = pair.substring(3, 6);
      // Return whichever part matches the query
      const upperQuery = originalQuery.toUpperCase();
      if (base === upperQuery) return base;
      if (quote === upperQuery) return quote;
      return base; // Default to base currency
    }
    return originalQuery.toUpperCase();
  }
}
