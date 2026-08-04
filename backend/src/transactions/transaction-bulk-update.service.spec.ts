import { Test, TestingModule } from "@nestjs/testing";
import { BadRequestException } from "@nestjs/common";
import { TransactionBulkUpdateService } from "./transaction-bulk-update.service";
import { buildTransactionSearchClause } from "./transaction-search.util";
import { Transaction, TransactionStatus } from "./entities/transaction.entity";
import { Category } from "../categories/entities/category.entity";
import { Payee } from "../payees/entities/payee.entity";
import { UserPreference } from "../users/entities/user-preference.entity";
import { AccountsService } from "../accounts/accounts.service";
import { NetWorthService } from "../net-worth/net-worth.service";
import { TagsService } from "../tags/tags.service";
import { BulkUpdateDto, BulkDeleteDto } from "./dto/bulk-update.dto";
import { Brackets, DataSource } from "typeorm";
import {
  createScopedDbMocks,
  DataSourceMock,
} from "../test-helpers/scoped-db-testing";

jest.mock("../common/db/scoped-db", () =>
  jest.requireActual("../test-helpers/scoped-db-testing").scopedDbMockModule(),
);

jest.mock("../common/date-utils", () => ({
  ...jest.requireActual("../common/date-utils"),
  isTransactionInFuture: jest.fn().mockReturnValue(false),
}));

describe("TransactionBulkUpdateService", () => {
  let service: TransactionBulkUpdateService;
  let transactionsRepository: Record<string, jest.Mock>;
  let categoriesRepository: Record<string, jest.Mock>;
  let payeesRepository: Record<string, jest.Mock>;
  let userPreferenceRepository: Record<string, jest.Mock>;
  let accountsService: Record<string, jest.Mock>;
  let netWorthService: Record<string, jest.Mock>;
  let tagsService: Record<string, jest.Mock>;
  let mockDataSource: DataSourceMock;
  let mockManagerCreateQueryBuilder: jest.Mock;
  let mockManagerGetRepository: jest.Mock;
  let mockManagerFind: jest.Mock;

  const userId = "user-1";

  const makeTransaction = (
    overrides: Partial<Transaction> = {},
  ): Transaction => {
    return {
      id: "tx-1",
      userId,
      accountId: "account-1",
      amount: 100,
      status: TransactionStatus.UNRECONCILED,
      transactionDate: "2026-01-15",
      currencyCode: "CAD",
      exchangeRate: 1,
      description: null,
      referenceNumber: null,
      reconciledDate: null,
      payeeId: null,
      payee: null,
      payeeName: null,
      categoryId: null,
      category: null,
      isSplit: false,
      parentTransactionId: null,
      isTransfer: false,
      linkedTransactionId: null,
      linkedTransaction: null,
      splits: [],
      createdAt: new Date("2026-01-15"),
      updatedAt: new Date("2026-01-15"),
      ...overrides,
    } as Transaction;
  };

  const createMockQueryBuilder = (
    overrides: Record<string, jest.Mock> = {},
  ) => ({
    select: jest.fn().mockReturnThis(),
    addSelect: jest.fn().mockReturnThis(),
    where: jest.fn().mockReturnThis(),
    andWhere: jest.fn().mockReturnThis(),
    leftJoin: jest.fn().mockReturnThis(),
    groupBy: jest.fn().mockReturnThis(),
    setParameter: jest.fn().mockReturnThis(),
    update: jest.fn().mockReturnThis(),
    set: jest.fn().mockReturnThis(),
    getMany: jest.fn().mockResolvedValue([]),
    getRawMany: jest.fn().mockResolvedValue([]),
    execute: jest.fn().mockResolvedValue({ affected: 0 }),
    ...overrides,
  });

  beforeEach(async () => {
    transactionsRepository = {
      createQueryBuilder: jest.fn().mockImplementation(() =>
        createMockQueryBuilder({
          getMany: jest.fn().mockResolvedValue([]),
        }),
      ),
    };

    categoriesRepository = {
      find: jest.fn().mockResolvedValue([]),
      findOne: jest.fn().mockResolvedValue(null),
    };

    payeesRepository = {
      findOne: jest.fn().mockResolvedValue(null),
    };

    userPreferenceRepository = {
      findOne: jest.fn().mockResolvedValue(null),
    };

    accountsService = {
      updateBalance: jest.fn().mockResolvedValue(undefined),
      recalculateCurrentBalance: jest.fn().mockResolvedValue(undefined),
    };

    netWorthService = {
      recalculateAccount: jest.fn().mockResolvedValue(undefined),
      triggerDebouncedRecalc: jest.fn(),
    };

    tagsService = {
      setTransactionTags: jest.fn().mockResolvedValue(undefined),
      setTransactionTagsBulk: jest.fn().mockResolvedValue(undefined),
      setSplitTagsBulk: jest.fn().mockResolvedValue(undefined),
    };

    // withScopedDb EntityManager with createQueryBuilder and entity-routed
    // getRepository.
    mockManagerCreateQueryBuilder = jest.fn();
    mockManagerFind = jest.fn().mockResolvedValue([]);
    // Entities with their own mock repositories route to them; anything else
    // (notably Transaction) falls back to a generic empty query builder.
    const routedRepos = new Map<unknown, Record<string, jest.Mock>>([
      [Transaction, transactionsRepository],
      [Category, categoriesRepository],
      [Payee, payeesRepository],
      [UserPreference, userPreferenceRepository],
    ]);
    mockManagerGetRepository = jest.fn().mockImplementation((entity: any) => {
      const routed = routedRepos.get(entity);
      if (routed) return routed;
      return {
        createQueryBuilder: jest.fn().mockReturnValue(
          createMockQueryBuilder({
            getMany: jest.fn().mockResolvedValue([]),
          }),
        ),
      };
    });

    const tenantMocks = createScopedDbMocks();
    mockDataSource = tenantMocks.dataSource;
    const manager = tenantMocks.manager;
    manager.createQueryBuilder = mockManagerCreateQueryBuilder;
    manager.getRepository = mockManagerGetRepository;
    // syncLinkedTransfers looks up owning splits to tell split-transfer
    // legs apart from plain transfer legs. Default: none (plain transfers).
    manager.find = mockManagerFind;

    const module: TestingModule = await Test.createTestingModule({
      providers: [
        TransactionBulkUpdateService,
        { provide: AccountsService, useValue: accountsService },
        { provide: NetWorthService, useValue: netWorthService },
        { provide: TagsService, useValue: tagsService },
        { provide: DataSource, useValue: mockDataSource },
      ],
    }).compile();

    service = module.get<TransactionBulkUpdateService>(
      TransactionBulkUpdateService,
    );
  });

  describe("bulkUpdate", () => {
    it("throws BadRequestException when no update fields are provided", async () => {
      const dto: BulkUpdateDto = {
        mode: "ids",
        transactionIds: ["tx-1"],
      };

      await expect(service.bulkUpdate(userId, dto)).rejects.toThrow(
        BadRequestException,
      );
    });

    it("returns zero updated when no transactions match (ids mode)", async () => {
      const resolveQb = createMockQueryBuilder({
        getMany: jest.fn().mockResolvedValue([]),
      });
      transactionsRepository.createQueryBuilder.mockReturnValue(resolveQb);

      const dto: BulkUpdateDto = {
        mode: "ids",
        transactionIds: ["nonexistent"],
        description: "test",
      };

      const result = await service.bulkUpdate(userId, dto);

      expect(result).toEqual({ updated: 0, skipped: 0, skippedReasons: [] });
    });

    it("updates transactions by explicit IDs", async () => {
      const tx1 = makeTransaction({ id: "tx-1" });
      const tx2 = makeTransaction({ id: "tx-2" });

      // First call: resolve IDs
      const resolveQb = createMockQueryBuilder({
        getMany: jest.fn().mockResolvedValue([{ id: "tx-1" }, { id: "tx-2" }]),
      });
      // Second call: exclusions
      const exclusionsQb = createMockQueryBuilder({
        getMany: jest.fn().mockResolvedValue([tx1, tx2]),
      });

      transactionsRepository.createQueryBuilder
        .mockReturnValueOnce(resolveQb)
        .mockReturnValueOnce(exclusionsQb);

      // Batch update goes through queryRunner.manager.createQueryBuilder()
      const updateQb = createMockQueryBuilder({
        execute: jest.fn().mockResolvedValue({ affected: 2 }),
      });
      mockManagerCreateQueryBuilder.mockReturnValueOnce(updateQb);

      const dto: BulkUpdateDto = {
        mode: "ids",
        transactionIds: ["tx-1", "tx-2"],
        description: "Bulk updated",
      };

      const result = await service.bulkUpdate(userId, dto);

      expect(result.updated).toBe(2);
      expect(result.skipped).toBe(0);
      expect(updateQb.set).toHaveBeenCalledWith(
        expect.objectContaining({ description: "Bulk updated" }),
      );
    });

    it("includes reconciled transactions in bulk updates", async () => {
      const tx1 = makeTransaction({ id: "tx-1" });
      const tx2 = makeTransaction({
        id: "tx-2",
        status: TransactionStatus.RECONCILED,
      });

      const resolveQb = createMockQueryBuilder({
        getMany: jest.fn().mockResolvedValue([{ id: "tx-1" }, { id: "tx-2" }]),
      });
      const exclusionsQb = createMockQueryBuilder({
        getMany: jest.fn().mockResolvedValue([tx1, tx2]),
      });

      transactionsRepository.createQueryBuilder
        .mockReturnValueOnce(resolveQb)
        .mockReturnValueOnce(exclusionsQb);

      // Batch update via queryRunner.manager
      const updateQb = createMockQueryBuilder({
        execute: jest.fn().mockResolvedValue({ affected: 2 }),
      });
      mockManagerCreateQueryBuilder.mockReturnValueOnce(updateQb);

      const dto: BulkUpdateDto = {
        mode: "ids",
        transactionIds: ["tx-1", "tx-2"],
        description: "test",
      };

      const result = await service.bulkUpdate(userId, dto);

      expect(result.updated).toBe(2);
      expect(result.skipped).toBe(0);
    });

    it("includes transfers when updating payee and syncs linked transactions", async () => {
      const tx1 = makeTransaction({ id: "tx-1" });
      const tx2 = makeTransaction({
        id: "tx-2",
        isTransfer: true,
        linkedTransactionId: "tx-2-linked",
      });

      // IDOR validation: payeeId is non-null so payeesRepository.findOne must return a match
      payeesRepository.findOne.mockResolvedValue({ id: "payee-1", userId });

      const resolveQb = createMockQueryBuilder({
        getMany: jest.fn().mockResolvedValue([{ id: "tx-1" }, { id: "tx-2" }]),
      });
      const exclusionsQb = createMockQueryBuilder({
        getMany: jest.fn().mockResolvedValue([tx1, tx2]),
      });

      transactionsRepository.createQueryBuilder
        .mockReturnValueOnce(resolveQb)
        .mockReturnValueOnce(exclusionsQb);

      // Batch update via queryRunner.manager
      const updateQb = createMockQueryBuilder({
        execute: jest.fn().mockResolvedValue({ affected: 2 }),
      });
      // Sync: getRepository returns a repo with createQueryBuilder for finding linked IDs
      const syncFindQb = createMockQueryBuilder({
        getMany: jest
          .fn()
          .mockResolvedValue([{ linkedTransactionId: "tx-2-linked" }]),
      });
      // Cross-owner filter: the linked leg belongs to the same user.
      const ownLinkedQb = createMockQueryBuilder({
        getMany: jest.fn().mockResolvedValue([{ id: "tx-2-linked" }]),
      });
      const syncUpdateQb = createMockQueryBuilder({
        execute: jest.fn().mockResolvedValue({ affected: 1 }),
      });
      transactionsRepository.createQueryBuilder
        .mockReturnValueOnce(syncFindQb)
        .mockReturnValue(ownLinkedQb);
      mockManagerCreateQueryBuilder
        .mockReturnValueOnce(updateQb)
        .mockReturnValueOnce(syncUpdateQb);

      const dto: BulkUpdateDto = {
        mode: "ids",
        transactionIds: ["tx-1", "tx-2"],
        payeeId: "payee-1",
        payeeName: "Store",
      };

      const result = await service.bulkUpdate(userId, dto);

      // Both transactions should be updated (transfers are no longer skipped)
      expect(result.updated).toBe(2);
      expect(result.skipped).toBe(0);
      // Linked transaction should also be updated
      expect(syncUpdateQb.execute).toHaveBeenCalled();
    });

    it("skips split transactions when updating category", async () => {
      const tx1 = makeTransaction({ id: "tx-1" });
      const tx2 = makeTransaction({ id: "tx-2", isSplit: true });

      // IDOR validation: categoryId is non-null so categoriesRepository.findOne must return a match
      categoriesRepository.findOne.mockResolvedValue({ id: "cat-1", userId });

      const resolveQb = createMockQueryBuilder({
        getMany: jest.fn().mockResolvedValue([{ id: "tx-1" }, { id: "tx-2" }]),
      });
      const exclusionsQb = createMockQueryBuilder({
        getMany: jest.fn().mockResolvedValue([tx1, tx2]),
      });

      transactionsRepository.createQueryBuilder
        .mockReturnValueOnce(resolveQb)
        .mockReturnValueOnce(exclusionsQb);

      // Batch update via queryRunner.manager
      const updateQb = createMockQueryBuilder({
        execute: jest.fn().mockResolvedValue({ affected: 1 }),
      });
      mockManagerCreateQueryBuilder.mockReturnValueOnce(updateQb);

      const dto: BulkUpdateDto = {
        mode: "ids",
        transactionIds: ["tx-1", "tx-2"],
        categoryId: "cat-1",
      };

      const result = await service.bulkUpdate(userId, dto);

      expect(result.updated).toBe(1);
      expect(result.skipped).toBe(1);
      expect(result.skippedReasons).toEqual(
        expect.arrayContaining([
          expect.stringContaining("1 split transaction"),
        ]),
      );
      expect(result.skippedReasons[0]).toContain("updated individually");
    });

    it("includes transfers when updating category (does not skip)", async () => {
      const tx1 = makeTransaction({ id: "tx-1" });
      const tx2 = makeTransaction({
        id: "tx-2",
        isTransfer: true,
        linkedTransactionId: "tx-2-linked",
      });

      categoriesRepository.findOne.mockResolvedValue({ id: "cat-1", userId });

      const resolveQb = createMockQueryBuilder({
        getMany: jest.fn().mockResolvedValue([{ id: "tx-1" }, { id: "tx-2" }]),
      });
      const exclusionsQb = createMockQueryBuilder({
        getMany: jest.fn().mockResolvedValue([tx1, tx2]),
      });

      transactionsRepository.createQueryBuilder
        .mockReturnValueOnce(resolveQb)
        .mockReturnValueOnce(exclusionsQb);

      const updateQb = createMockQueryBuilder({
        execute: jest.fn().mockResolvedValue({ affected: 2 }),
      });
      mockManagerCreateQueryBuilder.mockReturnValueOnce(updateQb);

      const dto: BulkUpdateDto = {
        mode: "ids",
        transactionIds: ["tx-1", "tx-2"],
        categoryId: "cat-1",
      };

      const result = await service.bulkUpdate(userId, dto);

      expect(result.updated).toBe(2);
      expect(result.skipped).toBe(0);
    });

    it("does not sync category to linked transfers", async () => {
      const tx1 = makeTransaction({
        id: "tx-1",
        isTransfer: true,
        linkedTransactionId: "tx-1-linked",
      });

      categoriesRepository.findOne.mockResolvedValue({ id: "cat-1", userId });

      const resolveQb = createMockQueryBuilder({
        getMany: jest.fn().mockResolvedValue([{ id: "tx-1" }]),
      });
      const exclusionsQb = createMockQueryBuilder({
        getMany: jest.fn().mockResolvedValue([tx1]),
      });

      transactionsRepository.createQueryBuilder
        .mockReturnValueOnce(resolveQb)
        .mockReturnValueOnce(exclusionsQb);

      const updateQb = createMockQueryBuilder({
        execute: jest.fn().mockResolvedValue({ affected: 1 }),
      });
      mockManagerCreateQueryBuilder.mockReturnValueOnce(updateQb);

      const dto: BulkUpdateDto = {
        mode: "ids",
        transactionIds: ["tx-1"],
        categoryId: "cat-1",
      };

      const result = await service.bulkUpdate(userId, dto);

      expect(result.updated).toBe(1);
      // Only one createQueryBuilder call for the main update; no sync update call
      expect(mockManagerCreateQueryBuilder).toHaveBeenCalledTimes(1);
    });

    it("syncs description to linked transfers", async () => {
      const tx1 = makeTransaction({
        id: "tx-1",
        isTransfer: true,
        linkedTransactionId: "tx-1-linked",
      });

      const resolveQb = createMockQueryBuilder({
        getMany: jest.fn().mockResolvedValue([{ id: "tx-1" }]),
      });
      const exclusionsQb = createMockQueryBuilder({
        getMany: jest.fn().mockResolvedValue([tx1]),
      });

      transactionsRepository.createQueryBuilder
        .mockReturnValueOnce(resolveQb)
        .mockReturnValueOnce(exclusionsQb);

      const updateQb = createMockQueryBuilder({
        execute: jest.fn().mockResolvedValue({ affected: 1 }),
      });
      const syncFindQb = createMockQueryBuilder({
        getMany: jest
          .fn()
          .mockResolvedValue([{ linkedTransactionId: "tx-1-linked" }]),
      });
      // Cross-owner filter: the linked leg belongs to the same user.
      const ownLinkedQb = createMockQueryBuilder({
        getMany: jest.fn().mockResolvedValue([{ id: "tx-1-linked" }]),
      });
      const syncUpdateQb = createMockQueryBuilder({
        execute: jest.fn().mockResolvedValue({ affected: 1 }),
      });
      transactionsRepository.createQueryBuilder
        .mockReturnValueOnce(syncFindQb)
        .mockReturnValue(ownLinkedQb);
      mockManagerCreateQueryBuilder
        .mockReturnValueOnce(updateQb)
        .mockReturnValueOnce(syncUpdateQb);

      const dto: BulkUpdateDto = {
        mode: "ids",
        transactionIds: ["tx-1"],
        description: "Updated description",
      };

      const result = await service.bulkUpdate(userId, dto);

      expect(result.updated).toBe(1);
      // The sync update should have been called for the linked transaction
      expect(syncUpdateQb.execute).toHaveBeenCalled();
    });

    it("mirrors description to the owning split's memo (not the parent) for split-transfer legs", async () => {
      // tx-1 is the counterpart leg of a SPLIT transfer: its
      // linkedTransactionId points at the split PARENT, and a split row owns
      // it. The description must land on the split memo, never on the parent.
      const tx1 = makeTransaction({
        id: "tx-1",
        isTransfer: true,
        linkedTransactionId: "parent-tx",
      });

      const resolveQb = createMockQueryBuilder({
        getMany: jest.fn().mockResolvedValue([{ id: "tx-1" }]),
      });
      const exclusionsQb = createMockQueryBuilder({
        getMany: jest.fn().mockResolvedValue([tx1]),
      });
      transactionsRepository.createQueryBuilder
        .mockReturnValueOnce(resolveQb)
        .mockReturnValueOnce(exclusionsQb);

      const updateQb = createMockQueryBuilder({
        execute: jest.fn().mockResolvedValue({ affected: 1 }),
      });
      const syncFindQb = createMockQueryBuilder({
        getMany: jest
          .fn()
          .mockResolvedValue([
            { id: "tx-1", linkedTransactionId: "parent-tx" },
          ]),
      });
      const memoUpdateQb = createMockQueryBuilder({
        execute: jest.fn().mockResolvedValue({ affected: 1 }),
      });
      transactionsRepository.createQueryBuilder.mockReturnValue(syncFindQb);
      // The owning-split lookup identifies tx-1 as a split-transfer leg.
      mockManagerFind.mockResolvedValue([
        { id: "split-1", linkedTransactionId: "tx-1" },
      ]);
      mockManagerCreateQueryBuilder
        .mockReturnValueOnce(updateQb)
        .mockReturnValueOnce(memoUpdateQb);

      const dto: BulkUpdateDto = {
        mode: "ids",
        transactionIds: ["tx-1"],
        description: "Y",
      };

      const result = await service.bulkUpdate(userId, dto);

      expect(result.updated).toBe(1);
      // Exactly two manager updates: the main field update and the split-memo
      // mirror. No third update writing syncFields to the parent transaction.
      expect(mockManagerCreateQueryBuilder).toHaveBeenCalledTimes(2);
      expect(memoUpdateQb.set).toHaveBeenCalledWith({ memo: "Y" });
      expect(memoUpdateQb.where).toHaveBeenCalledWith("id IN (:...ids)", {
        ids: ["split-1"],
      });
    });

    it("does not sync when no transfers have linked IDs", async () => {
      const tx1 = makeTransaction({
        id: "tx-1",
        isTransfer: true,
        linkedTransactionId: null,
      });

      payeesRepository.findOne.mockResolvedValue({ id: "payee-1", userId });

      const resolveQb = createMockQueryBuilder({
        getMany: jest.fn().mockResolvedValue([{ id: "tx-1" }]),
      });
      const exclusionsQb = createMockQueryBuilder({
        getMany: jest.fn().mockResolvedValue([tx1]),
      });

      transactionsRepository.createQueryBuilder
        .mockReturnValueOnce(resolveQb)
        .mockReturnValueOnce(exclusionsQb);

      const updateQb = createMockQueryBuilder({
        execute: jest.fn().mockResolvedValue({ affected: 1 }),
      });
      // Sync finds no linked IDs (the transfer has no linked transaction)
      const syncFindQb = createMockQueryBuilder({
        getMany: jest.fn().mockResolvedValue([]),
      });
      transactionsRepository.createQueryBuilder.mockReturnValue(syncFindQb);
      mockManagerCreateQueryBuilder.mockReturnValueOnce(updateQb);

      const dto: BulkUpdateDto = {
        mode: "ids",
        transactionIds: ["tx-1"],
        payeeId: "payee-1",
        payeeName: "Store",
      };

      const result = await service.bulkUpdate(userId, dto);

      expect(result.updated).toBe(1);
      // Only one createQueryBuilder call for main update; no sync update needed
      expect(mockManagerCreateQueryBuilder).toHaveBeenCalledTimes(1);
    });

    it("adjusts balances when changing status to VOID", async () => {
      const tx1 = makeTransaction({
        id: "tx-1",
        accountId: "acc-1",
        amount: 50,
      });
      const tx2 = makeTransaction({
        id: "tx-2",
        accountId: "acc-1",
        amount: -30,
      });

      const resolveQb = createMockQueryBuilder({
        getMany: jest.fn().mockResolvedValue([{ id: "tx-1" }, { id: "tx-2" }]),
      });
      const exclusionsQb = createMockQueryBuilder({
        getMany: jest.fn().mockResolvedValue([tx1, tx2]),
      });
      // Net worth recalc query (after commit, uses transactionsRepository)
      const accountIdsQb = createMockQueryBuilder({
        getRawMany: jest.fn().mockResolvedValue([{ accountId: "acc-1" }]),
      });

      // Balance deltas query goes through queryRunner.manager.getRepository(Transaction).createQueryBuilder()
      const balanceQb = createMockQueryBuilder({
        getRawMany: jest
          .fn()
          .mockResolvedValue([{ accountId: "acc-1", totalAmount: "20" }]),
      });

      // A status change re-reads the batch first, to expand a selected transfer
      // leg to its counterpart before any balance moves.
      const expansionQb = createMockQueryBuilder({
        getMany: exclusionsQb.getMany,
      });

      transactionsRepository.createQueryBuilder
        .mockReturnValueOnce(resolveQb)
        .mockReturnValueOnce(exclusionsQb)
        .mockReturnValueOnce(expansionQb)
        .mockReturnValueOnce(balanceQb)
        .mockReturnValueOnce(accountIdsQb);

      // Batch update goes through queryRunner.manager.createQueryBuilder()
      const updateQb = createMockQueryBuilder({
        execute: jest.fn().mockResolvedValue({ affected: 2 }),
      });
      mockManagerCreateQueryBuilder.mockReturnValueOnce(updateQb);

      const dto: BulkUpdateDto = {
        mode: "ids",
        transactionIds: ["tx-1", "tx-2"],
        status: TransactionStatus.VOID,
      };

      const result = await service.bulkUpdate(userId, dto);

      expect(result.updated).toBe(2);
      expect(accountsService.updateBalance).toHaveBeenCalledWith("acc-1", -20);
      expect(netWorthService.triggerDebouncedRecalc).toHaveBeenCalledWith(
        "acc-1",
        userId,
      );
    });

    // A linked transfer is one economic event. Voiding only the source leg used
    // to restore the source balance while the destination leg stayed active, so
    // 1,000.00 held across two accounts became 1,100.00.
    describe("a transfer's status changes on both legs", () => {
      /**
       * Wire the query sequence for a status update whose batch is `batchRows`,
       * where `counterpartRows` are the same-user rows the expansion is allowed
       * to pair with.
       */
      const wireStatusUpdate = (
        batchRows: Transaction[],
        counterpartRows: { id: string }[],
        // `m.find(TransactionSplit)` results in call order. The expansion asks
        // for owning splits only when the batch holds a transfer leg, and for a
        // split parent's children only when it holds a split parent, so the
        // order depends on the batch.
        findResults: {
          id: string;
          linkedTransactionId: string | null;
        }[][] = [],
      ) => {
        const resolveQb = createMockQueryBuilder({
          getMany: jest
            .fn()
            .mockResolvedValue(batchRows.map((r) => ({ id: r.id }))),
        });
        const exclusionsQb = createMockQueryBuilder({
          getMany: jest.fn().mockResolvedValue(batchRows),
        });
        const expansionQb = createMockQueryBuilder({
          getMany: jest.fn().mockResolvedValue(batchRows),
        });
        const counterpartQb = createMockQueryBuilder({
          getMany: jest.fn().mockResolvedValue(counterpartRows),
        });
        const balanceQb = createMockQueryBuilder({
          getRawMany: jest.fn().mockResolvedValue([]),
        });
        const accountIdsQb = createMockQueryBuilder({
          getRawMany: jest.fn().mockResolvedValue([]),
        });

        const chain = transactionsRepository.createQueryBuilder
          .mockReturnValueOnce(resolveQb)
          .mockReturnValueOnce(exclusionsQb)
          .mockReturnValueOnce(expansionQb);
        if (counterpartRows.length > 0) {
          chain.mockReturnValueOnce(counterpartQb);
        }
        chain.mockReturnValueOnce(balanceQb).mockReturnValueOnce(accountIdsQb);

        for (const rows of findResults) {
          mockManagerFind.mockResolvedValueOnce(rows);
        }

        const statusUpdateQb = createMockQueryBuilder({
          execute: jest.fn().mockResolvedValue({ affected: 2 }),
        });
        mockManagerCreateQueryBuilder.mockReturnValue(statusUpdateQb);
        return { statusUpdateQb, balanceQb };
      };

      it("voids the counterpart when only the source leg is selected", async () => {
        const sourceLeg = makeTransaction({
          id: "leg-source",
          accountId: "checking",
          amount: -100,
          isTransfer: true,
          linkedTransactionId: "leg-dest",
        });
        const { statusUpdateQb, balanceQb } = wireStatusUpdate(
          [sourceLeg],
          [{ id: "leg-dest" }],
        );

        const result = await service.bulkUpdate(userId, {
          mode: "ids",
          transactionIds: ["leg-source"],
          status: TransactionStatus.VOID,
        });

        // Both legs are voided, and both are in the balance query, so the
        // combined balance cannot move.
        expect(statusUpdateQb.where).toHaveBeenCalledWith(
          "id IN (:...ids)",
          expect.objectContaining({
            ids: expect.arrayContaining(["leg-source", "leg-dest"]),
          }),
        );
        expect(balanceQb.where).toHaveBeenCalledWith(
          "transaction.id IN (:...ids)",
          expect.objectContaining({
            ids: expect.arrayContaining(["leg-source", "leg-dest"]),
          }),
        );
        expect(result.updated).toBe(2);
        expect(result.skipped).toBe(0);
      });

      // P6-RECHECK-004. A bulk "mark cleared" over a list that happens to include
      // a transfer leg must not reconcile the counterpart in another account,
      // whose statement has not been seen. Only a VOID boundary is pair-wide.
      it("does not pair the counterpart for a CLEARED change", async () => {
        const sourceLeg = makeTransaction({
          id: "leg-source",
          accountId: "checking",
          amount: -100,
          isTransfer: true,
          linkedTransactionId: "leg-dest",
        });
        // No counterpart query is expected at all, so none is wired.
        const { statusUpdateQb } = wireStatusUpdate([sourceLeg], []);

        const result = await service.bulkUpdate(userId, {
          mode: "ids",
          transactionIds: ["leg-source"],
          status: TransactionStatus.CLEARED,
        });

        expect(statusUpdateQb.where).toHaveBeenCalledWith(
          "id IN (:...ids)",
          expect.objectContaining({ ids: ["leg-source"] }),
        );
        expect(result.updated).toBe(1);
        expect(result.skipped).toBe(0);
      });

      it("does not refuse a split-transfer leg for a CLEARED change", async () => {
        const splitLeg = makeTransaction({
          id: "leg-in-target",
          isTransfer: true,
          linkedTransactionId: "split-parent",
        });
        const { statusUpdateQb } = wireStatusUpdate([splitLeg], []);

        const result = await service.bulkUpdate(userId, {
          mode: "ids",
          transactionIds: ["leg-in-target"],
          status: TransactionStatus.CLEARED,
        });

        expect(statusUpdateQb.set).toHaveBeenCalled();
        expect(result.updated).toBe(1);
        expect(result.skipped).toBe(0);
      });

      it("refuses a split-transfer leg rather than changing its split parent", async () => {
        const splitLeg = makeTransaction({
          id: "leg-in-target",
          isTransfer: true,
          // For a split-transfer leg this points at the split PARENT.
          linkedTransactionId: "split-parent",
        });
        const { statusUpdateQb } = wireStatusUpdate(
          [splitLeg],
          [],
          [[{ id: "split-row", linkedTransactionId: "leg-in-target" }]],
        );

        const result = await service.bulkUpdate(userId, {
          mode: "ids",
          transactionIds: ["leg-in-target"],
          status: TransactionStatus.VOID,
        });

        // Nothing is written: the pair cannot be made atomic here.
        expect(statusUpdateQb.set).not.toHaveBeenCalled();
        expect(accountsService.updateBalance).not.toHaveBeenCalled();
        expect(result.updated).toBe(0);
        expect(result.skipped).toBe(1);
        expect(result.skippedReasons[0]).toContain("both legs");
      });

      it("refuses a cross-owner leg whose counterpart it cannot write", async () => {
        const leg = makeTransaction({
          id: "leg-mine",
          isTransfer: true,
          linkedTransactionId: "leg-theirs",
        });
        // The counterpart lookup is user-filtered, so it comes back empty.
        const { statusUpdateQb } = wireStatusUpdate([leg], []);

        const result = await service.bulkUpdate(userId, {
          mode: "ids",
          transactionIds: ["leg-mine"],
          status: TransactionStatus.VOID,
        });

        expect(statusUpdateQb.set).not.toHaveBeenCalled();
        expect(result.updated).toBe(0);
        expect(result.skipped).toBe(1);
      });

      it("carries a selected split parent's transfer legs with it", async () => {
        const parent = makeTransaction({ id: "split-parent", isSplit: true });
        const { statusUpdateQb } = wireStatusUpdate(
          [parent],
          [{ id: "leg-in-target" }],
          [[{ id: "split-row", linkedTransactionId: "leg-in-target" }]],
        );

        await service.bulkUpdate(userId, {
          mode: "ids",
          transactionIds: ["split-parent"],
          status: TransactionStatus.VOID,
        });

        expect(statusUpdateQb.where).toHaveBeenCalledWith(
          "id IN (:...ids)",
          expect.objectContaining({
            ids: expect.arrayContaining(["split-parent", "leg-in-target"]),
          }),
        );
      });

      it("still applies non-status fields to a refused leg", async () => {
        const splitLeg = makeTransaction({
          id: "leg-in-target",
          isTransfer: true,
          linkedTransactionId: "split-parent",
        });
        const { statusUpdateQb } = wireStatusUpdate(
          [splitLeg],
          [],
          [[{ id: "split-row", linkedTransactionId: "leg-in-target" }]],
        );

        const result = await service.bulkUpdate(userId, {
          mode: "ids",
          transactionIds: ["leg-in-target"],
          status: TransactionStatus.VOID,
          description: "renamed",
        });

        // The description landed; only the status was refused.
        expect(statusUpdateQb.set).toHaveBeenCalledWith({
          description: "renamed",
        });
        expect(result.updated).toBe(1);
        expect(result.skipped).toBe(1);
      });
    });

    it("adjusts balances when changing status from VOID to non-VOID", async () => {
      const tx1 = makeTransaction({
        id: "tx-1",
        accountId: "acc-1",
        amount: 100,
        status: TransactionStatus.VOID,
      });

      const resolveQb = createMockQueryBuilder({
        getMany: jest.fn().mockResolvedValue([{ id: "tx-1" }]),
      });
      const exclusionsQb = createMockQueryBuilder({
        getMany: jest.fn().mockResolvedValue([tx1]),
      });
      // Net worth recalc query (after commit)
      const accountIdsQb = createMockQueryBuilder({
        getRawMany: jest.fn().mockResolvedValue([{ accountId: "acc-1" }]),
      });

      // Balance deltas via queryRunner.manager.getRepository
      const balanceQb = createMockQueryBuilder({
        getRawMany: jest
          .fn()
          .mockResolvedValue([{ accountId: "acc-1", totalAmount: "100" }]),
      });

      // A status change re-reads the batch first, to expand a selected transfer
      // leg to its counterpart before any balance moves.
      const expansionQb = createMockQueryBuilder({
        getMany: exclusionsQb.getMany,
      });

      transactionsRepository.createQueryBuilder
        .mockReturnValueOnce(resolveQb)
        .mockReturnValueOnce(exclusionsQb)
        .mockReturnValueOnce(expansionQb)
        .mockReturnValueOnce(balanceQb)
        .mockReturnValueOnce(accountIdsQb);

      // Batch update via queryRunner.manager.createQueryBuilder
      const updateQb = createMockQueryBuilder({
        execute: jest.fn().mockResolvedValue({ affected: 1 }),
      });
      mockManagerCreateQueryBuilder.mockReturnValueOnce(updateQb);

      const dto: BulkUpdateDto = {
        mode: "ids",
        transactionIds: ["tx-1"],
        status: TransactionStatus.CLEARED,
      };

      const result = await service.bulkUpdate(userId, dto);

      expect(result.updated).toBe(1);
      expect(accountsService.updateBalance).toHaveBeenCalledWith("acc-1", 100);
    });

    it("only updates specified fields (partial update)", async () => {
      const tx = makeTransaction({ id: "tx-1" });

      // IDOR validation: categoryId is non-null
      categoriesRepository.findOne.mockResolvedValue({ id: "cat-1", userId });

      const resolveQb = createMockQueryBuilder({
        getMany: jest.fn().mockResolvedValue([{ id: "tx-1" }]),
      });
      const exclusionsQb = createMockQueryBuilder({
        getMany: jest.fn().mockResolvedValue([tx]),
      });

      transactionsRepository.createQueryBuilder
        .mockReturnValueOnce(resolveQb)
        .mockReturnValueOnce(exclusionsQb);

      // Batch update via queryRunner.manager.createQueryBuilder
      const updateQb = createMockQueryBuilder({
        execute: jest.fn().mockResolvedValue({ affected: 1 }),
      });
      mockManagerCreateQueryBuilder.mockReturnValueOnce(updateQb);

      const dto: BulkUpdateDto = {
        mode: "ids",
        transactionIds: ["tx-1"],
        categoryId: "cat-1",
      };

      await service.bulkUpdate(userId, dto);

      const setArg = updateQb.set.mock.calls[0][0];
      expect(setArg).toEqual({ categoryId: "cat-1" });
      expect(setArg).not.toHaveProperty("description");
      expect(setArg).not.toHaveProperty("payeeId");
      expect(setArg).not.toHaveProperty("status");
    });

    it("clears fields when null is provided", async () => {
      const tx = makeTransaction({ id: "tx-1" });

      const resolveQb = createMockQueryBuilder({
        getMany: jest.fn().mockResolvedValue([{ id: "tx-1" }]),
      });
      const exclusionsQb = createMockQueryBuilder({
        getMany: jest.fn().mockResolvedValue([tx]),
      });

      transactionsRepository.createQueryBuilder
        .mockReturnValueOnce(resolveQb)
        .mockReturnValueOnce(exclusionsQb);

      // Batch update via queryRunner.manager.createQueryBuilder
      const updateQb = createMockQueryBuilder({
        execute: jest.fn().mockResolvedValue({ affected: 1 }),
      });
      mockManagerCreateQueryBuilder.mockReturnValueOnce(updateQb);

      const dto: BulkUpdateDto = {
        mode: "ids",
        transactionIds: ["tx-1"],
        categoryId: null,
        description: null,
      };

      await service.bulkUpdate(userId, dto);

      const setArg = updateQb.set.mock.calls[0][0];
      expect(setArg).toEqual({ categoryId: null, description: null });
    });

    it("updates tags on eligible transactions when tagIds is provided", async () => {
      const tx1 = makeTransaction({ id: "tx-1" });
      const tx2 = makeTransaction({ id: "tx-2" });

      const resolveQb = createMockQueryBuilder({
        getMany: jest.fn().mockResolvedValue([{ id: "tx-1" }, { id: "tx-2" }]),
      });
      const exclusionsQb = createMockQueryBuilder({
        getMany: jest.fn().mockResolvedValue([tx1, tx2]),
      });

      transactionsRepository.createQueryBuilder
        .mockReturnValueOnce(resolveQb)
        .mockReturnValueOnce(exclusionsQb);

      const dto: BulkUpdateDto = {
        mode: "ids",
        transactionIds: ["tx-1", "tx-2"],
        tagIds: ["tag-a", "tag-b"],
      };

      await service.bulkUpdate(userId, dto);

      // Tags are applied to all eligible transactions in a single bulk call
      expect(tagsService.setTransactionTagsBulk).toHaveBeenCalledTimes(1);
      expect(tagsService.setTransactionTagsBulk).toHaveBeenCalledWith(
        ["tx-1", "tx-2"],
        ["tag-a", "tag-b"],
        userId,
      );
    });

    it("clears tags when tagIds is empty array", async () => {
      const tx = makeTransaction({ id: "tx-1" });

      const resolveQb = createMockQueryBuilder({
        getMany: jest.fn().mockResolvedValue([{ id: "tx-1" }]),
      });
      const exclusionsQb = createMockQueryBuilder({
        getMany: jest.fn().mockResolvedValue([tx]),
      });

      transactionsRepository.createQueryBuilder
        .mockReturnValueOnce(resolveQb)
        .mockReturnValueOnce(exclusionsQb);

      const dto: BulkUpdateDto = {
        mode: "ids",
        transactionIds: ["tx-1"],
        tagIds: [],
      };

      await service.bulkUpdate(userId, dto);

      expect(tagsService.setTransactionTagsBulk).toHaveBeenCalledWith(
        ["tx-1"],
        [],
        userId,
      );
    });

    it("mirrors bulk tags onto the owning split for split-transfer legs", async () => {
      const tx1 = makeTransaction({
        id: "tx-1",
        isTransfer: true,
        linkedTransactionId: "parent-tx",
      });

      const resolveQb = createMockQueryBuilder({
        getMany: jest.fn().mockResolvedValue([{ id: "tx-1" }]),
      });
      const exclusionsQb = createMockQueryBuilder({
        getMany: jest.fn().mockResolvedValue([tx1]),
      });
      transactionsRepository.createQueryBuilder
        .mockReturnValueOnce(resolveQb)
        .mockReturnValueOnce(exclusionsQb);

      // classifyTransferLegs: the batch's one transfer leg...
      const syncFindQb = createMockQueryBuilder({
        getMany: jest
          .fn()
          .mockResolvedValue([
            { id: "tx-1", linkedTransactionId: "parent-tx" },
          ]),
      });
      transactionsRepository.createQueryBuilder.mockReturnValue(syncFindQb);
      // ...is owned by a split row, so it is a split-transfer leg.
      mockManagerFind.mockResolvedValue([
        { id: "split-1", linkedTransactionId: "tx-1" },
      ]);

      const dto: BulkUpdateDto = {
        mode: "ids",
        transactionIds: ["tx-1"],
        tagIds: ["tag-a"],
      };

      await service.bulkUpdate(userId, dto);

      // The leg itself gets the tags via the normal bulk call...
      expect(tagsService.setTransactionTagsBulk).toHaveBeenCalledTimes(1);
      expect(tagsService.setTransactionTagsBulk).toHaveBeenCalledWith(
        ["tx-1"],
        ["tag-a"],
        userId,
      );
      // ...and the owning split mirrors them; the parent is never tagged.
      expect(tagsService.setSplitTagsBulk).toHaveBeenCalledWith(
        ["split-1"],
        ["tag-a"],
        userId,
      );
    });

    it("syncs bulk tags to the mirror leg of a plain transfer", async () => {
      const tx1 = makeTransaction({
        id: "tx-1",
        isTransfer: true,
        linkedTransactionId: "tx-1-linked",
      });

      const resolveQb = createMockQueryBuilder({
        getMany: jest.fn().mockResolvedValue([{ id: "tx-1" }]),
      });
      const exclusionsQb = createMockQueryBuilder({
        getMany: jest.fn().mockResolvedValue([tx1]),
      });
      transactionsRepository.createQueryBuilder
        .mockReturnValueOnce(resolveQb)
        .mockReturnValueOnce(exclusionsQb);

      const syncFindQb = createMockQueryBuilder({
        getMany: jest
          .fn()
          .mockResolvedValue([
            { id: "tx-1", linkedTransactionId: "tx-1-linked" },
          ]),
      });
      // Cross-owner filter: the mirror leg belongs to the same user.
      const ownLinkedQb = createMockQueryBuilder({
        getMany: jest.fn().mockResolvedValue([{ id: "tx-1-linked" }]),
      });
      transactionsRepository.createQueryBuilder
        .mockReturnValueOnce(syncFindQb)
        .mockReturnValue(ownLinkedQb);
      // No owning split: a plain transfer leg.
      mockManagerFind.mockResolvedValue([]);

      const dto: BulkUpdateDto = {
        mode: "ids",
        transactionIds: ["tx-1"],
        tagIds: ["tag-a"],
      };

      await service.bulkUpdate(userId, dto);

      // Batch call plus a second call covering the mirror leg.
      expect(tagsService.setTransactionTagsBulk).toHaveBeenCalledTimes(2);
      expect(tagsService.setTransactionTagsBulk).toHaveBeenCalledWith(
        ["tx-1-linked"],
        ["tag-a"],
        userId,
      );
      expect(tagsService.setSplitTagsBulk).not.toHaveBeenCalled();
    });

    it("never writes bulk tags onto a cross-owner counterpart leg", async () => {
      const tx1 = makeTransaction({
        id: "tx-1",
        isTransfer: true,
        linkedTransactionId: "foreign-linked",
      });

      const resolveQb = createMockQueryBuilder({
        getMany: jest.fn().mockResolvedValue([{ id: "tx-1" }]),
      });
      const exclusionsQb = createMockQueryBuilder({
        getMany: jest.fn().mockResolvedValue([tx1]),
      });
      transactionsRepository.createQueryBuilder
        .mockReturnValueOnce(resolveQb)
        .mockReturnValueOnce(exclusionsQb);

      const syncFindQb = createMockQueryBuilder({
        getMany: jest
          .fn()
          .mockResolvedValue([
            { id: "tx-1", linkedTransactionId: "foreign-linked" },
          ]),
      });
      // Ownership filter: the linked row belongs to another user, so the
      // same-user probe finds nothing to sync.
      const ownLinkedQb = createMockQueryBuilder({
        getMany: jest.fn().mockResolvedValue([]),
      });
      transactionsRepository.createQueryBuilder
        .mockReturnValueOnce(syncFindQb)
        .mockReturnValue(ownLinkedQb);
      mockManagerFind.mockResolvedValue([]);

      await service.bulkUpdate(userId, {
        mode: "ids",
        transactionIds: ["tx-1"],
        tagIds: ["tag-a"],
      });

      // Only the batch's own rows are tagged; the foreign counterpart is not.
      expect(tagsService.setTransactionTagsBulk).toHaveBeenCalledTimes(1);
      expect(tagsService.setTransactionTagsBulk).toHaveBeenCalledWith(
        ["tx-1"],
        ["tag-a"],
        userId,
      );
    });

    it("applies filters in filter mode", async () => {
      const tx = makeTransaction({ id: "tx-1" });

      const resolveQb = createMockQueryBuilder({
        getMany: jest.fn().mockResolvedValue([{ id: "tx-1" }]),
      });
      const exclusionsQb = createMockQueryBuilder({
        getMany: jest.fn().mockResolvedValue([tx]),
      });

      transactionsRepository.createQueryBuilder
        .mockReturnValueOnce(resolveQb)
        .mockReturnValueOnce(exclusionsQb);

      // Batch update via queryRunner.manager.createQueryBuilder
      const updateQb = createMockQueryBuilder({
        execute: jest.fn().mockResolvedValue({ affected: 1 }),
      });
      mockManagerCreateQueryBuilder.mockReturnValueOnce(updateQb);

      const dto: BulkUpdateDto = {
        mode: "filter",
        filters: {
          accountIds: ["acc-1"],
          startDate: "2026-01-01",
          endDate: "2026-01-31",
        },
        description: "filtered update",
      };

      const result = await service.bulkUpdate(userId, dto);

      expect(result.updated).toBe(1);
      expect(resolveQb.andWhere).toHaveBeenCalled();
    });

    it("returns zero when all transactions are excluded", async () => {
      const tx = makeTransaction({
        id: "tx-1",
        isSplit: true,
      });

      // IDOR validation: categoryId is non-null
      categoriesRepository.findOne.mockResolvedValue({
        id: "cat-1",
        userId,
      });

      const resolveQb = createMockQueryBuilder({
        getMany: jest.fn().mockResolvedValue([{ id: "tx-1" }]),
      });
      const exclusionsQb = createMockQueryBuilder({
        getMany: jest.fn().mockResolvedValue([tx]),
      });

      transactionsRepository.createQueryBuilder
        .mockReturnValueOnce(resolveQb)
        .mockReturnValueOnce(exclusionsQb);

      const dto: BulkUpdateDto = {
        mode: "ids",
        transactionIds: ["tx-1"],
        categoryId: "cat-1",
      };

      const result = await service.bulkUpdate(userId, dto);

      expect(result.updated).toBe(0);
      expect(result.skipped).toBe(1);
    });

    it("excludes future-dated transactions from balance updates when changing status to VOID", async () => {
      const pastTx = makeTransaction({
        id: "tx-1",
        accountId: "acc-1",
        amount: 50,
        transactionDate: "2026-01-15",
      });
      const futureTx = makeTransaction({
        id: "tx-2",
        accountId: "acc-1",
        amount: 200,
        transactionDate: "2027-06-15",
      });

      const resolveQb = createMockQueryBuilder({
        getMany: jest.fn().mockResolvedValue([{ id: "tx-1" }, { id: "tx-2" }]),
      });
      const exclusionsQb = createMockQueryBuilder({
        getMany: jest.fn().mockResolvedValue([pastTx, futureTx]),
      });
      // Net worth recalc query (after commit)
      const accountIdsQb = createMockQueryBuilder({
        getRawMany: jest.fn().mockResolvedValue([{ accountId: "acc-1" }]),
      });

      // Balance deltas query via queryRunner.manager.getRepository
      const balanceQb = createMockQueryBuilder({
        getRawMany: jest
          .fn()
          .mockResolvedValue([{ accountId: "acc-1", totalAmount: "50" }]),
      });

      // A status change re-reads the batch first, to expand a selected transfer
      // leg to its counterpart before any balance moves.
      const expansionQb = createMockQueryBuilder({
        getMany: exclusionsQb.getMany,
      });

      transactionsRepository.createQueryBuilder
        .mockReturnValueOnce(resolveQb)
        .mockReturnValueOnce(exclusionsQb)
        .mockReturnValueOnce(expansionQb)
        .mockReturnValueOnce(balanceQb)
        .mockReturnValueOnce(accountIdsQb);

      // Batch update via queryRunner.manager.createQueryBuilder
      const updateQb = createMockQueryBuilder({
        execute: jest.fn().mockResolvedValue({ affected: 2 }),
      });
      mockManagerCreateQueryBuilder.mockReturnValueOnce(updateQb);

      const dto: BulkUpdateDto = {
        mode: "ids",
        transactionIds: ["tx-1", "tx-2"],
        status: TransactionStatus.VOID,
      };

      const result = await service.bulkUpdate(userId, dto);

      expect(result.updated).toBe(2);
      // The balance query should include the today filter via andWhere
      expect(balanceQb.andWhere).toHaveBeenCalledWith(
        "transaction.transactionDate <= :today",
        expect.objectContaining({ today: expect.any(String) }),
      );
      // Only the past transaction's amount (50) should be used for balance update
      expect(accountsService.updateBalance).toHaveBeenCalledWith("acc-1", -50);
    });

    it("excludes future-dated transactions from balance updates when unvoiding", async () => {
      const pastTx = makeTransaction({
        id: "tx-1",
        accountId: "acc-1",
        amount: 100,
        status: TransactionStatus.VOID,
        transactionDate: "2026-01-15",
      });
      const futureTx = makeTransaction({
        id: "tx-2",
        accountId: "acc-1",
        amount: 300,
        status: TransactionStatus.VOID,
        transactionDate: "2027-06-15",
      });

      const resolveQb = createMockQueryBuilder({
        getMany: jest.fn().mockResolvedValue([{ id: "tx-1" }, { id: "tx-2" }]),
      });
      const exclusionsQb = createMockQueryBuilder({
        getMany: jest.fn().mockResolvedValue([pastTx, futureTx]),
      });
      // Net worth recalc query (after commit)
      const accountIdsQb = createMockQueryBuilder({
        getRawMany: jest.fn().mockResolvedValue([{ accountId: "acc-1" }]),
      });

      // Balance deltas via queryRunner.manager.getRepository
      const balanceQb = createMockQueryBuilder({
        getRawMany: jest
          .fn()
          .mockResolvedValue([{ accountId: "acc-1", totalAmount: "100" }]),
      });

      // A status change re-reads the batch first, to expand a selected transfer
      // leg to its counterpart before any balance moves.
      const expansionQb = createMockQueryBuilder({
        getMany: exclusionsQb.getMany,
      });

      transactionsRepository.createQueryBuilder
        .mockReturnValueOnce(resolveQb)
        .mockReturnValueOnce(exclusionsQb)
        .mockReturnValueOnce(expansionQb)
        .mockReturnValueOnce(balanceQb)
        .mockReturnValueOnce(accountIdsQb);

      // Batch update via queryRunner.manager.createQueryBuilder
      const updateQb = createMockQueryBuilder({
        execute: jest.fn().mockResolvedValue({ affected: 2 }),
      });
      mockManagerCreateQueryBuilder.mockReturnValueOnce(updateQb);

      const dto: BulkUpdateDto = {
        mode: "ids",
        transactionIds: ["tx-1", "tx-2"],
        status: TransactionStatus.CLEARED,
      };

      const result = await service.bulkUpdate(userId, dto);

      expect(result.updated).toBe(2);
      expect(balanceQb.andWhere).toHaveBeenCalledWith(
        "transaction.transactionDate <= :today",
        expect.objectContaining({ today: expect.any(String) }),
      );
      // Only the past transaction's amount (100) should be added back
      expect(accountsService.updateBalance).toHaveBeenCalledWith("acc-1", 100);
    });
  });

  describe("bulkDelete", () => {
    it("returns zero deleted when no transactions match", async () => {
      const resolveQb = createMockQueryBuilder({
        getMany: jest.fn().mockResolvedValue([]),
      });
      transactionsRepository.createQueryBuilder.mockReturnValue(resolveQb);

      const dto: BulkDeleteDto = {
        mode: "ids",
        transactionIds: ["nonexistent"],
      };

      const result = await service.bulkDelete(userId, dto);

      expect(result).toEqual({ deleted: 0 });
    });

    it("deletes transactions by explicit IDs", async () => {
      const tx1 = makeTransaction({ id: "tx-1" });
      const tx2 = makeTransaction({ id: "tx-2" });

      // First call: resolve IDs
      const resolveQb = createMockQueryBuilder({
        getMany: jest.fn().mockResolvedValue([{ id: "tx-1" }, { id: "tx-2" }]),
      });
      // Second call: load transaction details
      const detailsQb = createMockQueryBuilder({
        getMany: jest.fn().mockResolvedValue([tx1, tx2]),
        leftJoinAndSelect: jest.fn().mockReturnThis(),
      });

      transactionsRepository.createQueryBuilder
        .mockReturnValueOnce(resolveQb)
        .mockReturnValueOnce(detailsQb);

      // Delete query via queryRunner.manager.createQueryBuilder()
      const deleteQb = createMockQueryBuilder({
        delete: jest.fn().mockReturnThis(),
        from: jest.fn().mockReturnThis(),
        execute: jest.fn().mockResolvedValue({ affected: 2 }),
      });
      mockManagerCreateQueryBuilder.mockReturnValueOnce(deleteQb);

      const dto: BulkDeleteDto = {
        mode: "ids",
        transactionIds: ["tx-1", "tx-2"],
      };

      const result = await service.bulkDelete(userId, dto);

      expect(result.deleted).toBe(2);
      expect(mockDataSource.transaction).toHaveBeenCalled();
    });

    it("adjusts balances for non-VOID, non-future transactions", async () => {
      const tx1 = makeTransaction({
        id: "tx-1",
        accountId: "acc-1",
        amount: 100,
      });

      const resolveQb = createMockQueryBuilder({
        getMany: jest.fn().mockResolvedValue([{ id: "tx-1" }]),
      });
      const detailsQb = createMockQueryBuilder({
        getMany: jest.fn().mockResolvedValue([tx1]),
        leftJoinAndSelect: jest.fn().mockReturnThis(),
      });

      transactionsRepository.createQueryBuilder
        .mockReturnValueOnce(resolveQb)
        .mockReturnValueOnce(detailsQb);

      const deleteQb = createMockQueryBuilder({
        delete: jest.fn().mockReturnThis(),
        from: jest.fn().mockReturnThis(),
        execute: jest.fn().mockResolvedValue({ affected: 1 }),
      });
      mockManagerCreateQueryBuilder.mockReturnValueOnce(deleteQb);

      const dto: BulkDeleteDto = {
        mode: "ids",
        transactionIds: ["tx-1"],
      };

      await service.bulkDelete(userId, dto);

      expect(accountsService.updateBalance).toHaveBeenCalledWith("acc-1", -100);
    });

    it("does not adjust balance for VOID transactions", async () => {
      const tx1 = makeTransaction({
        id: "tx-1",
        accountId: "acc-1",
        amount: 100,
        status: TransactionStatus.VOID,
      });

      const resolveQb = createMockQueryBuilder({
        getMany: jest.fn().mockResolvedValue([{ id: "tx-1" }]),
      });
      const detailsQb = createMockQueryBuilder({
        getMany: jest.fn().mockResolvedValue([tx1]),
        leftJoinAndSelect: jest.fn().mockReturnThis(),
      });

      transactionsRepository.createQueryBuilder
        .mockReturnValueOnce(resolveQb)
        .mockReturnValueOnce(detailsQb);

      const deleteQb = createMockQueryBuilder({
        delete: jest.fn().mockReturnThis(),
        from: jest.fn().mockReturnThis(),
        execute: jest.fn().mockResolvedValue({ affected: 1 }),
      });
      mockManagerCreateQueryBuilder.mockReturnValueOnce(deleteQb);

      await service.bulkDelete(userId, {
        mode: "ids",
        transactionIds: ["tx-1"],
      });

      expect(accountsService.updateBalance).not.toHaveBeenCalled();
    });

    it("deletes linked transfer counterparts", async () => {
      const tx1 = makeTransaction({
        id: "tx-1",
        isTransfer: true,
        linkedTransactionId: "tx-1-linked",
      });

      const resolveQb = createMockQueryBuilder({
        getMany: jest.fn().mockResolvedValue([{ id: "tx-1" }]),
      });
      const detailsQb = createMockQueryBuilder({
        getMany: jest.fn().mockResolvedValue([tx1]),
        leftJoinAndSelect: jest.fn().mockReturnThis(),
      });

      transactionsRepository.createQueryBuilder
        .mockReturnValueOnce(resolveQb)
        .mockReturnValueOnce(detailsQb);

      // Load linked transaction details for balance adjustment
      const linkedTx = makeTransaction({
        id: "tx-1-linked",
        accountId: "acc-2",
        amount: -100,
      });
      mockManagerCreateQueryBuilder.mockImplementation(() =>
        createMockQueryBuilder({
          delete: jest.fn().mockReturnThis(),
          from: jest.fn().mockReturnThis(),
          execute: jest.fn().mockResolvedValue({ affected: 1 }),
          getMany: jest.fn().mockResolvedValue([linkedTx]),
        }),
      );

      await service.bulkDelete(userId, {
        mode: "ids",
        transactionIds: ["tx-1"],
      });

      // Should have called createQueryBuilder multiple times:
      // 1. Load linked transaction details
      // 2. Delete linked transactions
      // 3. Delete primary transactions
      expect(mockManagerCreateQueryBuilder).toHaveBeenCalled();
      expect(mockDataSource.transaction).toHaveBeenCalled();
    });

    it("triggers net worth recalc for affected accounts", async () => {
      const tx1 = makeTransaction({
        id: "tx-1",
        accountId: "acc-1",
      });

      const resolveQb = createMockQueryBuilder({
        getMany: jest.fn().mockResolvedValue([{ id: "tx-1" }]),
      });
      const detailsQb = createMockQueryBuilder({
        getMany: jest.fn().mockResolvedValue([tx1]),
        leftJoinAndSelect: jest.fn().mockReturnThis(),
      });

      transactionsRepository.createQueryBuilder
        .mockReturnValueOnce(resolveQb)
        .mockReturnValueOnce(detailsQb);

      const deleteQb = createMockQueryBuilder({
        delete: jest.fn().mockReturnThis(),
        from: jest.fn().mockReturnThis(),
        execute: jest.fn().mockResolvedValue({ affected: 1 }),
      });
      mockManagerCreateQueryBuilder.mockReturnValueOnce(deleteQb);

      await service.bulkDelete(userId, {
        mode: "ids",
        transactionIds: ["tx-1"],
      });

      expect(netWorthService.triggerDebouncedRecalc).toHaveBeenCalledWith(
        "acc-1",
        userId,
      );
    });

    it("rolls back transaction on error", async () => {
      const tx1 = makeTransaction({ id: "tx-1" });

      const resolveQb = createMockQueryBuilder({
        getMany: jest.fn().mockResolvedValue([{ id: "tx-1" }]),
      });
      const detailsQb = createMockQueryBuilder({
        getMany: jest.fn().mockResolvedValue([tx1]),
        leftJoinAndSelect: jest.fn().mockReturnThis(),
      });

      transactionsRepository.createQueryBuilder
        .mockReturnValueOnce(resolveQb)
        .mockReturnValueOnce(detailsQb);

      const deleteQb = createMockQueryBuilder({
        delete: jest.fn().mockReturnThis(),
        from: jest.fn().mockReturnThis(),
        execute: jest.fn().mockRejectedValue(new Error("DB error")),
      });
      mockManagerCreateQueryBuilder.mockReturnValueOnce(deleteQb);

      await expect(
        service.bulkDelete(userId, {
          mode: "ids",
          transactionIds: ["tx-1"],
        }),
      ).rejects.toThrow("DB error");

      expect(mockDataSource.transaction).toHaveBeenCalled();
    });

    it("returns zero deleted when loaded transactions are empty", async () => {
      // resolveTransactionIds returns IDs, but the detail query returns nothing
      const resolveQb = createMockQueryBuilder({
        getMany: jest.fn().mockResolvedValue([{ id: "tx-1" }]),
      });
      const detailsQb = createMockQueryBuilder({
        getMany: jest.fn().mockResolvedValue([]),
        leftJoinAndSelect: jest.fn().mockReturnThis(),
      });

      transactionsRepository.createQueryBuilder
        .mockReturnValueOnce(resolveQb)
        .mockReturnValueOnce(detailsQb);

      const result = await service.bulkDelete(userId, {
        mode: "ids",
        transactionIds: ["tx-1"],
      });

      expect(result).toEqual({ deleted: 0 });
      // Only the two read transactions (id resolve + detail load) ran: the
      // delete block is skipped entirely when nothing loads.
      expect(mockDataSource.transaction).toHaveBeenCalledTimes(2);
    });

    it("deletes linked transactions from split transfers", async () => {
      const splitTx = makeTransaction({
        id: "tx-1",
        isSplit: true,
        splits: [
          {
            id: "split-1",
            linkedTransactionId: "split-linked-1",
          } as any,
          {
            id: "split-2",
            linkedTransactionId: null,
          } as any,
        ],
      });

      const resolveQb = createMockQueryBuilder({
        getMany: jest.fn().mockResolvedValue([{ id: "tx-1" }]),
      });
      const detailsQb = createMockQueryBuilder({
        getMany: jest.fn().mockResolvedValue([splitTx]),
        leftJoinAndSelect: jest.fn().mockReturnThis(),
      });

      transactionsRepository.createQueryBuilder
        .mockReturnValueOnce(resolveQb)
        .mockReturnValueOnce(detailsQb);

      // Load linked transaction details for balance adjustment
      const linkedTx = makeTransaction({
        id: "split-linked-1",
        accountId: "acc-2",
        amount: -50,
      });
      mockManagerCreateQueryBuilder.mockImplementation(() =>
        createMockQueryBuilder({
          delete: jest.fn().mockReturnThis(),
          from: jest.fn().mockReturnThis(),
          execute: jest.fn().mockResolvedValue({ affected: 1 }),
          getMany: jest.fn().mockResolvedValue([linkedTx]),
        }),
      );

      await service.bulkDelete(userId, {
        mode: "ids",
        transactionIds: ["tx-1"],
      });

      // Should have balance adjustment for linked tx
      expect(accountsService.updateBalance).toHaveBeenCalled();
      expect(mockDataSource.transaction).toHaveBeenCalled();
    });

    it("does not adjust balance for future-dated transactions", async () => {
      const dateUtils = jest.requireMock("../common/date-utils");
      dateUtils.isTransactionInFuture.mockReturnValueOnce(true);

      const futureTx = makeTransaction({
        id: "tx-1",
        accountId: "acc-1",
        amount: 200,
        transactionDate: "2099-01-01",
      });

      const resolveQb = createMockQueryBuilder({
        getMany: jest.fn().mockResolvedValue([{ id: "tx-1" }]),
      });
      const detailsQb = createMockQueryBuilder({
        getMany: jest.fn().mockResolvedValue([futureTx]),
        leftJoinAndSelect: jest.fn().mockReturnThis(),
      });

      transactionsRepository.createQueryBuilder
        .mockReturnValueOnce(resolveQb)
        .mockReturnValueOnce(detailsQb);

      const deleteQb = createMockQueryBuilder({
        delete: jest.fn().mockReturnThis(),
        from: jest.fn().mockReturnThis(),
        execute: jest.fn().mockResolvedValue({ affected: 1 }),
      });
      mockManagerCreateQueryBuilder.mockReturnValueOnce(deleteQb);

      await service.bulkDelete(userId, {
        mode: "ids",
        transactionIds: ["tx-1"],
      });

      expect(accountsService.updateBalance).not.toHaveBeenCalled();
    });

    it("does not include linked transfers already in the deletion set", async () => {
      // Both sides of a transfer are being deleted together
      const tx1 = makeTransaction({
        id: "tx-1",
        isTransfer: true,
        linkedTransactionId: "tx-2",
        accountId: "acc-1",
        amount: 100,
      });
      const tx2 = makeTransaction({
        id: "tx-2",
        isTransfer: true,
        linkedTransactionId: "tx-1",
        accountId: "acc-2",
        amount: -100,
      });

      const resolveQb = createMockQueryBuilder({
        getMany: jest.fn().mockResolvedValue([{ id: "tx-1" }, { id: "tx-2" }]),
      });
      const detailsQb = createMockQueryBuilder({
        getMany: jest.fn().mockResolvedValue([tx1, tx2]),
        leftJoinAndSelect: jest.fn().mockReturnThis(),
      });

      transactionsRepository.createQueryBuilder
        .mockReturnValueOnce(resolveQb)
        .mockReturnValueOnce(detailsQb);

      // No linked transactions to load because both are already in the set
      const deleteQb = createMockQueryBuilder({
        delete: jest.fn().mockReturnThis(),
        from: jest.fn().mockReturnThis(),
        execute: jest.fn().mockResolvedValue({ affected: 2 }),
      });
      mockManagerCreateQueryBuilder.mockReturnValueOnce(deleteQb);

      await service.bulkDelete(userId, {
        mode: "ids",
        transactionIds: ["tx-1", "tx-2"],
      });

      // Only one delete call (no separate linked deletion since both are primary)
      expect(mockManagerCreateQueryBuilder).toHaveBeenCalledTimes(1);
      expect(mockDataSource.transaction).toHaveBeenCalled();
    });
  });

  describe("bulkUpdate - validation", () => {
    it("throws NotFoundException when categoryId does not belong to user", async () => {
      categoriesRepository.findOne.mockResolvedValue(null);

      const dto: BulkUpdateDto = {
        mode: "ids",
        transactionIds: ["tx-1"],
        categoryId: "invalid-cat",
      };

      await expect(service.bulkUpdate(userId, dto)).rejects.toThrow(
        "Category not found",
      );
    });

    it("throws NotFoundException when payeeId does not belong to user", async () => {
      payeesRepository.findOne.mockResolvedValue(null);

      const dto: BulkUpdateDto = {
        mode: "ids",
        transactionIds: ["tx-1"],
        payeeId: "invalid-payee",
      };

      await expect(service.bulkUpdate(userId, dto)).rejects.toThrow(
        "Payee not found",
      );
    });

    it("returns empty when transactionIds is empty array in ids mode", async () => {
      const dto: BulkUpdateDto = {
        mode: "ids",
        transactionIds: [],
        description: "test",
      };

      const result = await service.bulkUpdate(userId, dto);

      expect(result).toEqual({ updated: 0, skipped: 0, skippedReasons: [] });
    });

    it("rolls back transaction on error in bulkUpdate", async () => {
      const tx = makeTransaction({ id: "tx-1" });

      const resolveQb = createMockQueryBuilder({
        getMany: jest.fn().mockResolvedValue([{ id: "tx-1" }]),
      });
      const exclusionsQb = createMockQueryBuilder({
        getMany: jest.fn().mockResolvedValue([tx]),
      });

      transactionsRepository.createQueryBuilder
        .mockReturnValueOnce(resolveQb)
        .mockReturnValueOnce(exclusionsQb);

      // Make the batch update fail
      const updateQb = createMockQueryBuilder({
        execute: jest.fn().mockRejectedValue(new Error("Update failed")),
      });
      mockManagerCreateQueryBuilder.mockReturnValueOnce(updateQb);

      const dto: BulkUpdateDto = {
        mode: "ids",
        transactionIds: ["tx-1"],
        description: "fail",
      };

      await expect(service.bulkUpdate(userId, dto)).rejects.toThrow(
        "Update failed",
      );

      expect(mockDataSource.transaction).toHaveBeenCalled();
    });

    it("pluralizes skipped reasons correctly for multiple split transactions", async () => {
      const tx1 = makeTransaction({ id: "tx-1", isSplit: true });
      const tx2 = makeTransaction({ id: "tx-2", isSplit: true });
      const tx3 = makeTransaction({ id: "tx-3" });

      categoriesRepository.findOne.mockResolvedValue({ id: "cat-1", userId });

      const resolveQb = createMockQueryBuilder({
        getMany: jest
          .fn()
          .mockResolvedValue([{ id: "tx-1" }, { id: "tx-2" }, { id: "tx-3" }]),
      });
      const exclusionsQb = createMockQueryBuilder({
        getMany: jest.fn().mockResolvedValue([tx1, tx2, tx3]),
      });

      transactionsRepository.createQueryBuilder
        .mockReturnValueOnce(resolveQb)
        .mockReturnValueOnce(exclusionsQb);

      const updateQb = createMockQueryBuilder({
        execute: jest.fn().mockResolvedValue({ affected: 1 }),
      });
      mockManagerCreateQueryBuilder.mockReturnValueOnce(updateQb);

      const dto: BulkUpdateDto = {
        mode: "ids",
        transactionIds: ["tx-1", "tx-2", "tx-3"],
        categoryId: "cat-1",
      };

      const result = await service.bulkUpdate(userId, dto);

      expect(result.updated).toBe(1);
      expect(result.skipped).toBe(2);
      expect(result.skippedReasons[0]).toContain("2 split transactions");
    });
  });

  describe("bulkUpdate - filter mode", () => {
    it("applies categoryIds filter with regular categories", async () => {
      const tx = makeTransaction({ id: "tx-1" });

      // getAllCategoryIdsWithChildren uses categoriesRepository.find
      categoriesRepository.find.mockResolvedValue([
        { id: "cat-1", parentId: null },
        { id: "cat-1-child", parentId: "cat-1" },
      ]);

      const innerMockWhereBuilder = {
        where: jest.fn().mockReturnThis(),
        orWhere: jest.fn().mockReturnThis(),
      };

      const mockWhereBuilder = {
        where: jest.fn().mockImplementation(function (arg) {
          if (arg instanceof Brackets) {
            (arg as any).whereFactory(innerMockWhereBuilder);
          }
          return mockWhereBuilder;
        }),
        orWhere: jest.fn().mockReturnThis(),
      };

      const resolveQb = createMockQueryBuilder({
        getMany: jest.fn().mockResolvedValue([{ id: "tx-1" }]),
        leftJoin: jest.fn().mockReturnThis(),
        andWhere: jest.fn().mockImplementation(function (arg) {
          if (arg instanceof Brackets) {
            (arg as any).whereFactory(mockWhereBuilder);
          }
          return resolveQb;
        }),
      });
      const exclusionsQb = createMockQueryBuilder({
        getMany: jest.fn().mockResolvedValue([tx]),
      });

      transactionsRepository.createQueryBuilder
        .mockReturnValueOnce(resolveQb)
        .mockReturnValueOnce(exclusionsQb);

      const updateQb = createMockQueryBuilder({
        execute: jest.fn().mockResolvedValue({ affected: 1 }),
      });
      mockManagerCreateQueryBuilder.mockReturnValueOnce(updateQb);

      const dto: BulkUpdateDto = {
        mode: "filter",
        filters: {
          categoryIds: ["cat-1"],
        },
        description: "test",
      };

      const result = await service.bulkUpdate(userId, dto);

      expect(result.updated).toBe(1);
      expect(resolveQb.leftJoin).toHaveBeenCalledWith(
        "transaction.splits",
        "filterSplits",
      );
      // Only regular categories, so first condition uses "where" not "orWhere"
      expect(mockWhereBuilder.where).toHaveBeenCalled();
      expect(innerMockWhereBuilder.where).toHaveBeenCalledWith(
        "transaction.categoryId IN (:...filterCategoryIds)",
        expect.objectContaining({ filterCategoryIds: expect.any(Array) }),
      );
    });

    it("applies payeeIds filter", async () => {
      const tx = makeTransaction({ id: "tx-1" });

      const resolveQb = createMockQueryBuilder({
        getMany: jest.fn().mockResolvedValue([{ id: "tx-1" }]),
      });
      const exclusionsQb = createMockQueryBuilder({
        getMany: jest.fn().mockResolvedValue([tx]),
      });

      transactionsRepository.createQueryBuilder
        .mockReturnValueOnce(resolveQb)
        .mockReturnValueOnce(exclusionsQb);

      const updateQb = createMockQueryBuilder({
        execute: jest.fn().mockResolvedValue({ affected: 1 }),
      });
      mockManagerCreateQueryBuilder.mockReturnValueOnce(updateQb);

      const dto: BulkUpdateDto = {
        mode: "filter",
        filters: {
          payeeIds: ["payee-1"],
        },
        description: "test",
      };

      const result = await service.bulkUpdate(userId, dto);

      expect(result.updated).toBe(1);
      expect(resolveQb.andWhere).toHaveBeenCalledWith(
        "transaction.payeeId IN (:...payeeIds)",
        { payeeIds: ["payee-1"] },
      );
    });

    it("applies search filter without categoryIds", async () => {
      const tx = makeTransaction({ id: "tx-1" });

      const resolveQb = createMockQueryBuilder({
        getMany: jest.fn().mockResolvedValue([{ id: "tx-1" }]),
        leftJoin: jest.fn().mockReturnThis(),
      });
      const exclusionsQb = createMockQueryBuilder({
        getMany: jest.fn().mockResolvedValue([tx]),
      });

      transactionsRepository.createQueryBuilder
        .mockReturnValueOnce(resolveQb)
        .mockReturnValueOnce(exclusionsQb);

      const updateQb = createMockQueryBuilder({
        execute: jest.fn().mockResolvedValue({ affected: 1 }),
      });
      mockManagerCreateQueryBuilder.mockReturnValueOnce(updateQb);

      const dto: BulkUpdateDto = {
        mode: "filter",
        filters: {
          search: "groceries",
        },
        description: "test",
      };

      const result = await service.bulkUpdate(userId, dto);

      expect(result.updated).toBe(1);
      // Should join searchSplits when no categoryIds
      expect(resolveQb.leftJoin).toHaveBeenCalledWith(
        "transaction.splits",
        "searchSplits",
      );
      expect(resolveQb.andWhere).toHaveBeenCalledWith(
        buildTransactionSearchClause({
          transaction: "transaction",
          splits: "searchSplits",
        }),
        { search: "%groceries%", searchAmount: null, searchDate: null },
      );
    });

    it("applies search filter with categoryIds (uses filterSplits alias)", async () => {
      const tx = makeTransaction({ id: "tx-1" });

      categoriesRepository.find.mockResolvedValue([
        { id: "cat-1", parentId: null },
      ]);

      const resolveQb = createMockQueryBuilder({
        getMany: jest.fn().mockResolvedValue([{ id: "tx-1" }]),
        leftJoin: jest.fn().mockReturnThis(),
      });
      const exclusionsQb = createMockQueryBuilder({
        getMany: jest.fn().mockResolvedValue([tx]),
      });

      transactionsRepository.createQueryBuilder
        .mockReturnValueOnce(resolveQb)
        .mockReturnValueOnce(exclusionsQb);

      const updateQb = createMockQueryBuilder({
        execute: jest.fn().mockResolvedValue({ affected: 1 }),
      });
      mockManagerCreateQueryBuilder.mockReturnValueOnce(updateQb);

      const dto: BulkUpdateDto = {
        mode: "filter",
        filters: {
          categoryIds: ["cat-1"],
          search: "food",
        },
        description: "test",
      };

      const result = await service.bulkUpdate(userId, dto);

      expect(result.updated).toBe(1);
      // Search should use filterSplits alias (already joined by category filter)
      expect(resolveQb.andWhere).toHaveBeenCalledWith(
        buildTransactionSearchClause({
          transaction: "transaction",
          splits: "filterSplits",
        }),
        { search: "%food%", searchAmount: null, searchDate: null },
      );
    });

    it("applies uncategorized category filter", async () => {
      const tx = makeTransaction({ id: "tx-1" });

      const mockWhereBuilder = {
        where: jest.fn().mockReturnThis(),
        orWhere: jest.fn().mockReturnThis(),
      };

      const resolveQb = createMockQueryBuilder({
        getMany: jest.fn().mockResolvedValue([{ id: "tx-1" }]),
        leftJoin: jest.fn().mockReturnThis(),
        andWhere: jest.fn().mockImplementation(function (arg) {
          if (arg instanceof Brackets) {
            (arg as any).whereFactory(mockWhereBuilder);
          }
          return resolveQb;
        }),
      });
      const exclusionsQb = createMockQueryBuilder({
        getMany: jest.fn().mockResolvedValue([tx]),
      });

      transactionsRepository.createQueryBuilder
        .mockReturnValueOnce(resolveQb)
        .mockReturnValueOnce(exclusionsQb);

      const updateQb = createMockQueryBuilder({
        execute: jest.fn().mockResolvedValue({ affected: 1 }),
      });
      mockManagerCreateQueryBuilder.mockReturnValueOnce(updateQb);

      const dto: BulkUpdateDto = {
        mode: "filter",
        filters: {
          categoryIds: ["uncategorized"],
        },
        description: "test",
      };

      const result = await service.bulkUpdate(userId, dto);

      expect(result.updated).toBe(1);
      expect(resolveQb.leftJoin).toHaveBeenCalledWith(
        "transaction.account",
        "filterAccount",
      );
      // The Brackets callback should have invoked where (first condition uses "where")
      expect(mockWhereBuilder.where).toHaveBeenCalledWith(
        expect.stringContaining("transaction.categoryId IS NULL"),
      );
    });

    it("applies transfer category filter", async () => {
      const tx = makeTransaction({ id: "tx-1" });

      const mockWhereBuilder = {
        where: jest.fn().mockReturnThis(),
        orWhere: jest.fn().mockReturnThis(),
      };

      const resolveQb = createMockQueryBuilder({
        getMany: jest.fn().mockResolvedValue([{ id: "tx-1" }]),
        andWhere: jest.fn().mockImplementation(function (arg) {
          if (arg instanceof Brackets) {
            (arg as any).whereFactory(mockWhereBuilder);
          }
          return resolveQb;
        }),
      });
      const exclusionsQb = createMockQueryBuilder({
        getMany: jest.fn().mockResolvedValue([tx]),
      });

      transactionsRepository.createQueryBuilder
        .mockReturnValueOnce(resolveQb)
        .mockReturnValueOnce(exclusionsQb);

      const updateQb = createMockQueryBuilder({
        execute: jest.fn().mockResolvedValue({ affected: 1 }),
      });
      mockManagerCreateQueryBuilder.mockReturnValueOnce(updateQb);

      const dto: BulkUpdateDto = {
        mode: "filter",
        filters: {
          categoryIds: ["transfer"],
        },
        description: "test",
      };

      const result = await service.bulkUpdate(userId, dto);

      expect(result.updated).toBe(1);
      expect(mockWhereBuilder.where).toHaveBeenCalledWith(
        "transaction.isTransfer = true",
      );
    });

    it("applies combined uncategorized + transfer + regular category filters", async () => {
      const tx = makeTransaction({ id: "tx-1" });

      categoriesRepository.find.mockResolvedValue([
        { id: "cat-1", parentId: null },
      ]);

      const innerMockWhereBuilder = {
        where: jest.fn().mockReturnThis(),
        orWhere: jest.fn().mockReturnThis(),
      };

      const mockWhereBuilder = {
        where: jest.fn().mockReturnThis(),
        orWhere: jest.fn().mockImplementation(function (arg) {
          if (arg instanceof Brackets) {
            (arg as any).whereFactory(innerMockWhereBuilder);
          }
          return mockWhereBuilder;
        }),
      };

      const resolveQb = createMockQueryBuilder({
        getMany: jest.fn().mockResolvedValue([{ id: "tx-1" }]),
        leftJoin: jest.fn().mockReturnThis(),
        andWhere: jest.fn().mockImplementation(function (arg) {
          if (arg instanceof Brackets) {
            (arg as any).whereFactory(mockWhereBuilder);
          }
          return resolveQb;
        }),
      });
      const exclusionsQb = createMockQueryBuilder({
        getMany: jest.fn().mockResolvedValue([tx]),
      });

      transactionsRepository.createQueryBuilder
        .mockReturnValueOnce(resolveQb)
        .mockReturnValueOnce(exclusionsQb);

      const updateQb = createMockQueryBuilder({
        execute: jest.fn().mockResolvedValue({ affected: 1 }),
      });
      mockManagerCreateQueryBuilder.mockReturnValueOnce(updateQb);

      const dto: BulkUpdateDto = {
        mode: "filter",
        filters: {
          categoryIds: ["uncategorized", "transfer", "cat-1"],
        },
        description: "test",
      };

      const result = await service.bulkUpdate(userId, dto);

      expect(result.updated).toBe(1);
      expect(resolveQb.leftJoin).toHaveBeenCalledWith(
        "transaction.account",
        "filterAccount",
      );
      expect(resolveQb.leftJoin).toHaveBeenCalledWith(
        "transaction.splits",
        "filterSplits",
      );
      // First condition uses "where", subsequent use "orWhere"
      expect(mockWhereBuilder.where).toHaveBeenCalledWith(
        expect.stringContaining("transaction.categoryId IS NULL"),
      );
      expect(mockWhereBuilder.orWhere).toHaveBeenCalledWith(
        "transaction.isTransfer = true",
      );
      // Inner brackets for regular category IDs
      expect(innerMockWhereBuilder.where).toHaveBeenCalledWith(
        "transaction.categoryId IN (:...filterCategoryIds)",
        expect.objectContaining({ filterCategoryIds: expect.any(Array) }),
      );
      expect(innerMockWhereBuilder.orWhere).toHaveBeenCalledWith(
        "filterSplits.categoryId IN (:...filterCategoryIds)",
        expect.objectContaining({ filterCategoryIds: expect.any(Array) }),
      );
    });

    it("escapes special characters in search filter", async () => {
      const tx = makeTransaction({ id: "tx-1" });

      const resolveQb = createMockQueryBuilder({
        getMany: jest.fn().mockResolvedValue([{ id: "tx-1" }]),
        leftJoin: jest.fn().mockReturnThis(),
      });
      const exclusionsQb = createMockQueryBuilder({
        getMany: jest.fn().mockResolvedValue([tx]),
      });

      transactionsRepository.createQueryBuilder
        .mockReturnValueOnce(resolveQb)
        .mockReturnValueOnce(exclusionsQb);

      const updateQb = createMockQueryBuilder({
        execute: jest.fn().mockResolvedValue({ affected: 1 }),
      });
      mockManagerCreateQueryBuilder.mockReturnValueOnce(updateQb);

      const dto: BulkUpdateDto = {
        mode: "filter",
        filters: {
          search: "100% off_sale\\deal",
        },
        description: "test",
      };

      await service.bulkUpdate(userId, dto);

      expect(resolveQb.andWhere).toHaveBeenCalledWith(
        buildTransactionSearchClause({
          transaction: "transaction",
          splits: "searchSplits",
        }),
        {
          search: "%100\\% off\\_sale\\\\deal%",
          searchAmount: null,
          searchDate: null,
        },
      );
    });

    it("skips balance delta rows with zero amount", async () => {
      const tx = makeTransaction({
        id: "tx-1",
        accountId: "acc-1",
        amount: 0,
      });

      const resolveQb = createMockQueryBuilder({
        getMany: jest.fn().mockResolvedValue([{ id: "tx-1" }]),
      });
      const exclusionsQb = createMockQueryBuilder({
        getMany: jest.fn().mockResolvedValue([tx]),
      });
      const accountIdsQb = createMockQueryBuilder({
        getRawMany: jest.fn().mockResolvedValue([{ accountId: "acc-1" }]),
      });

      // Balance deltas query returns zero totalAmount
      const balanceQb = createMockQueryBuilder({
        getRawMany: jest
          .fn()
          .mockResolvedValue([{ accountId: "acc-1", totalAmount: "0" }]),
      });

      // A status change re-reads the batch first, to expand a selected transfer
      // leg to its counterpart before any balance moves.
      const expansionQb = createMockQueryBuilder({
        getMany: exclusionsQb.getMany,
      });

      transactionsRepository.createQueryBuilder
        .mockReturnValueOnce(resolveQb)
        .mockReturnValueOnce(exclusionsQb)
        .mockReturnValueOnce(expansionQb)
        .mockReturnValueOnce(balanceQb)
        .mockReturnValueOnce(accountIdsQb);

      const updateQb = createMockQueryBuilder({
        execute: jest.fn().mockResolvedValue({ affected: 1 }),
      });
      mockManagerCreateQueryBuilder.mockReturnValueOnce(updateQb);

      const dto: BulkUpdateDto = {
        mode: "ids",
        transactionIds: ["tx-1"],
        status: TransactionStatus.VOID,
      };

      await service.bulkUpdate(userId, dto);

      // updateBalance should NOT be called when amount is 0
      expect(accountsService.updateBalance).not.toHaveBeenCalled();
    });

    it("excludes ids in filter mode via excludedIds", async () => {
      const tx = makeTransaction({ id: "tx-2" });

      const resolveQb = createMockQueryBuilder({
        getMany: jest.fn().mockResolvedValue([{ id: "tx-2" }]),
      });
      const exclusionsQb = createMockQueryBuilder({
        getMany: jest.fn().mockResolvedValue([tx]),
      });

      transactionsRepository.createQueryBuilder
        .mockReturnValueOnce(resolveQb)
        .mockReturnValueOnce(exclusionsQb);

      const updateQb = createMockQueryBuilder({
        execute: jest.fn().mockResolvedValue({ affected: 1 }),
      });
      mockManagerCreateQueryBuilder.mockReturnValueOnce(updateQb);

      const dto: BulkUpdateDto = {
        mode: "filter",
        filters: { payeeIds: ["payee-1"] },
        excludedIds: ["tx-1", "tx-3"],
        description: "test",
      };

      const result = await service.bulkUpdate(userId, dto);

      expect(result.updated).toBe(1);
      expect(resolveQb.andWhere).toHaveBeenCalledWith(
        "transaction.id NOT IN (:...excludedIds)",
        { excludedIds: ["tx-1", "tx-3"] },
      );
    });

    it("does not add NOT IN clause when excludedIds is empty", async () => {
      const tx = makeTransaction({ id: "tx-1" });

      const resolveQb = createMockQueryBuilder({
        getMany: jest.fn().mockResolvedValue([{ id: "tx-1" }]),
      });
      const exclusionsQb = createMockQueryBuilder({
        getMany: jest.fn().mockResolvedValue([tx]),
      });

      transactionsRepository.createQueryBuilder
        .mockReturnValueOnce(resolveQb)
        .mockReturnValueOnce(exclusionsQb);

      const updateQb = createMockQueryBuilder({
        execute: jest.fn().mockResolvedValue({ affected: 1 }),
      });
      mockManagerCreateQueryBuilder.mockReturnValueOnce(updateQb);

      const dto: BulkUpdateDto = {
        mode: "filter",
        filters: { payeeIds: ["payee-1"] },
        excludedIds: [],
        description: "test",
      };

      await service.bulkUpdate(userId, dto);

      expect(resolveQb.andWhere).not.toHaveBeenCalledWith(
        "transaction.id NOT IN (:...excludedIds)",
        expect.anything(),
      );
    });
  });
});
