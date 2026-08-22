import { TestingModule } from "@nestjs/testing";
import { DataSource } from "typeorm";
import { AccountsModule } from "@/accounts/accounts.module";
import { NetWorthService } from "@/net-worth/net-worth.service";
import {
  createIntegrationModule,
  cleanTables,
  createTestUserDirect,
} from "../helpers/integration-setup";

/**
 * MZ-1242-R5 -- crash recovery for a manual-price snapshot invalidation.
 *
 * A manual price moves no account balance, so the only durable signal that the
 * derived `monthly_account_balances` snapshot is stale is the `accounts.updated_at`
 * marker the write path advances in the same transaction as the price. The
 * stale-snapshot sweep is what turns that marker into a recompute when the
 * in-process debounce timer is lost (a pod killed in the two-second window).
 *
 * The property under test is that the sweep actually fires for the exact shape a
 * manual price produces: an account whose row changed only a little after its
 * snapshot, but long enough ago that the debounce plainly did not run. The old
 * predicate (`a.updated_at > s.computed_at + grace`) never fired for that shape,
 * so a lost recompute was permanently invisible; the corrected predicate
 * (`a.updated_at > s.computed_at AND a.updated_at <= NOW() - grace`) recovers it.
 *
 * A mocked `manager.query` cannot prove this -- the defect lives in the timestamp
 * arithmetic PostgreSQL evaluates -- so this is a real-database test.
 * `createIntegrationModule` already stubs `triggerDebouncedRecalc` to a no-op,
 * which is exactly the "debounce lost" condition; recovery must come from the
 * sweep alone.
 */
describe("manual-price stale-snapshot crash recovery (integration, MZ-1242-R5)", () => {
  let module: TestingModule;
  let netWorth: NetWorthService;
  let dataSource: DataSource;
  let userId: string;
  let accountId: string;
  let securityId: string;

  const QUANTITY = 120;
  const TRANSACTION_PRICE = 61; // the pre-#1242 valuation basis
  const MANUAL_PRICE = 120; // the accepted correction
  const STALE_MARKET_VALUE = QUANTITY * TRANSACTION_PRICE; // 7,320
  const EXPECTED_MARKET_VALUE = QUANTITY * MANUAL_PRICE; // 14,400

  beforeAll(async () => {
    module = await createIntegrationModule([AccountsModule]);
    netWorth = module.get(NetWorthService);
    dataSource = module.get(DataSource);
  });

  afterAll(async () => {
    await module.close();
  });

  beforeEach(async () => {
    await cleanTables(dataSource, [
      "monthly_account_balances",
      "investment_transactions",
      "security_prices",
      "securities",
      "accounts",
      "user_preferences",
      "currencies",
      "users",
    ]);

    const user = await createTestUserDirect(dataSource);
    userId = user.id;

    await dataSource.query(
      `INSERT INTO currencies (code, name, symbol, created_by_user_id)
       VALUES ('USD', 'US Dollar', '$', $1)`,
      [userId],
    );

    // A brokerage account whose row was last touched 19 minutes ago -- one
    // minute after its snapshot. The updated_at trigger fires BEFORE UPDATE
    // only, so an explicit value on INSERT stands.
    const accountRows = await dataSource.query(
      `INSERT INTO accounts (user_id, account_type, account_sub_type, name,
                             currency_code, current_balance, opening_balance,
                             created_at, updated_at)
       VALUES ($1, 'INVESTMENT', 'INVESTMENT_BROKERAGE', 'Sample Retirement Plan',
               'USD', 0, 0, NOW() - INTERVAL '2 days', NOW() - INTERVAL '19 minutes')
       RETURNING id`,
      [userId],
    );
    accountId = accountRows[0].id;

    const securityRows = await dataSource.query(
      `INSERT INTO securities (user_id, symbol, name, currency_code,
                              skip_price_updates)
       VALUES ($1, 'BMT-DEMO', 'Broad Market Tracker', 'USD', true)
       RETURNING id`,
      [userId],
    );
    securityId = securityRows[0].id;

    // 120 shares bought in 2024 at $61 -- the transaction basis the pre-fix
    // snapshot was computed from.
    await dataSource.query(
      `INSERT INTO investment_transactions
         (user_id, account_id, security_id, action, transaction_date, quantity,
          price, total_amount, status)
       VALUES ($1, $2, $3, 'BUY', DATE '2024-01-15', $4, $5, $6, 'UNRECONCILED')`,
      [
        userId,
        accountId,
        securityId,
        QUANTITY,
        TRANSACTION_PRICE,
        QUANTITY * TRANSACTION_PRICE,
      ],
    );

    // The accepted manual correction: $120, dated today so it is the latest
    // close on or before every recent month end.
    await dataSource.query(
      `INSERT INTO security_prices (security_id, price_date, close_price, source)
       VALUES ($1, CURRENT_DATE, $2, 'manual')`,
      [securityId, MANUAL_PRICE],
    );

    // The stale snapshot computed 20 minutes ago under the old $61 basis.
    await dataSource.query(
      `INSERT INTO monthly_account_balances
         (user_id, account_id, month, balance, market_value, created_at, updated_at)
       VALUES ($1, $2, DATE_TRUNC('month', CURRENT_DATE)::date, 0, $3,
               NOW() - INTERVAL '20 minutes', NOW() - INTERVAL '20 minutes')`,
      [userId, accountId, STALE_MARKET_VALUE],
    );
  });

  it("rebuilds a manual-price snapshot the lost debounce never recomputed", async () => {
    // The debounce is stubbed to a no-op (createIntegrationModule), so this is
    // the crash case: only the sweep can recover the snapshot.
    await netWorth.sweepStaleSnapshots();

    const rows = await dataSource.query(
      `SELECT market_value
         FROM monthly_account_balances
        WHERE account_id = $1
        ORDER BY month DESC
        LIMIT 1`,
      [accountId],
    );
    // 120 shares * $120 accepted close = $14,400, not the stale 120 * $61.
    expect(Number(rows[0].market_value)).toBe(EXPECTED_MARKET_VALUE);
  });
});
