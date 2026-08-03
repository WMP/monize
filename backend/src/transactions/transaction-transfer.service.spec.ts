import { Test, TestingModule } from "@nestjs/testing";
import {
  BadRequestException,
  ForbiddenException,
  NotFoundException,
} from "@nestjs/common";
import { DataSource } from "typeorm";
import { TransactionTransferService } from "./transaction-transfer.service";
import { Transaction, TransactionStatus } from "./entities/transaction.entity";
import { TransactionSplit } from "./entities/transaction-split.entity";
import { Category } from "../categories/entities/category.entity";
import { AccountsService } from "../accounts/accounts.service";
import { PayeesService } from "../payees/payees.service";
import { NetWorthService } from "../net-worth/net-worth.service";
import { ActionHistoryService } from "../action-history/action-history.service";
import { CrossOwnerAccessService } from "../delegation/cross-owner-access.service";
import { isTransactionInFuture } from "../common/date-utils";
import { withSystemContext } from "../common/db/with-context";
import {
  createScopedDbMocks,
  DataSourceMock,
} from "../test-helpers/scoped-db-testing";
import { ConflictException } from "@nestjs/common";
import { lockTransactionRows } from "../common/db/locks";
import { lockedTransactionRow } from "../test-helpers/locks-testing";

jest.mock("../common/db/scoped-db", () =>
  jest.requireActual("../test-helpers/scoped-db-testing").scopedDbMockModule(),
);

// Passthrough spy: cross-owner writes must enter the audited system context;
// same-owner writes must not.
jest.mock("../common/db/with-context", () => {
  const actual = jest.requireActual("../common/db/with-context");
  return { ...actual, withSystemContext: jest.fn(actual.withSystemContext) };
});

const mockedWithSystemContext = withSystemContext as jest.MockedFunction<
  typeof withSystemContext
>;

// Both legs are locked inside the write transaction and the update refuses if
// either changed under it (audit P4-003). The double below derives the locked
// legs from the rows this spec's `findOne` callback has returned, so a spec only
// states the committed rows when it means them to differ.
jest.mock("../common/db/locks", () =>
  jest.requireActual("../test-helpers/locks-testing").locksMockModule(),
);

jest.mock("../common/date-utils", () => ({
  isTransactionInFuture: jest.fn().mockReturnValue(false),
}));

const mockedIsTransactionInFuture =
  isTransactionInFuture as jest.MockedFunction<typeof isTransactionInFuture>;

describe("TransactionTransferService", () => {
  let service: TransactionTransferService;
  let transactionsRepository: Record<string, jest.Mock>;
  let splitsRepository: Record<string, jest.Mock>;
  let categoriesRepository: Record<string, jest.Mock>;
  let accountsService: Record<string, jest.Mock>;
  let payeesService: Record<string, jest.Mock>;
  let netWorthService: Record<string, jest.Mock>;
  // The withScopedDb EntityManager, under the legacy `mockQueryRunner.manager`
  // shape so the pre-RLS manager assertions still read naturally.
  let mockQueryRunner: Record<string, any>;
  let mockDataSource: DataSourceMock;

  const mockFindOne = jest.fn();
  let crossOwnerAccess: Record<string, jest.Mock>;
  let actionHistoryService: Record<string, jest.Mock>;

  const mockFromAccount = {
    id: "from-account",
    name: "Checking",
    currencyCode: "USD",
    userId: "user-1",
  };

  const mockToAccount = {
    id: "to-account",
    name: "Savings",
    currencyCode: "USD",
    userId: "user-1",
  };

  const baseTransferDto = {
    fromAccountId: "from-account",
    toAccountId: "to-account",
    transactionDate: "2026-01-15",
    amount: 500,
    fromCurrencyCode: "USD",
  };

  beforeEach(async () => {
    jest.useFakeTimers();
    mockedIsTransactionInFuture.mockReturnValue(false);

    transactionsRepository = {
      create: jest
        .fn()
        .mockImplementation((data) => ({ ...data, id: `tx-${Date.now()}` })),
      save: jest
        .fn()
        .mockResolvedValueOnce({
          id: "from-tx-id",
          ...baseTransferDto,
          amount: -500,
        })
        .mockResolvedValueOnce({
          id: "to-tx-id",
          ...baseTransferDto,
          amount: 500,
        }),
      update: jest.fn().mockResolvedValue(undefined),
      findOne: jest.fn(),
      remove: jest.fn().mockResolvedValue(undefined),
    };

    splitsRepository = {
      findOne: jest.fn().mockResolvedValue(null),
      find: jest.fn().mockResolvedValue([]),
      remove: jest.fn().mockResolvedValue(undefined),
    };

    categoriesRepository = {
      // Default: any category id resolves to an owned category.
      findOne: jest.fn().mockResolvedValue({ id: "cat-1", userId: "user-1" }),
    };

    accountsService = {
      findOne: jest
        .fn()
        .mockImplementation((_userId: string, accountId: string) => {
          if (accountId === "from-account")
            return Promise.resolve(mockFromAccount);
          if (accountId === "to-account") return Promise.resolve(mockToAccount);
          return Promise.resolve({
            id: accountId,
            name: "Unknown",
            currencyCode: "USD",
          });
        }),
      updateBalance: jest.fn().mockResolvedValue(undefined),
      recalculateCurrentBalance: jest.fn().mockResolvedValue(undefined),
    };

    // Default: no payee matches a custom label (free-text / will-be-created
    // paths). Tests that exercise the match path override resolveByName.
    payeesService = {
      resolveByName: jest.fn().mockResolvedValue(null),
      findOrCreate: jest.fn(),
    };

    netWorthService = {
      recalculateAccount: jest.fn().mockResolvedValue(undefined),
      triggerDebouncedRecalc: jest.fn(),
    };

    // Default: both accounts owned by user-1, mirroring the old owner-scoped
    // findOne. Cross-owner tests override per account id.
    crossOwnerAccess = {
      accountAccessFor: jest
        .fn()
        .mockImplementation(async (realUserId: string, accountId: string) => {
          const account =
            accountId === "from-account"
              ? mockFromAccount
              : accountId === "to-account"
                ? mockToAccount
                : {
                    id: accountId,
                    name: "Unknown",
                    currencyCode: "USD",
                    userId: "user-1",
                  };
          return {
            account,
            ownerUserId: account.userId,
            via: account.userId === realUserId ? "own" : "delegation",
          };
        }),
    };

    actionHistoryService = { record: jest.fn().mockResolvedValue(null) };

    mockedWithSystemContext.mockClear();
    mockFindOne.mockReset();

    /**
     * Serve the locked leg readers from whatever this spec's `findOne` callback
     * has returned.
     *
     * Reading the mock's recorded results consumes nothing, unlike calling it
     * again and eating a queued `mockResolvedValueOnce`. A spec that wants the
     * committed legs to differ from the caller's view -- the concurrency case
     * `updateTransfer` now refuses -- overrides `lockTransactionRows` itself.
     */
    (lockTransactionRows as jest.Mock).mockImplementation(
      async (_m: unknown, ids: readonly string[]) => {
        const byId = new Map<string, Record<string, unknown>>();
        // The own leg comes back through the caller's `findOne`; the counterpart
        // through the repository. Both are rows this spec described.
        for (const mock of [mockFindOne.mock, transactionsRepository.findOne.mock]) {
          for (const result of mock.results) {
            if (result.type !== "return") continue;
            try {
              const row = (await result.value) as Record<
                string,
                unknown
              > | null;
              if (row?.id) byId.set(String(row.id), row);
            } catch {
              continue;
            }
          }
        }
        // The lock replaced the counterpart read, so on some paths nothing has
        // been read yet. Consulting the repository mock now is exactly right:
        // whatever the spec set up IS the committed counterpart.
        for (const id of ids) {
          if (byId.has(id)) continue;
          const row = (await transactionsRepository.findOne({
            where: { id },
          })) as Record<string, unknown> | null;
          if (row?.id) byId.set(String(row.id), row);
        }
        const found = new Map();
        for (const id of ids) {
          const row = byId.get(id);
          if (!row) continue;
          found.set(
            id,
            lockedTransactionRow({
              id: String(row.id),
              accountId: String(row.accountId ?? ""),
              amount: Number(row.amount ?? 0),
              transactionDate: row.transactionDate as string,
              status: (row.status as string | null) ?? null,
              isSplit: Boolean(row.isSplit),
              linkedTransactionId:
                (row.linkedTransactionId as string | null) ?? null,
            }),
          );
        }
        return found;
      },
    );

    const tenantMocks = createScopedDbMocks([
      [Transaction, transactionsRepository],
      [TransactionSplit, splitsRepository],
      [Category, categoriesRepository],
    ]);
    mockDataSource = tenantMocks.dataSource;

    const manager = tenantMocks.manager;
    manager.create.mockImplementation((_Entity: any, data: any) =>
      transactionsRepository.create(data),
    );
    manager.save.mockImplementation((data: any) =>
      transactionsRepository.save(data),
    );
    manager.update.mockImplementation((_Entity: any, id: any, data: any) =>
      transactionsRepository.update(id, data),
    );
    // Both legs are deleted conditionally and each reversal is gated on what the
    // database actually removed (audit P4-003), so the double reports a count.
    manager.delete.mockResolvedValue({ affected: 1 });
    manager.findOne.mockImplementation((_Entity: any, opts: any) =>
      transactionsRepository.findOne(opts),
    );
    manager.find.mockImplementation((_Entity: any, opts: any) =>
      splitsRepository.find(opts),
    );
    manager.remove.mockImplementation((data: any) => {
      const item = Array.isArray(data) ? data[0] : data;
      if (item && "transactionId" in item && !("accountId" in item)) {
        return splitsRepository.remove(data);
      }
      return transactionsRepository.remove(data);
    });
    manager.query.mockResolvedValue([]);

    mockQueryRunner = { manager };

    const module: TestingModule = await Test.createTestingModule({
      providers: [
        TransactionTransferService,
        { provide: AccountsService, useValue: accountsService },
        { provide: PayeesService, useValue: payeesService },
        { provide: NetWorthService, useValue: netWorthService },
        { provide: DataSource, useValue: mockDataSource },
        { provide: ActionHistoryService, useValue: actionHistoryService },
        { provide: CrossOwnerAccessService, useValue: crossOwnerAccess },
      ],
    }).compile();

    service = module.get<TransactionTransferService>(
      TransactionTransferService,
    );
  });

  afterEach(() => {
    jest.useRealTimers();
  });

  describe("createTransfer", () => {
    it("creates from and to transactions with correct amounts and links them", async () => {
      mockFindOne
        .mockResolvedValueOnce({ id: "from-tx-id", amount: -500 })
        .mockResolvedValueOnce({ id: "to-tx-id", amount: 500 });

      const result = await service.createTransfer(
        "user-1",
        baseTransferDto,
        mockFindOne,
      );

      expect(transactionsRepository.create).toHaveBeenCalledTimes(2);

      // from transaction should have negative amount
      const fromCreateCall = transactionsRepository.create.mock.calls[0][0];
      expect(fromCreateCall.amount).toBe(-500);
      expect(fromCreateCall.isTransfer).toBe(true);
      expect(fromCreateCall.accountId).toBe("from-account");

      // to transaction should have positive amount
      const toCreateCall = transactionsRepository.create.mock.calls[1][0];
      expect(toCreateCall.amount).toBe(500);
      expect(toCreateCall.isTransfer).toBe(true);
      expect(toCreateCall.accountId).toBe("to-account");

      expect(transactionsRepository.save).toHaveBeenCalledTimes(2);

      // linked transaction IDs updated
      expect(transactionsRepository.update).toHaveBeenCalledWith("from-tx-id", {
        linkedTransactionId: "to-tx-id",
      });
      expect(transactionsRepository.update).toHaveBeenCalledWith("to-tx-id", {
        linkedTransactionId: "from-tx-id",
      });

      // balances updated
      expect(accountsService.updateBalance).toHaveBeenCalledWith(
        "from-account",
        -500,
      );
      expect(accountsService.updateBalance).toHaveBeenCalledWith(
        "to-account",
        500,
      );

      expect(result.fromTransaction.id).toBe("from-tx-id");
      expect(result.toTransaction.id).toBe("to-tx-id");
    });

    it("writes both legs with the effective user's id and no system context on the same-owner path", async () => {
      mockFindOne
        .mockResolvedValueOnce({ id: "from-tx-id", amount: -500 })
        .mockResolvedValueOnce({ id: "to-tx-id", amount: 500 });

      await service.createTransfer("user-1", baseTransferDto, mockFindOne, {
        effectiveUserId: "user-1",
        realUserId: "user-1",
      });

      const [fromCreate, toCreate] = transactionsRepository.create.mock.calls;
      expect(fromCreate[0].userId).toBe("user-1");
      expect(toCreate[0].userId).toBe("user-1");
      expect(mockedWithSystemContext).not.toHaveBeenCalled();
      // Exactly today's single history record, under the effective user.
      expect(actionHistoryService.record).toHaveBeenCalledTimes(1);
      expect(actionHistoryService.record).toHaveBeenCalledWith(
        "user-1",
        expect.objectContaining({
          descriptionKey: "createdTransfer",
          descriptionParams: {
            amount: expect.any(String),
            from: "Checking",
            to: "Savings",
          },
        }),
      );
      // Result legs loaded through the same owner-scoped findOne as before.
      expect(mockFindOne).toHaveBeenNthCalledWith(1, "user-1", "from-tx-id");
      expect(mockFindOne).toHaveBeenNthCalledWith(2, "user-1", "to-tx-id");
    });

    describe("cross-owner", () => {
      const foreignToAccount = {
        id: "to-account",
        name: "Owner Savings",
        currencyCode: "USD",
        userId: "owner-2",
      };

      beforeEach(() => {
        crossOwnerAccess.accountAccessFor.mockImplementation(
          async (realUserId: string, accountId: string) => {
            const account =
              accountId === "from-account" ? mockFromAccount : foreignToAccount;
            return {
              account,
              ownerUserId: account.userId,
              via: account.userId === realUserId ? "own" : "delegation",
            };
          },
        );
        transactionsRepository.save
          .mockReset()
          .mockResolvedValueOnce({ id: "from-tx-id" })
          .mockResolvedValueOnce({ id: "to-tx-id" });
        mockFindOne
          .mockResolvedValueOnce({ id: "from-tx-id", amount: -500 })
          .mockResolvedValueOnce({ id: "to-tx-id", amount: 500 });
      });

      const crossDto = {
        ...baseTransferDto,
        categoryId: "cat-1",
        payeeId: "payee-1",
      };
      const actor = { effectiveUserId: "user-1", realUserId: "user-1" };

      it("writes each leg with its account owner's user id inside a system-context transaction", async () => {
        await service.createTransfer("user-1", crossDto, mockFindOne, actor);

        const [fromCreate, toCreate] = transactionsRepository.create.mock.calls;
        expect(fromCreate[0].userId).toBe("user-1");
        expect(toCreate[0].userId).toBe("owner-2");
        expect(mockedWithSystemContext).toHaveBeenCalled();

        // Balances still update both accounts.
        expect(accountsService.updateBalance).toHaveBeenCalledWith(
          "from-account",
          -500,
        );
        expect(accountsService.updateBalance).toHaveBeenCalledWith(
          "to-account",
          500,
        );
      });

      it("authorizes both accounts for the REAL user with the create op", async () => {
        await service.createTransfer("user-1", crossDto, mockFindOne, {
          effectiveUserId: "user-1",
          realUserId: "real-9",
        });
        expect(crossOwnerAccess.accountAccessFor).toHaveBeenCalledWith(
          "real-9",
          "from-account",
          "create",
        );
        expect(crossOwnerAccess.accountAccessFor).toHaveBeenCalledWith(
          "real-9",
          "to-account",
          "create",
        );
      });

      it("applies category and payee to effective-user legs only", async () => {
        await service.createTransfer("user-1", crossDto, mockFindOne, actor);

        const [fromCreate, toCreate] = transactionsRepository.create.mock.calls;
        expect(fromCreate[0].categoryId).toBe("cat-1");
        expect(fromCreate[0].payeeId).toBe("payee-1");
        expect(toCreate[0].categoryId).toBeNull();
        expect(toCreate[0].payeeId).toBeNull();
      });

      it("loads each result leg as its owner and recalcs net worth per owner", async () => {
        await service.createTransfer("user-1", crossDto, mockFindOne, actor);

        expect(mockFindOne).toHaveBeenNthCalledWith(1, "user-1", "from-tx-id");
        expect(mockFindOne).toHaveBeenNthCalledWith(2, "owner-2", "to-tx-id");
        expect(netWorthService.triggerDebouncedRecalc).toHaveBeenCalledWith(
          "from-account",
          "user-1",
        );
        expect(netWorthService.triggerDebouncedRecalc).toHaveBeenCalledWith(
          "to-account",
          "owner-2",
        );
      });

      it("records history per owner, masking the foreign account name in the counterpart's entry", async () => {
        await service.createTransfer("user-1", crossDto, mockFindOne, actor);

        expect(actionHistoryService.record).toHaveBeenCalledTimes(2);
        // Actor's own entry names both accounts.
        expect(actionHistoryService.record).toHaveBeenCalledWith(
          "user-1",
          expect.objectContaining({
            entityId: "from-tx-id",
            descriptionParams: expect.objectContaining({
              from: "Checking",
              to: "Owner Savings",
            }),
          }),
        );
        // Counterpart owner's entry masks the actor's account name.
        expect(actionHistoryService.record).toHaveBeenCalledWith(
          "owner-2",
          expect.objectContaining({
            entityId: "to-tx-id",
            descriptionParams: expect.objectContaining({
              from: "Shared account",
              to: "Owner Savings",
            }),
          }),
        );
      });
    });

    it("throws when source and destination accounts are the same", async () => {
      const dto = { ...baseTransferDto, toAccountId: "from-account" };

      await expect(
        service.createTransfer("user-1", dto, mockFindOne),
      ).rejects.toThrow(BadRequestException);
      await expect(
        service.createTransfer("user-1", dto, mockFindOne),
      ).rejects.toThrow("Source and destination accounts must be different");
    });

    it("throws when amount is negative", async () => {
      const negDto = { ...baseTransferDto, amount: -100 };
      await expect(
        service.createTransfer("user-1", negDto, mockFindOne),
      ).rejects.toThrow("Transfer amount must not be negative");
    });

    it("allows zero amount transfer", async () => {
      transactionsRepository.save
        .mockReset()
        .mockResolvedValueOnce({ id: "from-tx-id" })
        .mockResolvedValueOnce({ id: "to-tx-id" });

      mockFindOne
        .mockResolvedValueOnce({ id: "from-tx-id" })
        .mockResolvedValueOnce({ id: "to-tx-id" });

      const zeroDto = { ...baseTransferDto, amount: 0 };
      const result = await service.createTransfer(
        "user-1",
        zeroDto,
        mockFindOne,
      );
      expect(result).toBeDefined();
      expect(result.fromTransaction).toBeDefined();
      expect(result.toTransaction).toBeDefined();
    });

    it("uses explicit toAmount when provided", async () => {
      transactionsRepository.save
        .mockReset()
        .mockResolvedValueOnce({ id: "from-tx-id" })
        .mockResolvedValueOnce({ id: "to-tx-id" });

      mockFindOne
        .mockResolvedValueOnce({ id: "from-tx-id" })
        .mockResolvedValueOnce({ id: "to-tx-id" });

      const dto = {
        ...baseTransferDto,
        toCurrencyCode: "CAD",
        exchangeRate: 1.35,
        toAmount: 680,
      };

      await service.createTransfer("user-1", dto, mockFindOne);

      const toCreateCall = transactionsRepository.create.mock.calls[1][0];
      expect(toCreateCall.amount).toBe(680);
      expect(accountsService.updateBalance).toHaveBeenCalledWith(
        "to-account",
        680,
      );
    });

    it("calculates toAmount from exchangeRate when toAmount not provided", async () => {
      transactionsRepository.save
        .mockReset()
        .mockResolvedValueOnce({ id: "from-tx-id" })
        .mockResolvedValueOnce({ id: "to-tx-id" });

      mockFindOne
        .mockResolvedValueOnce({ id: "from-tx-id" })
        .mockResolvedValueOnce({ id: "to-tx-id" });

      const dto = {
        ...baseTransferDto,
        toCurrencyCode: "CAD",
        exchangeRate: 1.35,
      };

      await service.createTransfer("user-1", dto, mockFindOne);

      const toCreateCall = transactionsRepository.create.mock.calls[1][0];
      // 500 * 1.35 = 675
      expect(toCreateCall.amount).toBe(675);
    });

    it("uses custom payeeName when provided", async () => {
      transactionsRepository.save
        .mockReset()
        .mockResolvedValueOnce({ id: "from-tx-id" })
        .mockResolvedValueOnce({ id: "to-tx-id" });

      mockFindOne
        .mockResolvedValueOnce({ id: "from-tx-id" })
        .mockResolvedValueOnce({ id: "to-tx-id" });

      const dto = { ...baseTransferDto, payeeName: "My Transfer" };

      await service.createTransfer("user-1", dto, mockFindOne);

      const fromCreateCall = transactionsRepository.create.mock.calls[0][0];
      const toCreateCall = transactionsRepository.create.mock.calls[1][0];
      expect(fromCreateCall.payeeName).toBe("My Transfer");
      expect(toCreateCall.payeeName).toBe("My Transfer");
    });

    it("generates default payeeName from account names when not provided", async () => {
      transactionsRepository.save
        .mockReset()
        .mockResolvedValueOnce({ id: "from-tx-id" })
        .mockResolvedValueOnce({ id: "to-tx-id" });

      mockFindOne
        .mockResolvedValueOnce({ id: "from-tx-id" })
        .mockResolvedValueOnce({ id: "to-tx-id" });

      await service.createTransfer("user-1", baseTransferDto, mockFindOne);

      const fromCreateCall = transactionsRepository.create.mock.calls[0][0];
      const toCreateCall = transactionsRepository.create.mock.calls[1][0];
      expect(fromCreateCall.payeeName).toBe("Transfer to Savings");
      expect(toCreateCall.payeeName).toBe("Transfer from Checking");
    });

    it("triggers net worth recalc for both accounts (debounced)", async () => {
      transactionsRepository.save
        .mockReset()
        .mockResolvedValueOnce({ id: "from-tx-id" })
        .mockResolvedValueOnce({ id: "to-tx-id" });

      mockFindOne
        .mockResolvedValueOnce({ id: "from-tx-id" })
        .mockResolvedValueOnce({ id: "to-tx-id" });

      await service.createTransfer("user-1", baseTransferDto, mockFindOne);

      expect(netWorthService.triggerDebouncedRecalc).toHaveBeenCalledWith(
        "from-account",
        "user-1",
      );
      expect(netWorthService.triggerDebouncedRecalc).toHaveBeenCalledWith(
        "to-account",
        "user-1",
      );
    });

    it("uses default status UNRECONCILED when not specified", async () => {
      transactionsRepository.save
        .mockReset()
        .mockResolvedValueOnce({ id: "from-tx-id" })
        .mockResolvedValueOnce({ id: "to-tx-id" });

      mockFindOne
        .mockResolvedValueOnce({ id: "from-tx-id" })
        .mockResolvedValueOnce({ id: "to-tx-id" });

      await service.createTransfer("user-1", baseTransferDto, mockFindOne);

      const fromCreateCall = transactionsRepository.create.mock.calls[0][0];
      expect(fromCreateCall.status).toBe(TransactionStatus.UNRECONCILED);
    });
  });

  describe("category on transfers", () => {
    const fromTx = {
      id: "from-tx",
      accountId: "from-account",
      amount: -500,
      isTransfer: true,
      linkedTransactionId: "to-tx",
      exchangeRate: 1,
      account: mockFromAccount,
    } as unknown as Transaction;

    const toTx = {
      id: "to-tx",
      accountId: "to-account",
      amount: 500,
      isTransfer: true,
      linkedTransactionId: "from-tx",
      exchangeRate: 1,
      account: mockToAccount,
    } as unknown as Transaction;

    beforeEach(() => {
      mockFindOne.mockReset();
    });

    it("stores the category on both legs when creating", async () => {
      mockFindOne
        .mockResolvedValueOnce({ id: "from-tx-id", amount: -500 })
        .mockResolvedValueOnce({ id: "to-tx-id", amount: 500 });

      await service.createTransfer(
        "user-1",
        { ...baseTransferDto, categoryId: "cat-1" },
        mockFindOne,
      );

      expect(transactionsRepository.create.mock.calls[0][0].categoryId).toBe(
        "cat-1",
      );
      expect(transactionsRepository.create.mock.calls[1][0].categoryId).toBe(
        "cat-1",
      );
    });

    it("defaults the category to null when none is given", async () => {
      mockFindOne
        .mockResolvedValueOnce({ id: "from-tx-id", amount: -500 })
        .mockResolvedValueOnce({ id: "to-tx-id", amount: 500 });

      await service.createTransfer("user-1", baseTransferDto, mockFindOne);

      expect(
        transactionsRepository.create.mock.calls[0][0].categoryId,
      ).toBeNull();
      expect(
        transactionsRepository.create.mock.calls[1][0].categoryId,
      ).toBeNull();
    });

    it("rejects a category the user does not own", async () => {
      categoriesRepository.findOne.mockResolvedValue(null);

      await expect(
        service.createTransfer(
          "user-1",
          { ...baseTransferDto, categoryId: "cat-x" },
          mockFindOne,
        ),
      ).rejects.toThrow(BadRequestException);
      expect(transactionsRepository.create).not.toHaveBeenCalled();
    });

    it("sets the category on both legs when updating", async () => {
      mockFindOne
        .mockResolvedValueOnce(fromTx)
        .mockResolvedValueOnce(toTx)
        .mockResolvedValueOnce(fromTx)
        .mockResolvedValueOnce(toTx);

      await service.updateTransfer(
        "user-1",
        "from-tx",
        { categoryId: "cat-1" },
        mockFindOne,
      );

      const updateCalls = transactionsRepository.update.mock.calls;
      const fromUpdate = updateCalls.find((c) => c[0] === "from-tx")?.[1];
      const toUpdate = updateCalls.find((c) => c[0] === "to-tx")?.[1];
      expect(fromUpdate.categoryId).toBe("cat-1");
      expect(toUpdate.categoryId).toBe("cat-1");
    });

    it("clears the category on both legs when updating with null", async () => {
      mockFindOne
        .mockResolvedValueOnce({ ...fromTx, categoryId: "cat-1" })
        .mockResolvedValueOnce({ ...toTx, categoryId: "cat-1" })
        .mockResolvedValueOnce(fromTx)
        .mockResolvedValueOnce(toTx);

      await service.updateTransfer(
        "user-1",
        "from-tx",
        { categoryId: null },
        mockFindOne,
      );

      const updateCalls = transactionsRepository.update.mock.calls;
      const fromUpdate = updateCalls.find((c) => c[0] === "from-tx")?.[1];
      const toUpdate = updateCalls.find((c) => c[0] === "to-tx")?.[1];
      expect(fromUpdate.categoryId).toBeNull();
      expect(toUpdate.categoryId).toBeNull();
    });

    it("does not reject when no category is provided on update", async () => {
      mockFindOne
        .mockResolvedValueOnce(fromTx)
        .mockResolvedValueOnce(toTx)
        .mockResolvedValueOnce(fromTx)
        .mockResolvedValueOnce(toTx);

      await service.updateTransfer(
        "user-1",
        "from-tx",
        { description: "note" },
        mockFindOne,
      );

      expect(categoriesRepository.findOne).not.toHaveBeenCalled();
    });
  });

  describe("getLinkedTransaction", () => {
    it("returns linked transaction for a transfer", async () => {
      const linkedTx = { id: "linked-tx-id", amount: 500 };
      mockFindOne
        .mockResolvedValueOnce({
          id: "tx-1",
          isTransfer: true,
          linkedTransactionId: "linked-tx-id",
        })
        .mockResolvedValueOnce(linkedTx);

      const result = await service.getLinkedTransaction(
        "user-1",
        "tx-1",
        mockFindOne,
      );

      expect(result).toEqual(linkedTx);
    });

    it("returns null when transaction is not a transfer", async () => {
      mockFindOne.mockResolvedValue({
        id: "tx-1",
        isTransfer: false,
        linkedTransactionId: null,
      });

      const result = await service.getLinkedTransaction(
        "user-1",
        "tx-1",
        mockFindOne,
      );

      expect(result).toBeNull();
    });

    it("returns null when linkedTransactionId is null", async () => {
      mockFindOne.mockResolvedValue({
        id: "tx-1",
        isTransfer: true,
        linkedTransactionId: null,
      });

      const result = await service.getLinkedTransaction(
        "user-1",
        "tx-1",
        mockFindOne,
      );

      expect(result).toBeNull();
    });

    it("returns null when linked transaction lookup fails", async () => {
      mockFindOne
        .mockResolvedValueOnce({
          id: "tx-1",
          isTransfer: true,
          linkedTransactionId: "missing-tx",
        })
        .mockRejectedValueOnce(new Error("Not found"));

      const result = await service.getLinkedTransaction(
        "user-1",
        "tx-1",
        mockFindOne,
      );

      expect(result).toBeNull();
    });
  });

  describe("stale-snapshot refusal", () => {
    it("returns 409 when a leg changed between the read and the write", async () => {
      // The regression guard for P4-003 on transfers. The four balance
      // adjustments reverse the OLD leg amounts and re-apply the new ones, so a
      // concurrent edit makes those old values describe a version this write is
      // not replacing -- two updates each reversing the same pair corrupt both
      // accounts. A 409 the client can retry is the honest answer.
      const fromTx = {
        id: "from-tx",
        userId: "user-1",
        accountId: "from-account",
        amount: -200,
        isTransfer: true,
        linkedTransactionId: "to-tx",
        exchangeRate: 1,
        transactionDate: "2026-01-15",
      };
      const toTx = {
        id: "to-tx",
        userId: "user-1",
        accountId: "to-account",
        amount: 200,
        isTransfer: true,
        linkedTransactionId: "from-tx",
        exchangeRate: 1,
        transactionDate: "2026-01-15",
      };
      mockFindOne.mockImplementation(async (_u: string, id: string) =>
        id === "from-tx" ? fromTx : toTx,
      );
      splitsRepository.findOne.mockResolvedValue(null);

      // The committed from-leg is already -300: another request got there first.
      (lockTransactionRows as jest.Mock).mockResolvedValue(
        new Map([
          [
            "from-tx",
            lockedTransactionRow({
              id: "from-tx",
              accountId: "from-account",
              amount: -300,
              transactionDate: "2026-01-15",
            }),
          ],
          [
            "to-tx",
            lockedTransactionRow({
              id: "to-tx",
              accountId: "to-account",
              amount: 300,
              transactionDate: "2026-01-15",
            }),
          ],
        ]),
      );

      await expect(
        service.updateTransfer(
          "user-1",
          "from-tx",
          { amount: 250 },
          mockFindOne,
        ),
      ).rejects.toBeInstanceOf(ConflictException);

      expect(accountsService.updateBalance).not.toHaveBeenCalled();
    });
  });

  describe("removeTransfer", () => {
    it("removes both from and to transactions for standalone transfer", async () => {
      const fromTx = {
        id: "from-tx",
        isTransfer: true,
        linkedTransactionId: "to-tx",
        accountId: "from-account",
        amount: -500,
      };
      const toTx = {
        id: "to-tx",
        accountId: "to-account",
        amount: 500,
      };

      mockFindOne.mockResolvedValue(fromTx);
      splitsRepository.findOne.mockResolvedValue(null);
      transactionsRepository.findOne.mockResolvedValue(toTx);

      await service.removeTransfer("user-1", "from-tx", mockFindOne);

      // Reverse from transaction balance
      expect(accountsService.updateBalance).toHaveBeenCalledWith(
        "from-account",
        500,
      );
      // Reverse to transaction balance
      expect(accountsService.updateBalance).toHaveBeenCalledWith(
        "to-account",
        -500,
      );
      // Both transactions removed
      // Conditional DELETEs, with each reversal gated on the row the database
      // actually removed (audit P4-003).
      expect(mockQueryRunner.manager.delete).toHaveBeenCalledWith(Transaction, {
        id: "to-tx",
        userId: "user-1",
      });
      expect(mockQueryRunner.manager.delete).toHaveBeenCalledWith(Transaction, {
        id: "from-tx",
        userId: "user-1",
      });
    });

    it("throws when transaction is not a transfer", async () => {
      mockFindOne.mockResolvedValue({
        id: "tx-1",
        isTransfer: false,
      });

      await expect(
        service.removeTransfer("user-1", "tx-1", mockFindOne),
      ).rejects.toThrow(BadRequestException);
      await expect(
        service.removeTransfer("user-1", "tx-1", mockFindOne),
      ).rejects.toThrow("Transaction is not a transfer");
    });

    it("removes only the current transaction when no linked transaction", async () => {
      const tx = {
        id: "tx-1",
        isTransfer: true,
        linkedTransactionId: null,
        accountId: "from-account",
        amount: -500,
      };

      mockFindOne.mockResolvedValue(tx);
      splitsRepository.findOne.mockResolvedValue(null);

      await service.removeTransfer("user-1", "tx-1", mockFindOne);

      expect(accountsService.updateBalance).toHaveBeenCalledWith(
        "from-account",
        500,
      );
      // One conditional DELETE, for the own leg only.
      expect(mockQueryRunner.manager.delete).toHaveBeenCalledTimes(1);
      expect(mockQueryRunner.manager.delete).toHaveBeenCalledWith(Transaction, {
        id: "tx-1",
        userId: "user-1",
      });
    });

    it("delegates to removeTransferFromSplit when transaction is part of a split", async () => {
      const tx = {
        id: "linked-from-split",
        isTransfer: true,
        linkedTransactionId: "parent-tx",
        accountId: "account-2",
        amount: 50,
      };

      const parentSplit = {
        id: "parent-split",
        transactionId: "parent-tx",
        linkedTransactionId: "linked-from-split",
      };

      mockFindOne.mockResolvedValue(tx);
      splitsRepository.findOne.mockResolvedValue(parentSplit);

      // Mock for removeTransferFromSplit internal calls
      transactionsRepository.findOne.mockResolvedValue({
        id: "parent-tx",
        accountId: "account-1",
        amount: -100,
      });
      splitsRepository.find.mockResolvedValue([parentSplit]);

      await service.removeTransfer("user-1", "linked-from-split", mockFindOne);

      // Should remove the parent transaction and all related splits
      expect(splitsRepository.remove).toHaveBeenCalled();
      expect(transactionsRepository.remove).toHaveBeenCalled();
    });

    it("triggers net worth recalc for affected accounts", async () => {
      const fromTx = {
        id: "from-tx",
        isTransfer: true,
        linkedTransactionId: "to-tx",
        accountId: "from-account",
        amount: -500,
      };
      const toTx = {
        id: "to-tx",
        accountId: "to-account",
        amount: 500,
      };

      mockFindOne.mockResolvedValue(fromTx);
      splitsRepository.findOne.mockResolvedValue(null);
      transactionsRepository.findOne.mockResolvedValue(toTx);

      await service.removeTransfer("user-1", "from-tx", mockFindOne);

      expect(netWorthService.triggerDebouncedRecalc).toHaveBeenCalledWith(
        "from-account",
        "user-1",
      );
      expect(netWorthService.triggerDebouncedRecalc).toHaveBeenCalledWith(
        "to-account",
        "user-1",
      );
    });

    it("recalculates balances instead of adjusting them when removing a future-dated split-linked transfer", async () => {
      mockedIsTransactionInFuture.mockReturnValue(true);

      const tx = {
        id: "linked-from-split",
        isTransfer: true,
        linkedTransactionId: "parent-tx",
        accountId: "account-2",
        amount: 50,
        transactionDate: "2099-01-01",
      };

      const targetSplit = {
        id: "target-split",
        transactionId: "parent-tx",
        linkedTransactionId: "linked-from-split",
      };
      // A second split links to a different leg, exercising the linked-leg
      // future recalc branch (line 627).
      const otherSplit = {
        id: "other-split",
        transactionId: "parent-tx",
        linkedTransactionId: "other-leg",
      };

      mockFindOne.mockResolvedValue(tx);
      splitsRepository.findOne.mockResolvedValue(targetSplit);
      transactionsRepository.findOne.mockImplementation((opts: any) => {
        const id = opts?.where?.id;
        if (id === "parent-tx")
          return Promise.resolve({
            id: "parent-tx",
            accountId: "account-1",
            amount: -100,
            transactionDate: "2099-01-01",
          });
        if (id === "other-leg")
          return Promise.resolve({
            id: "other-leg",
            accountId: "account-3",
            amount: 25,
            transactionDate: "2099-01-01",
          });
        return Promise.resolve(null);
      });
      splitsRepository.find.mockResolvedValue([targetSplit, otherSplit]);

      await service.removeTransfer("user-1", "linked-from-split", mockFindOne);

      // Future-dated: balances are recalculated, never adjusted.
      expect(accountsService.updateBalance).not.toHaveBeenCalled();
      expect(accountsService.recalculateCurrentBalance).toHaveBeenCalledWith(
        "account-3",
      );
      expect(accountsService.recalculateCurrentBalance).toHaveBeenCalledWith(
        "account-1",
      );
      expect(accountsService.recalculateCurrentBalance).toHaveBeenCalledWith(
        "account-2",
      );
    });
  });

  describe("updateTransfer", () => {
    const fromTransaction = {
      id: "from-tx",
      accountId: "from-account",
      amount: -500,
      isTransfer: true,
      linkedTransactionId: "to-tx",
      exchangeRate: 1,
      account: mockFromAccount,
    } as unknown as Transaction;

    const toTransaction = {
      id: "to-tx",
      accountId: "to-account",
      amount: 500,
      isTransfer: true,
      linkedTransactionId: "from-tx",
      exchangeRate: 1,
      account: mockToAccount,
    } as unknown as Transaction;

    beforeEach(() => {
      mockFindOne.mockReset();
    });

    it("throws when transaction is not a transfer", async () => {
      mockFindOne.mockResolvedValue({
        id: "tx-1",
        isTransfer: false,
        linkedTransactionId: null,
      });

      await expect(
        service.updateTransfer("user-1", "tx-1", {}, mockFindOne),
      ).rejects.toThrow(BadRequestException);
    });

    it("throws when source and destination accounts are the same after update", async () => {
      mockFindOne
        .mockResolvedValueOnce(fromTransaction)
        .mockResolvedValueOnce(toTransaction);

      await expect(
        service.updateTransfer(
          "user-1",
          "from-tx",
          { fromAccountId: "to-account" },
          mockFindOne,
        ),
      ).rejects.toThrow(BadRequestException);
    });

    it("updates amount for both sides of the transfer", async () => {
      mockFindOne
        .mockResolvedValueOnce(fromTransaction)
        .mockResolvedValueOnce(toTransaction)
        .mockResolvedValueOnce({ ...fromTransaction, amount: -750 })
        .mockResolvedValueOnce({ ...toTransaction, amount: 750 });

      const result = await service.updateTransfer(
        "user-1",
        "from-tx",
        { amount: 750 },
        mockFindOne,
      );

      // Old balances reversed
      expect(accountsService.updateBalance).toHaveBeenCalledWith(
        "from-account",
        500,
      );
      expect(accountsService.updateBalance).toHaveBeenCalledWith(
        "to-account",
        -500,
      );
      // New balances applied
      expect(accountsService.updateBalance).toHaveBeenCalledWith(
        "from-account",
        -750,
      );
      expect(accountsService.updateBalance).toHaveBeenCalledWith(
        "to-account",
        750,
      );

      expect(transactionsRepository.update).toHaveBeenCalledWith(
        "from-tx",
        expect.objectContaining({ amount: -750 }),
      );
      expect(transactionsRepository.update).toHaveBeenCalledWith(
        "to-tx",
        expect.objectContaining({ amount: 750 }),
      );

      expect(result.fromTransaction).toBeDefined();
      expect(result.toTransaction).toBeDefined();
    });

    it("updates description and other metadata without changing balances", async () => {
      mockFindOne
        .mockResolvedValueOnce(fromTransaction)
        .mockResolvedValueOnce(toTransaction)
        .mockResolvedValueOnce(fromTransaction)
        .mockResolvedValueOnce(toTransaction);

      await service.updateTransfer(
        "user-1",
        "from-tx",
        { description: "Updated description", referenceNumber: "REF-123" },
        mockFindOne,
      );

      // Balances should NOT be touched for metadata-only updates
      expect(accountsService.updateBalance).not.toHaveBeenCalled();

      expect(transactionsRepository.update).toHaveBeenCalledWith(
        "from-tx",
        expect.objectContaining({
          description: "Updated description",
          referenceNumber: "REF-123",
        }),
      );
    });

    describe("split transfer leg", () => {
      // A transfer split's counterpart in the target account. Its
      // linkedTransactionId points at the split PARENT (amount = sum of splits),
      // not a mirror leg.
      const splitParent = {
        id: "parent-tx",
        accountId: "from-account",
        amount: -1000,
        isSplit: true,
        transactionDate: "2020-01-01",
      } as unknown as Transaction;

      const counterpartLeg = {
        id: "leg-tx",
        accountId: "to-account",
        amount: 500,
        isTransfer: true,
        linkedTransactionId: "parent-tx",
        transactionDate: "2020-01-01",
      } as unknown as Transaction;

      const parentSplit = {
        id: "split-1",
        transactionId: "parent-tx",
        transferAccountId: "to-account",
        amount: -500,
        linkedTransactionId: "leg-tx",
      } as unknown as TransactionSplit;

      it("edits only the leg's metadata and never rewrites the split parent's amount", async () => {
        splitsRepository.findOne.mockResolvedValue(parentSplit);
        mockFindOne
          .mockResolvedValueOnce(counterpartLeg) // transaction being edited
          .mockResolvedValueOnce(splitParent) // parent lookup
          .mockResolvedValueOnce(counterpartLeg); // refreshed leg

        // Mirrors the form payload: amount resent unchanged, accounts unchanged.
        await service.updateTransfer(
          "user-1",
          "leg-tx",
          {
            amount: 500,
            fromAccountId: "from-account",
            toAccountId: "to-account",
            description: "New note",
            fromCurrencyCode: "USD",
            toCurrencyCode: "USD",
          } as any,
          mockFindOne,
        );

        // The leg gets its own note...
        expect(transactionsRepository.update).toHaveBeenCalledWith(
          "leg-tx",
          expect.objectContaining({ description: "New note" }),
        );
        // ...and the note mirrors back to the source split's memo.
        expect(transactionsRepository.update).toHaveBeenCalledWith(
          "split-1",
          expect.objectContaining({ memo: "New note" }),
        );
        // The parent split's amount is never rewritten.
        expect(transactionsRepository.update).not.toHaveBeenCalledWith(
          "parent-tx",
          expect.anything(),
        );
        // No amount change => no balance movement.
        expect(accountsService.updateBalance).not.toHaveBeenCalled();
      });

      it("syncs a leg amount change into the split row, parent total, and both balances", async () => {
        splitsRepository.findOne.mockResolvedValue(parentSplit);
        splitsRepository.find.mockResolvedValue([
          { id: "split-1", amount: -500 },
          { id: "split-2", amount: -500 },
        ]);
        mockFindOne
          .mockResolvedValueOnce(counterpartLeg)
          .mockResolvedValueOnce(splitParent)
          .mockResolvedValueOnce({ ...counterpartLeg, amount: 600 });

        await service.updateTransfer(
          "user-1",
          "leg-tx",
          {
            amount: 600,
            fromAccountId: "from-account",
            toAccountId: "to-account",
          } as any,
          mockFindOne,
        );

        // Leg amount updated, matching split mirrored to -600.
        expect(transactionsRepository.update).toHaveBeenCalledWith(
          "leg-tx",
          expect.objectContaining({ amount: 600 }),
        );
        expect(transactionsRepository.update).toHaveBeenCalledWith(
          "split-1",
          expect.objectContaining({ amount: -600 }),
        );
        // Parent total = sum of splits = -600 + -500 = -1100.
        expect(transactionsRepository.update).toHaveBeenCalledWith(
          "parent-tx",
          expect.objectContaining({ amount: -1100 }),
        );
        // Target account gains the +100 delta; source account absorbs -100.
        expect(accountsService.updateBalance).toHaveBeenCalledWith(
          "to-account",
          100,
        );
        expect(accountsService.updateBalance).toHaveBeenCalledWith(
          "from-account",
          -100,
        );
      });

      it("rejects moving a split transfer leg to a different account", async () => {
        splitsRepository.findOne.mockResolvedValue(parentSplit);
        mockFindOne
          .mockResolvedValueOnce(counterpartLeg)
          .mockResolvedValueOnce(splitParent);

        await expect(
          service.updateTransfer(
            "user-1",
            "leg-tx",
            { toAccountId: "other-account" } as any,
            mockFindOne,
          ),
        ).rejects.toThrow(BadRequestException);

        expect(transactionsRepository.update).not.toHaveBeenCalled();
      });
    });

    it("rewrites created_at on both legs via raw query when createdAt is provided", async () => {
      mockFindOne
        .mockResolvedValueOnce(fromTransaction)
        .mockResolvedValueOnce(toTransaction)
        .mockResolvedValueOnce(fromTransaction)
        .mockResolvedValueOnce(toTransaction);

      await service.updateTransfer(
        "user-1",
        "from-tx",
        { createdAt: "2026-01-10T12:34:56.000Z" } as any,
        mockFindOne,
      );

      const createdAtCalls = mockQueryRunner.manager.query.mock.calls.filter(
        (c: any[]) =>
          typeof c[0] === "string" && c[0].includes("SET created_at"),
      );
      expect(createdAtCalls).toHaveLength(2);
      expect(createdAtCalls[0][1]).toEqual([
        expect.stringContaining("2026-01-10 12:34:56"),
        "from-tx",
      ]);
      expect(createdAtCalls[1][1][1]).toBe("to-tx");
    });

    it("updates the source and destination currency codes when provided", async () => {
      mockFindOne
        .mockResolvedValueOnce(fromTransaction)
        .mockResolvedValueOnce(toTransaction)
        .mockResolvedValueOnce(fromTransaction)
        .mockResolvedValueOnce(toTransaction);

      await service.updateTransfer(
        "user-1",
        "from-tx",
        { fromCurrencyCode: "EUR", toCurrencyCode: "GBP" },
        mockFindOne,
      );

      expect(transactionsRepository.update).toHaveBeenCalledWith(
        "from-tx",
        expect.objectContaining({ currencyCode: "EUR" }),
      );
      expect(transactionsRepository.update).toHaveBeenCalledWith(
        "to-tx",
        expect.objectContaining({ currencyCode: "GBP" }),
      );
    });

    it("updates account IDs and adjusts payee names", async () => {
      const newToAccount = {
        id: "new-to-account",
        name: "Investment",
        currencyCode: "USD",
      };
      accountsService.findOne.mockImplementation(
        (_userId: string, accountId: string) => {
          if (accountId === "new-to-account")
            return Promise.resolve(newToAccount);
          if (accountId === "from-account")
            return Promise.resolve(mockFromAccount);
          return Promise.resolve(mockToAccount);
        },
      );

      mockFindOne
        .mockResolvedValueOnce(fromTransaction)
        .mockResolvedValueOnce(toTransaction)
        .mockResolvedValueOnce({ ...fromTransaction })
        .mockResolvedValueOnce({
          ...toTransaction,
          accountId: "new-to-account",
        });

      await service.updateTransfer(
        "user-1",
        "from-tx",
        { toAccountId: "new-to-account" },
        mockFindOne,
      );

      // from-tx should get updated payeeName
      expect(transactionsRepository.update).toHaveBeenCalledWith(
        "from-tx",
        expect.objectContaining({
          payeeName: "Transfer to Investment",
        }),
      );

      // to-tx should get new accountId
      expect(transactionsRepository.update).toHaveBeenCalledWith(
        "to-tx",
        expect.objectContaining({
          accountId: "new-to-account",
        }),
      );
    });

    it("handles cross-currency exchange rate update", async () => {
      mockFindOne
        .mockResolvedValueOnce(fromTransaction)
        .mockResolvedValueOnce(toTransaction)
        .mockResolvedValueOnce(fromTransaction)
        .mockResolvedValueOnce(toTransaction);

      await service.updateTransfer(
        "user-1",
        "from-tx",
        { exchangeRate: 1.35 },
        mockFindOne,
      );

      // 500 * 1.35 = 675
      expect(transactionsRepository.update).toHaveBeenCalledWith(
        "to-tx",
        expect.objectContaining({ amount: 675 }),
      );

      expect(accountsService.updateBalance).toHaveBeenCalledWith(
        "to-account",
        675,
      );
    });

    it("uses explicit toAmount over calculated amount", async () => {
      mockFindOne
        .mockResolvedValueOnce(fromTransaction)
        .mockResolvedValueOnce(toTransaction)
        .mockResolvedValueOnce(fromTransaction)
        .mockResolvedValueOnce(toTransaction);

      await service.updateTransfer(
        "user-1",
        "from-tx",
        { toAmount: 680 },
        mockFindOne,
      );

      expect(transactionsRepository.update).toHaveBeenCalledWith(
        "to-tx",
        expect.objectContaining({ amount: 680 }),
      );
    });

    it("correctly identifies from/to when called with to-transaction ID", async () => {
      // When the to-tx (positive amount) is passed as the transactionId
      mockFindOne
        .mockResolvedValueOnce(toTransaction)
        .mockResolvedValueOnce(fromTransaction)
        .mockResolvedValueOnce(fromTransaction)
        .mockResolvedValueOnce(toTransaction);

      await service.updateTransfer(
        "user-1",
        "to-tx",
        { amount: 600 },
        mockFindOne,
      );

      // Should update from-tx with negative amount
      expect(transactionsRepository.update).toHaveBeenCalledWith(
        "from-tx",
        expect.objectContaining({ amount: -600 }),
      );
    });

    it("regenerates default payeeName for both transactions when payeeName is explicitly cleared with null", async () => {
      mockFindOne
        .mockResolvedValueOnce(fromTransaction)
        .mockResolvedValueOnce(toTransaction)
        .mockResolvedValueOnce(fromTransaction)
        .mockResolvedValueOnce(toTransaction);

      await service.updateTransfer(
        "user-1",
        "from-tx",
        { payeeId: null, payeeName: null },
        mockFindOne,
      );

      // Default payee names regenerated from account names
      expect(transactionsRepository.update).toHaveBeenCalledWith(
        "from-tx",
        expect.objectContaining({
          payeeId: null,
          payeeName: "Transfer to Savings",
        }),
      );
      expect(transactionsRepository.update).toHaveBeenCalledWith(
        "to-tx",
        expect.objectContaining({
          payeeId: null,
          payeeName: "Transfer from Checking",
        }),
      );
    });

    it("regenerates default payeeName when payeeName is cleared with empty string", async () => {
      mockFindOne
        .mockResolvedValueOnce(fromTransaction)
        .mockResolvedValueOnce(toTransaction)
        .mockResolvedValueOnce(fromTransaction)
        .mockResolvedValueOnce(toTransaction);

      await service.updateTransfer(
        "user-1",
        "from-tx",
        { payeeName: "" },
        mockFindOne,
      );

      expect(transactionsRepository.update).toHaveBeenCalledWith(
        "from-tx",
        expect.objectContaining({ payeeName: "Transfer to Savings" }),
      );
      expect(transactionsRepository.update).toHaveBeenCalledWith(
        "to-tx",
        expect.objectContaining({ payeeName: "Transfer from Checking" }),
      );
    });

    it("does not modify description when only clearing the payee", async () => {
      mockFindOne
        .mockResolvedValueOnce(fromTransaction)
        .mockResolvedValueOnce(toTransaction)
        .mockResolvedValueOnce(fromTransaction)
        .mockResolvedValueOnce(toTransaction);

      await service.updateTransfer(
        "user-1",
        "from-tx",
        { payeeId: null, payeeName: null },
        mockFindOne,
      );

      const fromCall = transactionsRepository.update.mock.calls.find(
        (c: any[]) => c[0] === "from-tx",
      );
      expect(fromCall[1]).not.toHaveProperty("description");
    });

    it("regenerates auto-generated payeeName when destination account changes and frontend re-sends the old auto-generated value", async () => {
      // Simulates the frontend behavior: when editing a transfer, the form
      // always re-sends payeeName (the previous auto-generated value), so
      // payeeName !== undefined but should still be regenerated.
      const newToAccount = {
        id: "new-to-account",
        name: "Investment",
        currencyCode: "USD",
      };
      accountsService.findOne.mockImplementation(
        (_userId: string, accountId: string) => {
          if (accountId === "new-to-account")
            return Promise.resolve(newToAccount);
          if (accountId === "from-account")
            return Promise.resolve(mockFromAccount);
          return Promise.resolve(mockToAccount);
        },
      );

      const fromWithAutoPayee = {
        ...fromTransaction,
        payeeId: null,
        payeeName: "Transfer to Savings",
      } as unknown as Transaction;
      const toWithAutoPayee = {
        ...toTransaction,
        payeeId: null,
        payeeName: "Transfer from Checking",
      } as unknown as Transaction;

      mockFindOne
        .mockResolvedValueOnce(fromWithAutoPayee)
        .mockResolvedValueOnce(toWithAutoPayee)
        .mockResolvedValueOnce(fromWithAutoPayee)
        .mockResolvedValueOnce({
          ...toWithAutoPayee,
          accountId: "new-to-account",
        });

      await service.updateTransfer(
        "user-1",
        "from-tx",
        {
          toAccountId: "new-to-account",
          payeeId: null,
          payeeName: "Transfer to Savings",
        },
        mockFindOne,
      );

      expect(transactionsRepository.update).toHaveBeenCalledWith(
        "from-tx",
        expect.objectContaining({ payeeName: "Transfer to Investment" }),
      );
    });

    it("regenerates auto-generated payeeName on the to-side when source account changes", async () => {
      const newFromAccount = {
        id: "new-from-account",
        name: "Brokerage",
        currencyCode: "USD",
      };
      accountsService.findOne.mockImplementation(
        (_userId: string, accountId: string) => {
          if (accountId === "new-from-account")
            return Promise.resolve(newFromAccount);
          if (accountId === "to-account") return Promise.resolve(mockToAccount);
          return Promise.resolve(mockFromAccount);
        },
      );

      const fromWithAutoPayee = {
        ...fromTransaction,
        payeeId: null,
        payeeName: "Transfer to Savings",
      } as unknown as Transaction;
      const toWithAutoPayee = {
        ...toTransaction,
        payeeId: null,
        payeeName: "Transfer from Checking",
      } as unknown as Transaction;

      mockFindOne
        .mockResolvedValueOnce(fromWithAutoPayee)
        .mockResolvedValueOnce(toWithAutoPayee)
        .mockResolvedValueOnce({
          ...fromWithAutoPayee,
          accountId: "new-from-account",
        })
        .mockResolvedValueOnce(toWithAutoPayee);

      await service.updateTransfer(
        "user-1",
        "from-tx",
        {
          fromAccountId: "new-from-account",
          payeeId: null,
          payeeName: "Transfer from Checking",
        },
        mockFindOne,
      );

      expect(transactionsRepository.update).toHaveBeenCalledWith(
        "to-tx",
        expect.objectContaining({ payeeName: "Transfer from Brokerage" }),
      );
    });

    it("does not regenerate payeeName when destination account changes but payee was user-set (payeeId present)", async () => {
      const newToAccount = {
        id: "new-to-account",
        name: "Investment",
        currencyCode: "USD",
      };
      accountsService.findOne.mockImplementation(
        (_userId: string, accountId: string) => {
          if (accountId === "new-to-account")
            return Promise.resolve(newToAccount);
          if (accountId === "from-account")
            return Promise.resolve(mockFromAccount);
          return Promise.resolve(mockToAccount);
        },
      );

      const fromWithLinkedPayee = {
        ...fromTransaction,
        payeeId: "payee-1",
        payeeName: "Transfer to Savings",
      } as unknown as Transaction;

      mockFindOne
        .mockResolvedValueOnce(fromWithLinkedPayee)
        .mockResolvedValueOnce(toTransaction)
        .mockResolvedValueOnce(fromWithLinkedPayee)
        .mockResolvedValueOnce({
          ...toTransaction,
          accountId: "new-to-account",
        });

      await service.updateTransfer(
        "user-1",
        "from-tx",
        {
          toAccountId: "new-to-account",
          payeeId: "payee-1",
          payeeName: "Transfer to Savings",
        },
        mockFindOne,
      );

      const fromCall = transactionsRepository.update.mock.calls.find(
        (c: any[]) => c[0] === "from-tx",
      );
      expect(fromCall[1].payeeName).toBe("Transfer to Savings");
    });

    it("does not update payeeName when custom payeeName is set", async () => {
      accountsService.findOne.mockImplementation(
        (_userId: string, accountId: string) => {
          if (accountId === "new-to-account")
            return Promise.resolve({
              id: "new-to-account",
              name: "Investment",
              currencyCode: "USD",
            });
          return Promise.resolve(mockFromAccount);
        },
      );

      mockFindOne
        .mockResolvedValueOnce(fromTransaction)
        .mockResolvedValueOnce(toTransaction)
        .mockResolvedValueOnce(fromTransaction)
        .mockResolvedValueOnce(toTransaction);

      await service.updateTransfer(
        "user-1",
        "from-tx",
        { toAccountId: "new-to-account", payeeName: "Custom Name" },
        mockFindOne,
      );

      expect(transactionsRepository.update).toHaveBeenCalledWith(
        "from-tx",
        expect.objectContaining({ payeeName: "Custom Name" }),
      );
    });

    it("triggers net worth recalc for all affected accounts", async () => {
      const newToAccount = {
        id: "new-to-account",
        name: "Investment",
        currencyCode: "USD",
      };
      accountsService.findOne.mockImplementation(
        (_userId: string, accountId: string) => {
          if (accountId === "new-to-account")
            return Promise.resolve(newToAccount);
          return Promise.resolve(mockFromAccount);
        },
      );

      mockFindOne
        .mockResolvedValueOnce(fromTransaction)
        .mockResolvedValueOnce(toTransaction)
        .mockResolvedValueOnce(fromTransaction)
        .mockResolvedValueOnce(toTransaction);

      await service.updateTransfer(
        "user-1",
        "from-tx",
        { toAccountId: "new-to-account" },
        mockFindOne,
      );

      // Old and new accounts should all get recalculated
      expect(netWorthService.triggerDebouncedRecalc).toHaveBeenCalledWith(
        "from-account",
        "user-1",
      );
      expect(netWorthService.triggerDebouncedRecalc).toHaveBeenCalledWith(
        "to-account",
        "user-1",
      );
      expect(netWorthService.triggerDebouncedRecalc).toHaveBeenCalledWith(
        "new-to-account",
        "user-1",
      );
    });

    it("skips transactionsRepository.update when no fields changed", async () => {
      mockFindOne
        .mockResolvedValueOnce(fromTransaction)
        .mockResolvedValueOnce(toTransaction)
        .mockResolvedValueOnce(fromTransaction)
        .mockResolvedValueOnce(toTransaction);

      await service.updateTransfer("user-1", "from-tx", {}, mockFindOne);

      expect(transactionsRepository.update).not.toHaveBeenCalled();
      expect(accountsService.updateBalance).not.toHaveBeenCalled();
    });
  });

  describe("future-dated transfers", () => {
    const futureDate = "2099-12-31";
    const currentDate = "2026-01-15";

    describe("createTransfer", () => {
      it("does not call updateBalance when creating a future-dated transfer", async () => {
        mockedIsTransactionInFuture.mockReturnValue(true);

        const dto = { ...baseTransferDto, transactionDate: futureDate };

        transactionsRepository.save
          .mockReset()
          .mockResolvedValueOnce({ id: "from-tx-id", ...dto, amount: -500 })
          .mockResolvedValueOnce({ id: "to-tx-id", ...dto, amount: 500 });

        mockFindOne
          .mockResolvedValueOnce({ id: "from-tx-id", amount: -500 })
          .mockResolvedValueOnce({ id: "to-tx-id", amount: 500 });

        await service.createTransfer("user-1", dto, mockFindOne);

        expect(accountsService.updateBalance).not.toHaveBeenCalled();
      });
    });

    describe("removeTransfer", () => {
      it("does not call updateBalance when removing a future-dated transfer", async () => {
        mockedIsTransactionInFuture.mockReturnValue(true);

        const fromTx = {
          id: "from-tx",
          isTransfer: true,
          linkedTransactionId: "to-tx",
          accountId: "from-account",
          amount: -500,
          transactionDate: futureDate,
        };
        const toTx = {
          id: "to-tx",
          accountId: "to-account",
          amount: 500,
          transactionDate: futureDate,
        };

        mockFindOne.mockResolvedValue(fromTx);
        splitsRepository.findOne.mockResolvedValue(null);
        transactionsRepository.findOne.mockResolvedValue(toTx);

        await service.removeTransfer("user-1", "from-tx", mockFindOne);

        expect(accountsService.updateBalance).not.toHaveBeenCalled();
        expect(mockQueryRunner.manager.delete).toHaveBeenCalledWith(
          Transaction,
          { id: "to-tx", userId: "user-1" },
        );
        expect(mockQueryRunner.manager.delete).toHaveBeenCalledWith(
          Transaction,
          { id: "from-tx", userId: "user-1" },
        );
      });
    });

    describe("updateTransfer", () => {
      const fromTransaction = {
        id: "from-tx",
        accountId: "from-account",
        amount: -500,
        isTransfer: true,
        linkedTransactionId: "to-tx",
        exchangeRate: 1,
        account: mockFromAccount,
        transactionDate: currentDate,
      } as unknown as Transaction;

      const toTransaction = {
        id: "to-tx",
        accountId: "to-account",
        amount: 500,
        isTransfer: true,
        linkedTransactionId: "from-tx",
        exchangeRate: 1,
        account: mockToAccount,
        transactionDate: currentDate,
      } as unknown as Transaction;

      const futureFromTransaction = {
        ...fromTransaction,
        transactionDate: futureDate,
      } as unknown as Transaction;

      const futureToTransaction = {
        ...toTransaction,
        transactionDate: futureDate,
      } as unknown as Transaction;

      it("applies new balances when updating from future to current date", async () => {
        // Old date is future, new date is current
        mockedIsTransactionInFuture.mockImplementation(
          (date: string) => date === futureDate,
        );

        mockFindOne
          .mockResolvedValueOnce(futureFromTransaction)
          .mockResolvedValueOnce(futureToTransaction)
          .mockResolvedValueOnce({ ...fromTransaction })
          .mockResolvedValueOnce({ ...toTransaction });

        await service.updateTransfer(
          "user-1",
          "from-tx",
          { transactionDate: currentDate },
          mockFindOne,
        );

        // When any future date is involved, recalculate from scratch
        expect(accountsService.recalculateCurrentBalance).toHaveBeenCalledWith(
          "from-account",
        );
        expect(accountsService.recalculateCurrentBalance).toHaveBeenCalledWith(
          "to-account",
        );
        expect(accountsService.updateBalance).not.toHaveBeenCalled();
      });

      it("reverses old balances when updating from current to future date", async () => {
        // Old date is current, new date is future
        mockedIsTransactionInFuture.mockImplementation(
          (date: string) => date === futureDate,
        );

        mockFindOne
          .mockResolvedValueOnce(fromTransaction)
          .mockResolvedValueOnce(toTransaction)
          .mockResolvedValueOnce({ ...futureFromTransaction })
          .mockResolvedValueOnce({ ...futureToTransaction });

        await service.updateTransfer(
          "user-1",
          "from-tx",
          { transactionDate: futureDate },
          mockFindOne,
        );

        // When any future date is involved, recalculate from scratch
        expect(accountsService.recalculateCurrentBalance).toHaveBeenCalledWith(
          "from-account",
        );
        expect(accountsService.recalculateCurrentBalance).toHaveBeenCalledWith(
          "to-account",
        );
        expect(accountsService.updateBalance).not.toHaveBeenCalled();
      });
    });
  });

  describe("transaction atomicity", () => {
    it("createTransfer runs its writes in a single tenant transaction", async () => {
      transactionsRepository.save
        .mockReset()
        .mockResolvedValueOnce({ id: "from-tx-id" })
        .mockResolvedValueOnce({ id: "to-tx-id" });

      mockFindOne
        .mockResolvedValueOnce({ id: "from-tx-id" })
        .mockResolvedValueOnce({ id: "to-tx-id" });

      await service.createTransfer("user-1", baseTransferDto, mockFindOne);

      // All the writes are grouped into a single tenant transaction.
      expect(mockDataSource.transaction).toHaveBeenCalledTimes(1);
    });

    it("createTransfer propagates write errors so the tenant transaction rolls back", async () => {
      transactionsRepository.save
        .mockReset()
        .mockRejectedValue(new Error("DB error"));

      await expect(
        service.createTransfer("user-1", baseTransferDto, mockFindOne),
      ).rejects.toThrow("DB error");

      // One withScopedDb groups every write; the rejection above is what makes
      // the surrounding transaction roll back.
      expect(mockDataSource.transaction).toHaveBeenCalledTimes(1);
    });

    it("removeTransfer runs its writes in a single tenant transaction", async () => {
      const fromTx = {
        id: "from-tx",
        isTransfer: true,
        linkedTransactionId: null,
        accountId: "from-account",
        amount: -500,
      };

      mockFindOne.mockResolvedValue(fromTx);
      splitsRepository.findOne.mockResolvedValue(null);

      await service.removeTransfer("user-1", "from-tx", mockFindOne);

      // The split-parent lookup is its own short read transaction (as the
      // pre-RLS autocommit read was); every write lands in one withScopedDb.
      expect(mockDataSource.transaction).toHaveBeenCalledTimes(2);
    });

    it("removeTransfer propagates write errors so the tenant transaction rolls back", async () => {
      const fromTx = {
        id: "from-tx",
        isTransfer: true,
        linkedTransactionId: null,
        accountId: "from-account",
        amount: -500,
      };

      mockFindOne.mockResolvedValue(fromTx);
      splitsRepository.findOne.mockResolvedValue(null);
      accountsService.updateBalance.mockRejectedValueOnce(
        new Error("Balance error"),
      );

      await expect(
        service.removeTransfer("user-1", "from-tx", mockFindOne),
      ).rejects.toThrow("Balance error");

      // Lookup + write block; the rejection above is what makes the
      // surrounding write transaction roll back.
      expect(mockDataSource.transaction).toHaveBeenCalledTimes(2);
    });

    it("updateTransfer runs its writes in a single tenant transaction", async () => {
      const fromTx = {
        id: "from-tx",
        accountId: "from-account",
        amount: -500,
        isTransfer: true,
        linkedTransactionId: "to-tx",
        exchangeRate: 1,
        account: mockFromAccount,
        transactionDate: "2026-01-15",
      } as unknown as Transaction;

      const toTx = {
        id: "to-tx",
        accountId: "to-account",
        amount: 500,
        isTransfer: true,
        linkedTransactionId: "from-tx",
        exchangeRate: 1,
        account: mockToAccount,
        transactionDate: "2026-01-15",
      } as unknown as Transaction;

      mockFindOne
        .mockResolvedValueOnce(fromTx)
        .mockResolvedValueOnce(toTx)
        .mockResolvedValueOnce({ ...fromTx, amount: -600 })
        .mockResolvedValueOnce({ ...toTx, amount: 600 });

      await service.updateTransfer(
        "user-1",
        "from-tx",
        { amount: 600 },
        mockFindOne,
      );

      // The split-parent lookup is its own short read transaction (as the
      // pre-RLS autocommit read was); every write lands in one withScopedDb.
      expect(mockDataSource.transaction).toHaveBeenCalledTimes(2);
    });

    it("updateTransfer propagates write errors so the tenant transaction rolls back", async () => {
      const fromTx = {
        id: "from-tx",
        accountId: "from-account",
        amount: -500,
        isTransfer: true,
        linkedTransactionId: "to-tx",
        exchangeRate: 1,
        account: mockFromAccount,
        transactionDate: "2026-01-15",
      } as unknown as Transaction;

      const toTx = {
        id: "to-tx",
        accountId: "to-account",
        amount: 500,
        isTransfer: true,
        linkedTransactionId: "from-tx",
        exchangeRate: 1,
        account: mockToAccount,
        transactionDate: "2026-01-15",
      } as unknown as Transaction;

      mockFindOne.mockResolvedValueOnce(fromTx).mockResolvedValueOnce(toTx);

      accountsService.updateBalance.mockRejectedValueOnce(
        new Error("DB error"),
      );

      await expect(
        service.updateTransfer(
          "user-1",
          "from-tx",
          { amount: 600 },
          mockFindOne,
        ),
      ).rejects.toThrow("DB error");

      // Lookup + write block; the rejection above is what makes the
      // surrounding write transaction roll back.
      expect(mockDataSource.transaction).toHaveBeenCalledTimes(2);
    });
  });

  describe("isTransfer", () => {
    it("returns true for a transfer leg", () => {
      expect(service.isTransfer({ isTransfer: true } as any)).toBe(true);
    });
    it("returns false for a normal transaction", () => {
      expect(service.isTransfer({ isTransfer: false } as any)).toBe(false);
    });
  });

  describe("previewCreateTransfer", () => {
    it("resolves accounts, derives currencies, and computes toAmount from exchangeRate", async () => {
      const preview = await service.previewCreateTransfer("user-1", {
        fromAccountId: "from-account",
        toAccountId: "to-account",
        amount: 100,
        transactionDate: "2026-01-15",
        exchangeRate: 1.25,
      });
      expect(preview).toMatchObject({
        fromAccountId: "from-account",
        fromAccountName: "Checking",
        fromCurrencyCode: "USD",
        toAccountId: "to-account",
        toAccountName: "Savings",
        toCurrencyCode: "USD",
        amount: 100,
        toAmount: 125,
        exchangeRate: 1.25,
        transactionDate: "2026-01-15",
        description: null,
        payeeName: null,
      });
    });

    it("uses an explicit toAmount over the exchange rate and strips html from description", async () => {
      const preview = await service.previewCreateTransfer("user-1", {
        fromAccountId: "from-account",
        toAccountId: "to-account",
        amount: 100,
        transactionDate: "2026-01-15",
        exchangeRate: 2,
        toAmount: 90,
        description: "Wire <b>x</b>",
      });
      expect(preview.toAmount).toBe(90);
      // stripHtml escapes angle brackets rather than emitting raw markup.
      expect(preview.description).not.toContain("<");
    });

    it("sets a custom payeeName, sanitized", async () => {
      const preview = await service.previewCreateTransfer("user-1", {
        fromAccountId: "from-account",
        toAccountId: "to-account",
        amount: 100,
        transactionDate: "2026-01-15",
        payeeName: "Rent <b>split</b>",
      });
      expect(preview.payeeName).toBeTruthy();
      expect(preview.payeeName).not.toContain("<");
    });

    it("defaults payeeName to null when omitted", async () => {
      const preview = await service.previewCreateTransfer("user-1", {
        fromAccountId: "from-account",
        toAccountId: "to-account",
        amount: 100,
        transactionDate: "2026-01-15",
      });
      expect(preview.payeeName).toBeNull();
      expect(preview.payeeId).toBeNull();
      expect(preview.payeeMatched).toBe(false);
      expect(preview.payeeWillBeCreated).toBe(false);
    });

    it("links payeeId and adopts the canonical name when the label matches an existing payee", async () => {
      payeesService.resolveByName.mockResolvedValue({
        id: "payee-1",
        name: "Buon Gusto Restaurant",
        defaultCategoryId: "cat-1",
      });
      const preview = await service.previewCreateTransfer("user-1", {
        fromAccountId: "from-account",
        toAccountId: "to-account",
        amount: 100,
        transactionDate: "2026-01-15",
        payeeName: "Buon Gusto",
      });
      expect(payeesService.resolveByName).toHaveBeenCalledWith(
        "user-1",
        "Buon Gusto",
      );
      expect(preview.payeeId).toBe("payee-1");
      expect(preview.payeeName).toBe("Buon Gusto Restaurant");
      expect(preview.payeeMatched).toBe(true);
      expect(preview.payeeWillBeCreated).toBe(false);
    });

    it("flags an unmatched label for creation by default", async () => {
      const preview = await service.previewCreateTransfer("user-1", {
        fromAccountId: "from-account",
        toAccountId: "to-account",
        amount: 100,
        transactionDate: "2026-01-15",
        payeeName: "Brand New Label",
      });
      expect(preview.payeeId).toBeNull();
      expect(preview.payeeMatched).toBe(false);
      expect(preview.payeeWillBeCreated).toBe(true);
      expect(preview.payeeName).toBe("Brand New Label");
    });

    it("keeps an unmatched label as free text when createPayeeIfMissing is false", async () => {
      const preview = await service.previewCreateTransfer("user-1", {
        fromAccountId: "from-account",
        toAccountId: "to-account",
        amount: 100,
        transactionDate: "2026-01-15",
        payeeName: "Brand New Label",
        createPayeeIfMissing: false,
      });
      expect(preview.payeeId).toBeNull();
      expect(preview.payeeMatched).toBe(false);
      expect(preview.payeeWillBeCreated).toBe(false);
      expect(preview.payeeName).toBe("Brand New Label");
    });

    it("rejects same source and destination account", async () => {
      await expect(
        service.previewCreateTransfer("user-1", {
          fromAccountId: "from-account",
          toAccountId: "from-account",
          amount: 100,
          transactionDate: "2026-01-15",
        }),
      ).rejects.toThrow(BadRequestException);
    });

    it("rejects a negative amount", async () => {
      await expect(
        service.previewCreateTransfer("user-1", {
          fromAccountId: "from-account",
          toAccountId: "to-account",
          amount: -1,
          transactionDate: "2026-01-15",
        }),
      ).rejects.toThrow(BadRequestException);
    });

    it("defaults category to null when no categoryId is given", async () => {
      const preview = await service.previewCreateTransfer("user-1", {
        fromAccountId: "from-account",
        toAccountId: "to-account",
        amount: 100,
        transactionDate: "2026-01-15",
      });
      expect(preview.categoryId).toBeNull();
      expect(preview.categoryName).toBeNull();
      expect(categoriesRepository.findOne).not.toHaveBeenCalled();
    });

    it("resolves an owned categoryId to its id and name", async () => {
      categoriesRepository.findOne.mockResolvedValue({
        id: "cat-1",
        name: "Savings Goal",
        userId: "user-1",
      });
      const preview = await service.previewCreateTransfer("user-1", {
        fromAccountId: "from-account",
        toAccountId: "to-account",
        amount: 100,
        transactionDate: "2026-01-15",
        categoryId: "cat-1",
      });
      expect(categoriesRepository.findOne).toHaveBeenCalledWith({
        where: { id: "cat-1", userId: "user-1" },
      });
      expect(preview.categoryId).toBe("cat-1");
      expect(preview.categoryName).toBe("Savings Goal");
    });

    it("rejects a categoryId the user does not own", async () => {
      categoriesRepository.findOne.mockResolvedValue(null);
      await expect(
        service.previewCreateTransfer("user-1", {
          fromAccountId: "from-account",
          toAccountId: "to-account",
          amount: 100,
          transactionDate: "2026-01-15",
          categoryId: "cat-x",
        }),
      ).rejects.toThrow(BadRequestException);
    });
  });

  describe("previewUpdateTransfer", () => {
    const fromLeg = {
      id: "from-tx",
      accountId: "from-account",
      account: { name: "Checking" },
      amount: -100,
      currencyCode: "USD",
      exchangeRate: 1,
      transactionDate: "2026-01-15",
      description: "old",
      payeeName: "Transfer to Savings",
      isTransfer: true,
      linkedTransactionId: "to-tx",
    };
    const toLeg = {
      id: "to-tx",
      accountId: "to-account",
      account: { name: "Savings" },
      amount: 100,
      currencyCode: "USD",
      exchangeRate: 1,
      transactionDate: "2026-01-15",
      description: "old",
      payeeName: "Transfer from Checking",
      isTransfer: true,
      linkedTransactionId: "from-tx",
    };

    it("determines canonical from/to legs and returns the resulting state", async () => {
      const findOne = jest.fn(async (_uid: string, id: string) =>
        id === "from-tx" ? fromLeg : toLeg,
      );
      const preview = await service.previewUpdateTransfer(
        "user-1",
        "from-tx",
        { amount: 200 },
        findOne as any,
      );
      expect(preview).toMatchObject({
        transactionId: "from-tx",
        fromAccountId: "from-account",
        fromAccountName: "Checking",
        toAccountId: "to-account",
        toAccountName: "Savings",
        amount: 200,
        toAmount: 200,
      });
    });

    it("keeps the existing from-leg payee link untouched when omitted", async () => {
      const findOne = jest.fn(async (_uid: string, id: string) =>
        id === "from-tx" ? { ...fromLeg, payeeId: "existing-payee" } : toLeg,
      );
      const preview = await service.previewUpdateTransfer(
        "user-1",
        "from-tx",
        { amount: 200 },
        findOne as any,
      );
      expect(preview.payeeName).toBe("Transfer to Savings");
      expect(preview.payeeId).toBe("existing-payee");
      expect(preview.payeeMatched).toBe(true);
      expect(preview.payeeWillBeCreated).toBe(false);
      expect(payeesService.resolveByName).not.toHaveBeenCalled();
    });

    it("sets a custom payeeName, sanitized, and flags creation for an unmatched label", async () => {
      const findOne = jest.fn(async (_uid: string, id: string) =>
        id === "from-tx" ? fromLeg : toLeg,
      );
      const preview = await service.previewUpdateTransfer(
        "user-1",
        "from-tx",
        { payeeName: "Shared rent <i>x</i>" },
        findOne as any,
      );
      expect(preview.payeeName).toBeTruthy();
      expect(preview.payeeName).not.toContain("<");
      expect(preview.payeeId).toBeNull();
      expect(preview.payeeMatched).toBe(false);
      expect(preview.payeeWillBeCreated).toBe(true);
    });

    it("links payeeId when a new label matches an existing payee", async () => {
      payeesService.resolveByName.mockResolvedValue({
        id: "payee-9",
        name: "Landlord LLC",
        defaultCategoryId: null,
      });
      const findOne = jest.fn(async (_uid: string, id: string) =>
        id === "from-tx" ? fromLeg : toLeg,
      );
      const preview = await service.previewUpdateTransfer(
        "user-1",
        "from-tx",
        { payeeName: "Landlord" },
        findOne as any,
      );
      expect(preview.payeeId).toBe("payee-9");
      expect(preview.payeeName).toBe("Landlord LLC");
      expect(preview.payeeMatched).toBe(true);
      expect(preview.payeeWillBeCreated).toBe(false);
    });

    it("keeps an unmatched new label as free text when createPayeeIfMissing is false", async () => {
      const findOne = jest.fn(async (_uid: string, id: string) =>
        id === "from-tx" ? fromLeg : toLeg,
      );
      const preview = await service.previewUpdateTransfer(
        "user-1",
        "from-tx",
        { payeeName: "Freeform", createPayeeIfMissing: false },
        findOne as any,
      );
      expect(preview.payeeId).toBeNull();
      expect(preview.payeeMatched).toBe(false);
      expect(preview.payeeWillBeCreated).toBe(false);
      expect(preview.payeeName).toBe("Freeform");
    });

    it("keeps the existing from-leg category when categoryId is omitted", async () => {
      const findOne = jest.fn(async (_uid: string, id: string) =>
        id === "from-tx"
          ? {
              ...fromLeg,
              categoryId: "cat-existing",
              category: { name: "Existing" },
            }
          : toLeg,
      );
      const preview = await service.previewUpdateTransfer(
        "user-1",
        "from-tx",
        { amount: 200 },
        findOne as any,
      );
      expect(preview.categoryId).toBe("cat-existing");
      expect(preview.categoryName).toBe("Existing");
      expect(categoriesRepository.findOne).not.toHaveBeenCalled();
    });

    it("resolves and validates a new category, returning its name", async () => {
      categoriesRepository.findOne.mockResolvedValue({
        id: "cat-1",
        name: "Investments: IKE",
      });
      const findOne = jest.fn(async (_uid: string, id: string) =>
        id === "from-tx" ? fromLeg : toLeg,
      );
      const preview = await service.previewUpdateTransfer(
        "user-1",
        "from-tx",
        { categoryId: "cat-1" },
        findOne as any,
      );
      expect(categoriesRepository.findOne).toHaveBeenCalledWith({
        where: { id: "cat-1", userId: "user-1" },
      });
      expect(preview.categoryId).toBe("cat-1");
      expect(preview.categoryName).toBe("Investments: IKE");
    });

    it("clears the category when categoryId is null", async () => {
      const findOne = jest.fn(async (_uid: string, id: string) =>
        id === "from-tx"
          ? {
              ...fromLeg,
              categoryId: "cat-existing",
              category: { name: "Existing" },
            }
          : toLeg,
      );
      const preview = await service.previewUpdateTransfer(
        "user-1",
        "from-tx",
        { categoryId: null },
        findOne as any,
      );
      expect(preview.categoryId).toBeNull();
      expect(preview.categoryName).toBeNull();
      expect(categoriesRepository.findOne).not.toHaveBeenCalled();
    });

    it("rejects a category that does not belong to the user", async () => {
      categoriesRepository.findOne.mockResolvedValue(null);
      const findOne = jest.fn(async (_uid: string, id: string) =>
        id === "from-tx" ? fromLeg : toLeg,
      );
      await expect(
        service.previewUpdateTransfer(
          "user-1",
          "from-tx",
          { categoryId: "cat-x" },
          findOne as any,
        ),
      ).rejects.toThrow(BadRequestException);
    });

    it("throws notATransfer when the target is not a transfer", async () => {
      const findOne = jest.fn(async () => ({
        id: "x",
        isTransfer: false,
        linkedTransactionId: null,
      }));
      await expect(
        service.previewUpdateTransfer("user-1", "x", {}, findOne as any),
      ).rejects.toThrow(BadRequestException);
    });
  });

  describe("cross-owner update / remove / linked (frozen-link spec)", () => {
    const actor = { effectiveUserId: "user-1", realUserId: "user-1" };
    const foreignAccount = {
      id: "to-account",
      name: "Owner Savings",
      currencyCode: "USD",
      userId: "owner-2",
    };

    let ownLeg: any;
    let foreignLeg: any;

    beforeEach(() => {
      ownLeg = {
        id: "own-leg",
        userId: "user-1",
        accountId: "from-account",
        amount: -500,
        exchangeRate: 1,
        transactionDate: "2026-01-15",
        currencyCode: "USD",
        isTransfer: true,
        linkedTransactionId: "foreign-leg",
        payeeId: null,
        payeeName: "Transfer to Owner Savings",
        account: mockFromAccount,
      };
      foreignLeg = {
        id: "foreign-leg",
        userId: "owner-2",
        accountId: "to-account",
        amount: 500,
        exchangeRate: 1,
        transactionDate: "2026-01-15",
        currencyCode: "USD",
        isTransfer: true,
        linkedTransactionId: "own-leg",
        payeeId: null,
        payeeName: "Transfer from Checking",
        account: foreignAccount,
      };

      // Owner-scoped findOne: the effective user reaches only their own leg.
      mockFindOne.mockImplementation(async (userId: string, id: string) => {
        if (userId === "user-1" && id === "own-leg") return ownLeg;
        if (userId === "owner-2" && id === "foreign-leg") return foreignLeg;
        throw new NotFoundException("Transaction not found");
      });

      // loadLegById's unscoped read.
      transactionsRepository.findOne.mockImplementation(async (opts: any) =>
        opts?.where?.id === "foreign-leg" ? foreignLeg : null,
      );

      mockedWithSystemContext.mockClear();
    });

    const connect = () =>
      crossOwnerAccess.accountAccessFor.mockResolvedValue({
        account: foreignAccount,
        ownerUserId: "owner-2",
        via: "delegation",
      });

    const freeze = () =>
      crossOwnerAccess.accountAccessFor.mockRejectedValue(
        new NotFoundException("Account not found"),
      );

    const denyOp = () =>
      crossOwnerAccess.accountAccessFor.mockRejectedValue(
        new ForbiddenException("not granted"),
      );

    describe("updateTransfer (connected)", () => {
      beforeEach(connect);

      it("mirrors the amount across both legs and rebalances both accounts under system context", async () => {
        await service.updateTransfer(
          "user-1",
          "own-leg",
          { amount: 600 },
          mockFindOne,
          actor,
        );

        expect(mockedWithSystemContext).toHaveBeenCalled();
        expect(transactionsRepository.update).toHaveBeenCalledWith("own-leg", {
          amount: -600,
        });
        expect(transactionsRepository.update).toHaveBeenCalledWith(
          "foreign-leg",
          { amount: 600 },
        );
        // Old amounts reversed, new applied.
        expect(accountsService.updateBalance).toHaveBeenCalledWith(
          "from-account",
          500,
        );
        expect(accountsService.updateBalance).toHaveBeenCalledWith(
          "to-account",
          -500,
        );
        expect(accountsService.updateBalance).toHaveBeenCalledWith(
          "from-account",
          -600,
        );
        expect(accountsService.updateBalance).toHaveBeenCalledWith(
          "to-account",
          600,
        );
        expect(netWorthService.triggerDebouncedRecalc).toHaveBeenCalledWith(
          "from-account",
          "user-1",
        );
        expect(netWorthService.triggerDebouncedRecalc).toHaveBeenCalledWith(
          "to-account",
          "owner-2",
        );
      });

      it("requires the edit grant for the REAL user on the counterpart account", async () => {
        await service.updateTransfer(
          "user-1",
          "own-leg",
          { description: "note" },
          mockFindOne,
          { effectiveUserId: "user-1", realUserId: "real-9" },
        );
        expect(crossOwnerAccess.accountAccessFor).toHaveBeenCalledWith(
          "real-9",
          "to-account",
          "edit",
        );
      });

      it("keeps status, category and payee off the foreign leg", async () => {
        await service.updateTransfer(
          "user-1",
          "own-leg",
          {
            status: "CLEARED" as any,
            categoryId: "cat-1",
            payeeId: "payee-1",
            description: "shared note",
          },
          mockFindOne,
          actor,
        );

        expect(transactionsRepository.update).toHaveBeenCalledWith("own-leg", {
          status: "CLEARED",
          categoryId: "cat-1",
          payeeId: "payee-1",
          description: "shared note",
        });
        // The foreign leg mirrors only the shared fields.
        expect(transactionsRepository.update).toHaveBeenCalledWith(
          "foreign-leg",
          { description: "shared note" },
        );
      });

      it("rejects account moves with crossOwnerAccountMoveLocked", async () => {
        await expect(
          service.updateTransfer(
            "user-1",
            "own-leg",
            { toAccountId: "somewhere-else" },
            mockFindOne,
            actor,
          ),
        ).rejects.toThrow(/cannot be moved/);
        expect(transactionsRepository.update).not.toHaveBeenCalled();
      });

      it("loads each result leg as its owner", async () => {
        const result = await service.updateTransfer(
          "user-1",
          "own-leg",
          { description: "x" },
          mockFindOne,
          actor,
        );
        expect(result.fromTransaction.id).toBe("own-leg");
        expect(result.toTransaction.id).toBe("foreign-leg");
        expect(mockFindOne).toHaveBeenCalledWith("owner-2", "foreign-leg");
      });
    });

    describe("updateTransfer (frozen)", () => {
      beforeEach(freeze);

      it("allows presentational own-leg edits without touching the counterpart or balances", async () => {
        const result = await service.updateTransfer(
          "user-1",
          "own-leg",
          {
            description: "mine",
            status: "CLEARED" as any,
            categoryId: "cat-1",
          },
          mockFindOne,
          actor,
        );

        expect(transactionsRepository.update).toHaveBeenCalledTimes(1);
        expect(transactionsRepository.update).toHaveBeenCalledWith("own-leg", {
          description: "mine",
          status: "CLEARED",
          categoryId: "cat-1",
        });
        expect(accountsService.updateBalance).not.toHaveBeenCalled();
        // Own leg returned in both slots -- nothing mirrored.
        expect(result.fromTransaction.id).toBe("own-leg");
        expect(result.toTransaction.id).toBe("own-leg");
      });

      it("accepts resent-but-unchanged structural fields", async () => {
        await expect(
          service.updateTransfer(
            "user-1",
            "own-leg",
            {
              amount: 500,
              transactionDate: "2026-01-15",
              fromAccountId: "from-account",
              toAccountId: "to-account",
              description: "still fine",
            },
            mockFindOne,
            actor,
          ),
        ).resolves.toBeDefined();
      });

      it.each([
        [{ amount: 999 }],
        [{ transactionDate: "2026-02-01" }],
        [{ toAccountId: "elsewhere" }],
        [{ exchangeRate: 2 }],
        [{ toAmount: 750 }],
      ])(
        "rejects the structural change %j with crossOwnerTransferLocked",
        async (dto) => {
          await expect(
            service.updateTransfer(
              "user-1",
              "own-leg",
              dto as any,
              mockFindOne,
              actor,
            ),
          ).rejects.toThrow(/locked/);
          expect(transactionsRepository.update).not.toHaveBeenCalled();
          expect(accountsService.updateBalance).not.toHaveBeenCalled();
        },
      );

      it("propagates 403 when the counterpart is readable but edit is not granted", async () => {
        denyOp();
        await expect(
          service.updateTransfer(
            "user-1",
            "own-leg",
            { description: "x" },
            mockFindOne,
            actor,
          ),
        ).rejects.toThrow(ForbiddenException);
      });
    });

    describe("removeTransfer (cross-owner)", () => {
      it("connected: removes both legs and reverses both balances under system context", async () => {
        connect();

        await service.removeTransfer("user-1", "own-leg", mockFindOne, actor);

        expect(crossOwnerAccess.accountAccessFor).toHaveBeenCalledWith(
          "user-1",
          "to-account",
          "delete",
        );
        expect(transactionsRepository.remove).toHaveBeenCalledTimes(2);
        expect(accountsService.updateBalance).toHaveBeenCalledWith(
          "to-account",
          -500,
        );
        expect(accountsService.updateBalance).toHaveBeenCalledWith(
          "from-account",
          500,
        );
        expect(netWorthService.triggerDebouncedRecalc).toHaveBeenCalledWith(
          "to-account",
          "owner-2",
        );
      });

      it("frozen: removes the own leg only and reverses only the own balance", async () => {
        freeze();

        await service.removeTransfer("user-1", "own-leg", mockFindOne, actor);

        expect(transactionsRepository.remove).toHaveBeenCalledTimes(1);
        expect(transactionsRepository.remove).toHaveBeenCalledWith(ownLeg);
        expect(accountsService.updateBalance).toHaveBeenCalledTimes(1);
        expect(accountsService.updateBalance).toHaveBeenCalledWith(
          "from-account",
          500,
        );
      });

      it("propagates 403 when the counterpart is readable but delete is not granted", async () => {
        denyOp();
        await expect(
          service.removeTransfer("user-1", "own-leg", mockFindOne, actor),
        ).rejects.toThrow(ForbiddenException);
        expect(transactionsRepository.remove).not.toHaveBeenCalled();
      });
    });

    describe("getLinkedTransaction (cross-owner)", () => {
      it("returns the counterpart when the real user can read its account", async () => {
        connect();
        const result = await service.getLinkedTransaction(
          "user-1",
          "own-leg",
          mockFindOne,
          actor,
        );
        expect(result).toBe(foreignLeg);
        expect(crossOwnerAccess.accountAccessFor).toHaveBeenCalledWith(
          "user-1",
          "to-account",
          "read",
        );
      });

      it("returns null when the counterpart account is unreadable", async () => {
        freeze();
        const result = await service.getLinkedTransaction(
          "user-1",
          "own-leg",
          mockFindOne,
          actor,
        );
        expect(result).toBeNull();
      });
    });
  });
});
