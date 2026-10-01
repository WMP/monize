import { ConflictException } from "@nestjs/common";
import { Test, TestingModule } from "@nestjs/testing";
import { DataSource } from "typeorm";
import { Account } from "../accounts/entities/account.entity";
import { PayeesService } from "../payees/payees.service";
import { createScopedDbMocks } from "../test-helpers/scoped-db-testing";
import type { RuleEffectsPreview } from "../transaction-rules/transaction-rules-applier.service";
import { TransactionRulesApplierService } from "../transaction-rules/transaction-rules-applier.service";
import type { TransactionRule } from "../transaction-rules/transaction-rule.entity";
import { planFingerprint } from "./bank-sync-plan-fingerprint";
import {
  BankSyncPreviewService,
  BuildBankSyncPreviewInput,
} from "./bank-sync-preview.service";
import {
  ACCOUNT_ID,
  BANK_ACCOUNT_ID,
  bankAccountRow,
  bankTransaction,
  USER_ID,
} from "./bank-sync-testing";
import { explainBankImport } from "./bank-transaction-planner";
import { BankSyncAccount } from "./entities/bank-sync-account.entity";
import type { BankTransaction } from "./providers/bank-sync-provider.interface";

jest.mock("../common/db/scoped-db", () =>
  jest.requireActual("../test-helpers/scoped-db-testing").scopedDbMockModule(),
);

const CTX = {
  accountCurrencyCode: "PLN",
  syncFromDate: "2026-08-01",
  today: "2026-09-30",
};

describe("BankSyncPreviewService", () => {
  const linkRepo = { findOne: jest.fn() };
  const accountRepo = { findOne: jest.fn() };
  const { manager, dataSource } = createScopedDbMocks([
    [BankSyncAccount, linkRepo],
    [Account, accountRepo],
  ]);
  const rulesApplier: jest.Mocked<
    Pick<TransactionRulesApplierService, "loadRulesFor" | "previewForRow">
  > = { loadRulesFor: jest.fn(), previewForRow: jest.fn() };
  const payees: jest.Mocked<
    Pick<PayeesService, "findByName" | "findPayeeByAlias">
  > = { findByName: jest.fn(), findPayeeByAlias: jest.fn() };

  let service: BankSyncPreviewService;

  const account = (over: Partial<Account> = {}): Account =>
    ({
      id: ACCOUNT_ID,
      userId: USER_ID,
      currencyCode: "PLN",
      currentBalance: 1000,
      isClosed: false,
      accountSubType: null,
      ...over,
    }) as Account;

  const rows = (): BankTransaction[] => [
    bankTransaction({
      entryReference: "r1",
      amount: "50.00",
      direction: "debit",
      counterpartyName: "Biedronka",
    }),
    bankTransaction({
      entryReference: "r2",
      amount: "1200.1234",
      direction: "credit",
      counterpartyName: "Employer",
      remittance: ["Salary"],
    }),
    bankTransaction({ entryReference: "r3", currencyCode: "EUR" }),
    bankTransaction({ entryReference: "r4", booked: false }),
    bankTransaction({ entryReference: "r5", bookingDate: "2026-07-01" }),
  ];

  const input = (
    over: Partial<BuildBankSyncPreviewInput> = {},
    bankRows: BankTransaction[] = rows(),
  ): BuildBankSyncPreviewInput => ({
    userId: USER_ID,
    bankAccountId: BANK_ACCOUNT_ID,
    accountId: ACCOUNT_ID,
    plannedSyncFromDate: "2026-08-01",
    plannedCurrencyCode: "PLN",
    explained: explainBankImport(bankRows, CTX),
    balance: null,
    ...over,
  });

  /** The ledger SELECT answers with `held`. */
  function ledgerHolding(held: string[] = []) {
    manager.query.mockImplementation(async (sql: string) =>
      String(sql).includes("SELECT external_key")
        ? held.map((external_key) => ({ external_key }))
        : [],
    );
  }

  const writes = () =>
    manager.query.mock.calls.filter(
      (call) => !/^\s*SELECT/i.test(String(call[0])),
    );

  beforeEach(async () => {
    jest.clearAllMocks();
    linkRepo.findOne.mockResolvedValue(bankAccountRow());
    accountRepo.findOne.mockResolvedValue(account());
    rulesApplier.loadRulesFor.mockResolvedValue([]);
    rulesApplier.previewForRow.mockResolvedValue(null);
    payees.findByName.mockResolvedValue(null);
    payees.findPayeeByAlias.mockResolvedValue(null);
    ledgerHolding();

    const module: TestingModule = await Test.createTestingModule({
      providers: [
        BankSyncPreviewService,
        { provide: DataSource, useValue: dataSource },
        { provide: TransactionRulesApplierService, useValue: rulesApplier },
        { provide: PayeesService, useValue: payees },
      ],
    }).compile();
    service = module.get(BankSyncPreviewService);
  });

  describe("the rows", () => {
    it("lists every provider row once with its outcome, in the provider's order", async () => {
      const view = await service.build(input());
      expect(view.rows.map((r) => r.outcome)).toEqual([
        "new",
        "new",
        "refused",
        "pending",
        "before_cutoff",
      ]);
      expect(view.rows[2].refusalReason).toBe("currency_mismatch");
      expect(view.rows[0].refusalReason).toBeNull();
    });

    it("gives a new row the planner's own date, signed money, currency and text", async () => {
      const [first, second] = (await service.build(input())).rows;
      expect(first).toMatchObject({
        transactionDate: "2026-09-10",
        amount: "-50.0000",
        currencyCode: "PLN",
        payeeText: "Biedronka",
        description: "Groceries",
        referenceNumber: null,
      });
      expect(second).toMatchObject({
        amount: "1200.1234",
        payeeText: "Employer",
        description: "Salary",
      });
    });

    it("lists a row the ledger holds as a duplicate, with nothing resolved for it", async () => {
      ledgerHolding(["ref:r1"]);
      const view = await service.build(input());
      expect(view.rows[0]).toMatchObject({
        outcome: "duplicate",
        payeeText: "Biedronka",
        payeeName: null,
        categoryName: null,
        tagNames: [],
      });
      expect(view.rows[1].outcome).toBe("new");
      // The payee lookup is for new rows only.
      expect(payees.findByName).not.toHaveBeenCalledWith(USER_ID, "Biedronka");
    });

    it("shows a refused row as the bank sent it, a foreign amount in its own currency", async () => {
      const view = await service.build(input());
      expect(view.rows[2]).toMatchObject({
        outcome: "refused",
        currencyCode: "EUR",
        amount: "-12.3400",
        payeeName: null,
      });
    });

    it("shows an amount it cannot read as unknown, not zero", async () => {
      const view = await service.build(
        input({}, [bankTransaction({ entryReference: "x", amount: "abc" })]),
      );
      expect(view.rows[0]).toMatchObject({ outcome: "refused", amount: null });
    });
  });

  describe("the summary and the balances", () => {
    it("counts every outcome", async () => {
      ledgerHolding(["ref:r1"]);
      const { summary } = await service.build(input());
      expect(summary).toEqual({
        new: 1,
        duplicate: 1,
        refused: 1,
        refusedByReason: {
          missing_date: 0,
          future_date: 0,
          invalid_amount: 0,
          unknown_direction: 0,
          currency_mismatch: 1,
        },
        pending: 1,
        beforeCutoff: 1,
      });
    });

    it("answers the current balance and the balance after the new rows, added in scaled integers", async () => {
      accountRepo.findOne.mockResolvedValue(account({ currentBalance: 0.1 }));
      const view = await service.build(
        input({}, [
          bankTransaction({
            entryReference: "a",
            amount: "0.2",
            direction: "credit",
          }),
          bankTransaction({
            entryReference: "b",
            amount: "0.0001",
            direction: "credit",
          }),
        ]),
      );
      expect(view.monizeBalance).toBe("0.1000");
      // 0.1 + 0.2 + 0.0001 with no float residue.
      expect(view.balanceAfter).toBe("0.3001");
    });

    it("does not count a duplicate, a refused, a pending or a before-cutoff row in the balance after", async () => {
      ledgerHolding(["ref:r1"]);
      const view = await service.build(input());
      // 1000 + 1200.1234: r1 is a duplicate, r3 refused, r4 pending, r5 early.
      expect(view.balanceAfter).toBe("2200.1234");
    });

    it("answers the bank's balance and the difference to the balance after, when the currencies agree", async () => {
      const view = await service.build(
        input({
          balance: {
            amount: 2300.1234,
            currencyCode: "PLN",
            referenceDate: "2026-09-29",
          },
        }),
      );
      expect(view.bankBalance).toEqual({
        amount: "2300.1234",
        currencyCode: "PLN",
        referenceDate: "2026-09-29",
      });
      // 2300.1234 - (1000 - 50 + 1200.1234)
      expect(view.difference).toBe("150.0000");
    });

    it("answers no difference, but still the bank's balance, when the currencies differ", async () => {
      const view = await service.build(
        input({
          balance: { amount: 10, currencyCode: "EUR", referenceDate: null },
        }),
      );
      expect(view.bankBalance).toMatchObject({ currencyCode: "EUR" });
      expect(view.difference).toBeNull();
    });

    it("answers a null bank balance and a null difference when the bank reported none", async () => {
      const view = await service.build(input());
      expect(view.bankBalance).toBeNull();
      expect(view.difference).toBeNull();
    });

    it("keeps a zero difference as a number: it reconciles", async () => {
      const view = await service.build(
        input({
          balance: {
            amount: 2150.1234,
            currencyCode: "pln",
            referenceDate: null,
          },
        }),
      );
      expect(view.difference).toBe("0.0000");
    });
  });

  describe("the fingerprint", () => {
    it("is the fingerprint of the new rows only, so a duplicate does not move it", async () => {
      const everything = await service.build(input());
      ledgerHolding(["ref:r1"]);
      const withoutDuplicate = await service.build(input());
      const planned = input().explained.plan.planned;
      expect(everything.planFingerprint).toBe(planFingerprint(planned));
      expect(withoutDuplicate.planFingerprint).toBe(
        planFingerprint([planned[1]]),
      );
      expect(withoutDuplicate.planFingerprint).not.toBe(
        everything.planFingerprint,
      );
    });
  });

  describe("it writes nothing", () => {
    it("issues only SELECTs and takes no lock", async () => {
      ledgerHolding(["ref:r1"]);
      await service.build(input());
      expect(writes()).toEqual([]);
      for (const call of manager.query.mock.calls) {
        expect(String(call[0])).not.toMatch(/FOR UPDATE|INSERT|UPDATE|DELETE/);
      }
      for (const repo of [linkRepo, accountRepo]) {
        expect(repo.findOne.mock.calls.every((c) => !c[0]?.lock)).toBe(true);
      }
      expect(manager.save).not.toHaveBeenCalled();
      expect(manager.create).not.toHaveBeenCalled();
    });

    it("reads the caller's own rows", async () => {
      await service.build(input());
      expect(linkRepo.findOne).toHaveBeenCalledWith({
        where: { id: BANK_ACCOUNT_ID, userId: USER_ID },
      });
      expect(accountRepo.findOne).toHaveBeenCalledWith({
        where: { id: ACCOUNT_ID, userId: USER_ID },
      });
      const [, params] = manager.query.mock.calls[0];
      expect(params).toEqual([ACCOUNT_ID, USER_ID, expect.any(Array)]);
    });
  });

  describe("the payee and the import rules", () => {
    it("resolves an existing payee by name, and shows its default category", async () => {
      payees.findByName.mockImplementation(async (_user, name) =>
        name === "Biedronka"
          ? ({
              id: "payee-1",
              name: "Biedronka",
              defaultCategoryId: "cat-1",
              defaultCategory: { name: "Groceries" },
            } as never)
          : null,
      );
      const [first, second] = (await service.build(input())).rows;
      expect(first).toMatchObject({
        payeeName: "Biedronka",
        categoryName: "Groceries",
      });
      // No payee yet: the sync would create one named after the counterparty.
      expect(second).toMatchObject({
        payeeName: "Employer",
        categoryName: null,
      });
    });

    it("resolves by alias the way the sync does, showing the canonical name", async () => {
      payees.findPayeeByAlias.mockResolvedValue({
        id: "payee-2",
        name: "Biedronka S.A.",
        defaultCategoryId: null,
        defaultCategory: null,
      } as never);
      const [first] = (await service.build(input())).rows;
      expect(first.payeeName).toBe("Biedronka S.A.");
      expect(first.categoryName).toBeNull();
    });

    it("looks each counterparty up once", async () => {
      await service.build(
        input({}, [
          bankTransaction({ entryReference: "a" }),
          bankTransaction({ entryReference: "b" }),
        ]),
      );
      expect(payees.findByName).toHaveBeenCalledTimes(1);
    });

    it("shows no payee for a row with no counterparty", async () => {
      const view = await service.build(
        input({}, [
          bankTransaction({
            entryReference: "n",
            counterpartyName: null,
            remittance: [],
          }),
        ]),
      );
      expect(view.rows[0]).toMatchObject({ payeeText: null, payeeName: null });
      expect(payees.findByName).not.toHaveBeenCalled();
    });

    describe("with import rules", () => {
      const effects = (
        over: Partial<RuleEffectsPreview["changes"]> = {},
        labels: Partial<RuleEffectsPreview["labels"]> = {},
      ): RuleEffectsPreview => ({
        changes: { addTagIds: [], removeTagIds: [], ...over },
        trace: [],
        aiReviewRequests: [],
        labels: {
          categories: {},
          payees: {},
          tags: {},
          rules: {},
          ...labels,
        },
      });

      beforeEach(() => {
        rulesApplier.loadRulesFor.mockResolvedValue([
          { id: "rule-1" } as TransactionRule,
        ]);
      });

      it("plans each new row through previewForRow with the import trigger and the facts the write would give it", async () => {
        await service.build(input());
        expect(rulesApplier.previewForRow).toHaveBeenCalledTimes(2);
        const [, userId, facts, trigger] =
          rulesApplier.previewForRow.mock.calls[0];
        expect(userId).toBe(USER_ID);
        expect(trigger).toBe("import");
        expect(facts).toMatchObject({
          accountId: ACCOUNT_ID,
          currencyCode: "PLN",
          amount: -50,
          isTransfer: false,
          payeeText: "Biedronka",
          description: "Groceries",
          status: "CLEARED",
          transactionDate: "2026-09-10",
          tagIds: [],
          hasSplits: false,
        });
      });

      it("does not plan a duplicate or a refused row", async () => {
        ledgerHolding(["ref:r1"]);
        await service.build(input());
        expect(rulesApplier.previewForRow).toHaveBeenCalledTimes(1);
      });

      it("shows the category, tags and payee the rules would set", async () => {
        rulesApplier.previewForRow
          .mockResolvedValueOnce(
            effects(
              {
                categoryId: "cat-9",
                addTagIds: ["tag-1", "tag-2"],
                removeTagIds: ["tag-2"],
                payeeId: "payee-9",
              },
              {
                categories: { "cat-9": "Food" },
                tags: { "tag-1": "Weekly", "tag-2": "Gone" },
                payees: { "payee-9": "Biedronka S.A." },
              },
            ),
          )
          .mockResolvedValueOnce(null);
        const [first, second] = (await service.build(input())).rows;
        expect(first).toMatchObject({
          categoryName: "Food",
          tagNames: ["Weekly"],
          payeeName: "Biedronka S.A.",
        });
        expect(second).toMatchObject({
          categoryName: null,
          tagNames: [],
          payeeName: "Employer",
        });
      });

      it("shows a payee a rule would create, and a category a rule clears", async () => {
        payees.findByName.mockResolvedValue({
          id: "payee-1",
          name: "Biedronka",
          defaultCategoryId: "cat-1",
          defaultCategory: { name: "Groceries" },
        } as never);
        rulesApplier.previewForRow.mockResolvedValue(
          effects({ createPayee: "Shop (rule)", categoryId: null }),
        );
        const [first] = (await service.build(input())).rows;
        expect(first).toMatchObject({
          payeeName: "Shop (rule)",
          categoryName: null,
        });
      });

      it("keeps the payee's default category when the rules leave it alone", async () => {
        payees.findByName.mockResolvedValue({
          id: "payee-1",
          name: "Biedronka",
          defaultCategoryId: "cat-1",
          defaultCategory: { name: "Groceries" },
        } as never);
        rulesApplier.previewForRow.mockResolvedValue(
          effects({ addTagIds: ["t"] }, { tags: { t: "Tag" } }),
        );
        const [first] = (await service.build(input())).rows;
        expect(first).toMatchObject({
          categoryName: "Groceries",
          tagNames: ["Tag"],
        });
      });
    });

    it("plans no rules for a user who has none", async () => {
      await service.build(input());
      expect(rulesApplier.loadRulesFor).toHaveBeenCalledWith(
        manager,
        USER_ID,
        "import",
      );
      expect(rulesApplier.previewForRow).not.toHaveBeenCalled();
    });
  });

  describe("a plan that no longer describes the link", () => {
    it("is 409 when the bank account was re-linked during the fetch", async () => {
      linkRepo.findOne.mockResolvedValue(
        bankAccountRow({ accountId: "a0a0a0a0-0000-4000-8000-000000000002" }),
      );
      await expect(service.build(input())).rejects.toBeInstanceOf(
        ConflictException,
      );
    });

    it("is 409 when the link or the account is gone", async () => {
      linkRepo.findOne.mockResolvedValue(null);
      await expect(service.build(input())).rejects.toBeInstanceOf(
        ConflictException,
      );
      linkRepo.findOne.mockResolvedValue(bankAccountRow());
      accountRepo.findOne.mockResolvedValue(null);
      await expect(service.build(input())).rejects.toBeInstanceOf(
        ConflictException,
      );
    });

    it("is 409 when the cut-off changed during the fetch", async () => {
      await expect(
        service.build(input({ plannedSyncFromDate: "2026-01-01" })),
      ).rejects.toBeInstanceOf(ConflictException);
    });

    it("is 409 when the account's currency changed during the fetch", async () => {
      accountRepo.findOne.mockResolvedValue(account({ currencyCode: "EUR" }));
      await expect(service.build(input())).rejects.toBeInstanceOf(
        ConflictException,
      );
    });

    it("compares currencies case-insensitively", async () => {
      accountRepo.findOne.mockResolvedValue(account({ currencyCode: "pln" }));
      await expect(
        service.build(input({ plannedCurrencyCode: " PLN " })),
      ).resolves.toBeDefined();
    });
  });
});
