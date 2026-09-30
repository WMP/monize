import {
  BadRequestException,
  ConflictException,
  NotFoundException,
} from "@nestjs/common";
import { Test, TestingModule } from "@nestjs/testing";
import { DataSource } from "typeorm";
import { AccountsService } from "../accounts/accounts.service";
import { Account, AccountSubType } from "../accounts/entities/account.entity";
import { Payee } from "../payees/entities/payee.entity";
import { PayeesService } from "../payees/payees.service";
import { createScopedDbMocks } from "../test-helpers/scoped-db-testing";
import { TransactionRulesApplierService } from "../transaction-rules/transaction-rules-applier.service";
import {
  Transaction,
  TransactionStatus,
} from "../transactions/entities/transaction.entity";
import { RULES_BATCH_SIZE } from "./bank-sync.constants";
import {
  BankSyncWriteInput,
  BankSyncWriterService,
} from "./bank-sync-writer.service";
import {
  ACCOUNT_ID,
  bankAccountRow,
  BANK_ACCOUNT_ID,
  USER_ID,
} from "./bank-sync-testing";
import type {
  BankImportPlan,
  PlannedBankRow,
} from "./bank-transaction-planner";
import { BankSyncAccount } from "./entities/bank-sync-account.entity";

jest.mock("../common/db/scoped-db", () =>
  jest.requireActual("../test-helpers/scoped-db-testing").scopedDbMockModule(),
);

const emptyRefused = () => ({
  missing_date: 0,
  future_date: 0,
  invalid_amount: 0,
  unknown_direction: 0,
  currency_mismatch: 0,
});

function row(over: Partial<PlannedBankRow> = {}): PlannedBankRow {
  return {
    externalKey: "ref:1",
    transactionDate: "2026-09-10",
    amount: -12.34,
    payeeText: "Biedronka",
    description: "Groceries",
    referenceNumber: "REF-1",
    ...over,
  };
}

function plan(
  planned: PlannedBankRow[],
  over: Partial<BankImportPlan> = {},
): BankImportPlan {
  return {
    planned,
    refused: emptyRefused(),
    pending: 0,
    beforeCutoff: 0,
    ...over,
  };
}

describe("BankSyncWriterService", () => {
  const linkRepo = { findOne: jest.fn() };
  const accountRepo = { findOne: jest.fn() };
  const { manager, dataSource } = createScopedDbMocks([
    [BankSyncAccount, linkRepo],
    [Account, accountRepo],
  ]);
  const accountsService: jest.Mocked<
    Pick<AccountsService, "recalculateCurrentBalance">
  > = { recalculateCurrentBalance: jest.fn() };
  const rulesApplier: jest.Mocked<
    Pick<TransactionRulesApplierService, "loadRulesFor" | "applyToNew">
  > = { loadRulesFor: jest.fn(), applyToNew: jest.fn() };
  const payees: jest.Mocked<
    Pick<PayeesService, "findByName" | "findPayeeByAlias">
  > = { findByName: jest.fn(), findPayeeByAlias: jest.fn() };

  let service: BankSyncWriterService;
  let nextTransaction = 0;

  const account = (over: Partial<Account> = {}): Account =>
    ({
      id: ACCOUNT_ID,
      userId: USER_ID,
      currencyCode: "PLN",
      isClosed: false,
      accountSubType: null,
      ...over,
    }) as Account;

  const input = (
    planned: PlannedBankRow[],
    over: Partial<BankSyncWriteInput> = {},
  ): BankSyncWriteInput => ({
    userId: USER_ID,
    bankAccountId: BANK_ACCOUNT_ID,
    accountId: ACCOUNT_ID,
    // The cut-off `bankAccountRow()` holds.
    plannedSyncFromDate: "2026-08-01",
    plannedCurrencyCode: "PLN",
    plan: plan(planned),
    balance: null,
    ...over,
  });

  const statements = (needle: string) =>
    manager.query.mock.calls.filter((call) => String(call[0]).includes(needle));

  /** Ledger inserts win unless the key is in `taken`; other statements answer nothing. */
  function ledger(taken: string[] = []) {
    manager.query.mockImplementation(
      async (sql: string, params?: unknown[]) => {
        const text = String(sql);
        if (text.includes("INSERT INTO bank_sync_imported_transactions")) {
          return taken.includes(params![2] as string)
            ? []
            : [{ id: `ledger-${String(params![2])}` }];
        }
        if (text.includes("INSERT INTO payees")) {
          return [
            {
              id: "payee-new",
              name: String(params![1]),
              default_category_id: null,
            },
          ];
        }
        return [];
      },
    );
  }

  beforeEach(async () => {
    jest.clearAllMocks();
    nextTransaction = 0;
    linkRepo.findOne.mockResolvedValue(bankAccountRow());
    accountRepo.findOne.mockResolvedValue(account());
    rulesApplier.loadRulesFor.mockResolvedValue([]);
    rulesApplier.applyToNew.mockResolvedValue([]);
    accountsService.recalculateCurrentBalance.mockResolvedValue(account());
    payees.findByName.mockResolvedValue(null);
    payees.findPayeeByAlias.mockResolvedValue(null);
    manager.create.mockImplementation((_entity: unknown, props: object) => ({
      ...props,
    }));
    manager.save.mockImplementation(async (entity: object) => ({
      ...entity,
      id: `tx-${++nextTransaction}`,
    }));
    ledger();

    const module: TestingModule = await Test.createTestingModule({
      providers: [
        BankSyncWriterService,
        { provide: DataSource, useValue: dataSource },
        { provide: AccountsService, useValue: accountsService },
        { provide: TransactionRulesApplierService, useValue: rulesApplier },
        { provide: PayeesService, useValue: payees },
      ],
    }).compile();
    service = module.get(BankSyncWriterService);
  });

  describe("the write", () => {
    it("claims the ledger row before it creates the transaction, then points the ledger at it", async () => {
      const order: string[] = [];
      manager.query.mockImplementation(
        async (sql: string, params?: unknown[]) => {
          const text = String(sql);
          if (text.includes("INSERT INTO bank_sync_imported_transactions")) {
            order.push("ledger");
            return [{ id: "ledger-1" }];
          }
          if (text.includes("INSERT INTO payees")) {
            return [
              { id: "p", name: String(params![1]), default_category_id: null },
            ];
          }
          if (text.includes("SET transaction_id")) order.push("link");
          return [];
        },
      );
      manager.save.mockImplementation(async (entity: object) => {
        order.push("transaction");
        return { ...entity, id: "tx-1" };
      });

      const outcome = await service.write(input([row()]));

      expect(order).toEqual(["ledger", "transaction", "link"]);
      expect(outcome).toEqual({ imported: 1, skipped: 0 });
      const ledgerInsert = statements(
        "INSERT INTO bank_sync_imported_transactions",
      )[0];
      expect(String(ledgerInsert[0])).toContain(
        "ON CONFLICT (account_id, external_key) DO NOTHING",
      );
      expect(String(ledgerInsert[0])).toContain("RETURNING id");
      expect(ledgerInsert[1]).toEqual([
        USER_ID,
        ACCOUNT_ID,
        "ref:1",
        "2026-09-10",
      ]);
      expect(statements("SET transaction_id")[0][1]).toEqual([
        "tx-1",
        "ledger-1",
      ]);
    });

    it("writes the row cleared, in the account's currency, with the bank's text", async () => {
      await service.write(input([row()]));

      expect(manager.create).toHaveBeenCalledWith(
        Transaction,
        expect.objectContaining({
          userId: USER_ID,
          accountId: ACCOUNT_ID,
          transactionDate: "2026-09-10",
          amount: -12.34,
          currencyCode: "PLN",
          payeeName: "Biedronka",
          description: "Groceries",
          referenceNumber: "REF-1",
          status: TransactionStatus.CLEARED,
          isSplit: false,
          isTransfer: false,
        }),
      );
    });

    it("stamps rows of one date a millisecond apart, in the order planned", async () => {
      await service.write(
        input([
          row({ externalKey: "ref:1" }),
          row({ externalKey: "ref:2" }),
          row({ externalKey: "ref:3", transactionDate: "2026-09-11" }),
        ]),
      );
      const stamps = manager.create.mock.calls.map((call) =>
        (call[1] as { createdAt: Date }).createdAt.getTime(),
      );
      expect(stamps[1] - stamps[0]).toBe(1);
      expect(stamps[2]).toBe(stamps[0]);
    });

    it("skips a row the ledger already holds, writing nothing else for it", async () => {
      ledger(["ref:1"]);

      const outcome = await service.write(
        input([row({ externalKey: "ref:1" }), row({ externalKey: "ref:2" })]),
      );

      expect(outcome).toEqual({ imported: 1, skipped: 1 });
      expect(manager.create).toHaveBeenCalledTimes(1);
      expect(payees.findByName).toHaveBeenCalledTimes(1);
      expect(statements("SET transaction_id")).toHaveLength(1);
    });

    it("imports nothing, applies no rules and moves no balance when every row is a duplicate", async () => {
      ledger(["ref:1"]);
      const outcome = await service.write(input([row()]));
      expect(outcome).toEqual({ imported: 0, skipped: 1 });
      expect(manager.create).not.toHaveBeenCalled();
      expect(rulesApplier.applyToNew).not.toHaveBeenCalled();
      expect(accountsService.recalculateCurrentBalance).not.toHaveBeenCalled();
      // The outcome is still recorded: a sync that found nothing new succeeded.
      expect(statements("last_sync_status = 'succeeded'")).toHaveLength(1);
    });

    it("locks the link, then the account, before the first insert", async () => {
      const order: string[] = [];
      linkRepo.findOne.mockImplementation(async (options: unknown) => {
        order.push(
          (options as { lock?: { mode: string } }).lock?.mode ?? "no-lock",
        );
        return bankAccountRow();
      });
      manager.query.mockImplementation(async (sql: string) => {
        const text = String(sql);
        if (text.includes("FROM accounts WHERE id = ANY"))
          order.push("account-lock");
        if (text.includes("INSERT INTO bank_sync_imported_transactions")) {
          order.push("ledger");
          return [{ id: "l" }];
        }
        if (text.includes("INSERT INTO payees")) {
          return [{ id: "p", name: "n", default_category_id: null }];
        }
        return [];
      });

      await service.write(input([row()]));

      expect(order).toEqual(["pessimistic_write", "account-lock", "ledger"]);
    });

    it("applies the import rules to the created ids with the bank's raw payee text, after the rows and before the balance", async () => {
      const order: string[] = [];
      const rules = [{ id: "rule-1" }] as never;
      rulesApplier.loadRulesFor.mockResolvedValue(rules);
      rulesApplier.applyToNew.mockImplementation(async () => {
        order.push("rules");
        return [];
      });
      accountsService.recalculateCurrentBalance.mockImplementation(async () => {
        order.push("balance");
        return account();
      });
      manager.save.mockImplementation(async (entity: object) => {
        order.push("row");
        return { ...entity, id: `tx-${++nextTransaction}` };
      });

      await service.write(
        input([
          row({ externalKey: "ref:1", payeeText: "BIEDRONKA 123" }),
          row({ externalKey: "ref:2", payeeText: null }),
        ]),
      );

      expect(order).toEqual(["row", "row", "rules", "balance"]);
      expect(rulesApplier.loadRulesFor).toHaveBeenCalledTimes(1);
      expect(rulesApplier.loadRulesFor).toHaveBeenCalledWith(
        manager,
        USER_ID,
        "import",
      );
      const [, userId, ids, trigger, options] =
        rulesApplier.applyToNew.mock.calls[0];
      expect(userId).toBe(USER_ID);
      expect(ids).toEqual(["tx-1", "tx-2"]);
      expect(trigger).toBe("import");
      expect(options?.rules).toBe(rules);
      expect(options?.payeeTextById?.get("tx-1")).toBe("BIEDRONKA 123");
      expect(options?.payeeTextById?.get("tx-2")).toBeNull();
    });

    it("hands the rules applier at most one batch of ids at a time", async () => {
      const many = Array.from({ length: RULES_BATCH_SIZE + 1 }, (_, i) =>
        row({ externalKey: `ref:${i}`, payeeText: null }),
      );
      await service.write(input(many));
      expect(rulesApplier.applyToNew).toHaveBeenCalledTimes(2);
      expect(rulesApplier.applyToNew.mock.calls[0][2]).toHaveLength(
        RULES_BATCH_SIZE,
      );
      expect(rulesApplier.applyToNew.mock.calls[1][2]).toHaveLength(1);
    });

    it("recomputes the balance from the ledger once, in the same transaction", async () => {
      await service.write(
        input([row({ externalKey: "ref:1" }), row({ externalKey: "ref:2" })]),
      );
      expect(accountsService.recalculateCurrentBalance).toHaveBeenCalledTimes(
        1,
      );
      expect(accountsService.recalculateCurrentBalance).toHaveBeenCalledWith(
        USER_ID,
        ACCOUNT_ID,
      );
      expect(dataSource.transaction).toHaveBeenCalledTimes(1);
    });

    it("records the outcome counts, refusals included, on the locked bank account", async () => {
      ledger(["ref:2"]);
      await service.write(
        input([row({ externalKey: "ref:1" }), row({ externalKey: "ref:2" })], {
          plan: plan(
            [row({ externalKey: "ref:1" }), row({ externalKey: "ref:2" })],
            {
              refused: {
                ...emptyRefused(),
                currency_mismatch: 2,
                invalid_amount: 1,
              },
            },
          ),
        }),
      );
      const outcome = statements("last_sync_status = 'succeeded'")[0];
      expect(String(outcome[0])).toContain("last_sync_error = NULL");
      expect(outcome[1]).toEqual([BANK_ACCOUNT_ID, USER_ID, 1, 1, 3]);
    });

    it("writes the bank's balance only when one was fetched", async () => {
      await service.write(input([]));
      expect(statements("SET bank_balance")).toHaveLength(0);

      manager.query.mockClear();
      await service.write(
        input([], {
          balance: {
            amount: 1234.5,
            currencyCode: "PLN",
            referenceDate: "2026-09-29",
          },
        }),
      );
      expect(statements("SET bank_balance")[0][1]).toEqual([
        BANK_ACCOUNT_ID,
        USER_ID,
        1234.5,
        "PLN",
        "2026-09-29",
      ]);
    });

    it("never writes current_balance itself", async () => {
      await service.write(input([row()]));
      expect(
        manager.query.mock.calls.some((call) =>
          /current_balance\s*=/.test(String(call[0])),
        ),
      ).toBe(false);
    });
  });

  describe("refusals, before any write (INV-BANKSYNC-001, INV-BANKSYNC-003)", () => {
    const wroteNothing = () => {
      expect(
        statements("INSERT INTO bank_sync_imported_transactions"),
      ).toHaveLength(0);
      expect(manager.create).not.toHaveBeenCalled();
      expect(manager.save).not.toHaveBeenCalled();
      expect(accountsService.recalculateCurrentBalance).not.toHaveBeenCalled();
      expect(statements("last_sync_status = 'succeeded'")).toHaveLength(0);
    };

    it("is 404 when the bank account is gone", async () => {
      linkRepo.findOne.mockResolvedValue(null);
      await expect(service.write(input([row()]))).rejects.toBeInstanceOf(
        NotFoundException,
      );
      wroteNothing();
    });

    it("refuses when the bank account was re-linked during the fetch", async () => {
      linkRepo.findOne.mockResolvedValue(
        bankAccountRow({ accountId: "a0a0a0a0-0000-4000-8000-000000000009" }),
      );
      await expect(service.write(input([row()]))).rejects.toBeInstanceOf(
        ConflictException,
      );
      wroteNothing();
    });

    it("refuses when the cut-off date changed during the fetch, writing nothing", async () => {
      linkRepo.findOne.mockResolvedValue(
        bankAccountRow({ syncFromDate: "2026-09-01" }),
      );
      await expect(service.write(input([row()]))).rejects.toMatchObject({
        status: 409,
      });
      wroteNothing();
    });

    it("refuses when the cut-off date was set during the fetch (none was planned)", async () => {
      await expect(
        service.write(input([row()], { plannedSyncFromDate: null })),
      ).rejects.toBeInstanceOf(ConflictException);
      wroteNothing();
    });

    it("writes when the locked cut-off date is the one the plan was made against", async () => {
      await expect(
        service.write(input([row()], { plannedSyncFromDate: "2026-08-01" })),
      ).resolves.toMatchObject({ imported: 1 });
    });

    it("refuses when it was unlinked during the fetch", async () => {
      linkRepo.findOne.mockResolvedValue(bankAccountRow({ accountId: null }));
      await expect(service.write(input([row()]))).rejects.toBeInstanceOf(
        ConflictException,
      );
      wroteNothing();
    });

    it("refuses when the Monize account is gone", async () => {
      accountRepo.findOne.mockResolvedValue(null);
      await expect(service.write(input([row()]))).rejects.toBeInstanceOf(
        ConflictException,
      );
      wroteNothing();
    });

    it("refuses a closed account", async () => {
      accountRepo.findOne.mockResolvedValue(account({ isClosed: true }));
      await expect(service.write(input([row()]))).rejects.toBeInstanceOf(
        BadRequestException,
      );
      wroteNothing();
    });

    it("refuses an investment brokerage account", async () => {
      accountRepo.findOne.mockResolvedValue(
        account({ accountSubType: AccountSubType.INVESTMENT_BROKERAGE }),
      );
      await expect(service.write(input([row()]))).rejects.toBeInstanceOf(
        BadRequestException,
      );
      wroteNothing();
    });

    it("accepts an investment cash account", async () => {
      accountRepo.findOne.mockResolvedValue(
        account({ accountSubType: AccountSubType.INVESTMENT_CASH }),
      );
      await expect(service.write(input([row()]))).resolves.toMatchObject({
        imported: 1,
      });
    });

    it("refuses the whole batch when the account's currency changed since the plan", async () => {
      accountRepo.findOne.mockResolvedValue(account({ currencyCode: "EUR" }));
      await expect(service.write(input([row()]))).rejects.toBeInstanceOf(
        ConflictException,
      );
      wroteNothing();
    });

    it("compares currencies case-insensitively", async () => {
      accountRepo.findOne.mockResolvedValue(account({ currencyCode: "pln" }));
      await expect(
        service.write(input([row()], { plannedCurrencyCode: " PLN " })),
      ).resolves.toMatchObject({ imported: 1 });
    });
  });

  describe("the payee, resolved the way the file import does", () => {
    it("links an exact-name match and inherits its default category", async () => {
      payees.findByName.mockResolvedValue({
        id: "payee-1",
        name: "Biedronka",
        defaultCategoryId: "cat-1",
      } as Payee);
      await service.write(input([row()]));
      expect(payees.findByName).toHaveBeenCalledWith(USER_ID, "Biedronka");
      expect(payees.findPayeeByAlias).not.toHaveBeenCalled();
      expect(manager.create).toHaveBeenCalledWith(
        Transaction,
        expect.objectContaining({
          payeeId: "payee-1",
          payeeName: "Biedronka",
          categoryId: "cat-1",
        }),
      );
    });

    it("uses the canonical name of an alias match", async () => {
      payees.findPayeeByAlias.mockResolvedValue({
        id: "payee-2",
        name: "Biedronka S.A.",
        defaultCategoryId: null,
      } as Payee);
      await service.write(input([row({ payeeText: "BIEDRONKA 4711" })]));
      expect(manager.create).toHaveBeenCalledWith(
        Transaction,
        expect.objectContaining({
          payeeId: "payee-2",
          payeeName: "Biedronka S.A.",
          categoryId: null,
        }),
      );
    });

    it("creates a payee with one conflict-safe insert when nothing matches", async () => {
      await service.write(input([row()]));
      const insert = statements("INSERT INTO payees")[0];
      expect(String(insert[0])).toContain("ON CONFLICT (user_id, name)");
      expect(insert[1]).toEqual([USER_ID, "Biedronka"]);
      expect(manager.create).toHaveBeenCalledWith(
        Transaction,
        expect.objectContaining({
          payeeId: "payee-new",
          payeeName: "Biedronka",
        }),
      );
    });

    it("looks each counterparty up once per sync", async () => {
      await service.write(
        input([
          row({ externalKey: "ref:1" }),
          row({ externalKey: "ref:2" }),
          row({ externalKey: "ref:3" }),
        ]),
      );
      expect(payees.findByName).toHaveBeenCalledTimes(1);
      expect(statements("INSERT INTO payees")).toHaveLength(1);
    });

    it("writes no payee for a row with no counterparty", async () => {
      await service.write(input([row({ payeeText: null })]));
      expect(payees.findByName).not.toHaveBeenCalled();
      expect(manager.create).toHaveBeenCalledWith(
        Transaction,
        expect.objectContaining({
          payeeId: null,
          payeeName: null,
          categoryId: null,
        }),
      );
    });
  });
});
