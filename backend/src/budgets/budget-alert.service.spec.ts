import { DataSource, In } from "typeorm";
import { Test, TestingModule } from "@nestjs/testing";
import { getRepositoryToken } from "@nestjs/typeorm";
import { ConfigService } from "@nestjs/config";
import { I18nService } from "nestjs-i18n";
import { BudgetAlertService, DIGEST_TYPES } from "./budget-alert.service";
import { NotificationService } from "../notification-center/notification.service";
import { NotificationDispatchService } from "../notifications/notification-dispatch.service";
import { NotificationPreferenceService } from "../notification-center/notification-preference.service";
import { Budget, BudgetType, BudgetStrategy } from "./entities/budget.entity";
import {
  BudgetCategory,
  RolloverType,
} from "./entities/budget-category.entity";
import {
  Notification,
  NotificationType,
  NotificationSeverity,
} from "../notification-center/entities/notification.entity";
import { Transaction } from "../transactions/entities/transaction.entity";
import { TransactionSplit } from "../transactions/entities/transaction-split.entity";
import { User } from "../users/entities/user.entity";
import { UserPreference } from "../users/entities/user-preference.entity";
import { ScheduledTransaction } from "../scheduled-transactions/entities/scheduled-transaction.entity";
import { EmailService } from "../notifications/email.service";
import {
  createScopedDbMocks,
  DataSourceMock,
} from "../test-helpers/scoped-db-testing";

jest.mock("../common/db/scoped-db", () =>
  jest.requireActual("../test-helpers/scoped-db-testing").scopedDbMockModule(),
);

function makeCategory(overrides: Partial<BudgetCategory> = {}): BudgetCategory {
  return {
    id: "bc-1",
    budgetId: "budget-1",
    budget: {} as Budget,
    categoryId: "cat-1",
    category: { id: "cat-1", name: "Groceries", isIncome: false } as any,
    categoryGroup: null,
    transferAccountId: null,
    transferAccount: null,
    isTransfer: false,
    amount: 500,
    isIncome: false,
    rolloverType: RolloverType.NONE,
    rolloverCap: null,
    flexGroup: null,
    alertWarnPercent: 80,
    alertCriticalPercent: 95,
    notes: null,
    sortOrder: 0,
    createdAt: new Date(),
    updatedAt: new Date(),
    ...overrides,
  };
}

function makeBudget(overrides: Partial<Budget> = {}): Budget {
  return {
    id: "budget-1",
    userId: "11111111-1111-1111-1111-111111111111",
    name: "Monthly Budget",
    description: null,
    budgetType: BudgetType.MONTHLY,
    periodStart: "2026-01-01",
    periodEnd: null,
    baseIncome: 5000,
    incomeLinked: false,
    strategy: BudgetStrategy.FIXED,
    isActive: true,
    currencyCode: "USD",
    config: {},
    categories: [makeCategory()],
    periods: [],
    createdAt: new Date(),
    updatedAt: new Date(),
    ...overrides,
  };
}

function makeAlert(overrides: Partial<Notification> = {}): Notification {
  return {
    id: "alert-1",
    userId: "11111111-1111-1111-1111-111111111111",
    budgetId: "budget-1",
    budget: {} as Budget,
    budgetCategoryId: "bc-1",
    budgetCategory: null,
    type: NotificationType.THRESHOLD_WARNING,
    severity: NotificationSeverity.WARNING,
    target: null,
    title: "Test alert",
    message: "Test message",
    data: {},
    isRead: false,
    isEmailSent: false,
    periodStart: "2026-02-01",
    createdAt: new Date(),
    dismissedAt: null,
    dedupeKey: null,
    ...overrides,
  };
}

describe("BudgetAlertService", () => {
  let scopedDataSource: DataSourceMock;
  /** Rows the conflict-safe INSERT accepted, in order. */
  let insertedAlerts: Record<string, unknown>[];
  let service: BudgetAlertService;
  let budgetsRepository: Record<string, jest.Mock>;
  let alertsRepository: Record<string, jest.Mock>;
  let transactionsRepository: Record<string, jest.Mock>;
  let splitsRepository: Record<string, jest.Mock>;
  let usersRepository: Record<string, jest.Mock>;
  let preferencesRepository: Record<string, jest.Mock>;
  let scheduledTransactionsRepository: Record<string, jest.Mock>;
  let emailService: Record<string, jest.Mock>;
  let configService: Record<string, jest.Mock>;

  const mockQueryBuilder = {
    select: jest.fn().mockReturnThis(),
    addSelect: jest.fn().mockReturnThis(),
    where: jest.fn().mockReturnThis(),
    andWhere: jest.fn().mockReturnThis(),
    innerJoin: jest.fn().mockReturnThis(),
    groupBy: jest.fn().mockReturnThis(),
    getRawMany: jest.fn().mockResolvedValue([]),
  };

  beforeEach(async () => {
    budgetsRepository = {
      find: jest.fn().mockResolvedValue([]),
    };

    alertsRepository = {
      find: jest.fn().mockResolvedValue([]),
      create: jest
        .fn()
        .mockImplementation((data) => ({ ...data, id: "new-alert-id" })),
      save: jest
        .fn()
        .mockImplementation((data) =>
          Promise.resolve({ ...data, id: data.id || "new-alert-id" }),
        ),
      delete: jest.fn().mockResolvedValue({ affected: 0 }),
      // Reads back the row the conflict-safe INSERT accepted.
      findOne: jest.fn().mockResolvedValue(null),
    };

    transactionsRepository = {
      createQueryBuilder: jest.fn().mockReturnValue({ ...mockQueryBuilder }),
    };

    splitsRepository = {
      createQueryBuilder: jest.fn().mockReturnValue({ ...mockQueryBuilder }),
    };

    usersRepository = {
      findOne: jest.fn().mockResolvedValue({
        id: "11111111-1111-1111-1111-111111111111",
        email: "user@test.com",
        firstName: "Test",
      }),
    };

    preferencesRepository = {
      findOne: jest.fn().mockResolvedValue({
        userId: "11111111-1111-1111-1111-111111111111",
        notificationEmail: true,
        budgetDigestEnabled: true,
        budgetDigestDay: "MONDAY",
      }),
    };

    scheduledTransactionsRepository = {
      createQueryBuilder: jest.fn().mockReturnValue({
        where: jest.fn().mockReturnThis(),
        getMany: jest.fn().mockResolvedValue([]),
      }),
    };

    emailService = {
      getStatus: jest.fn().mockReturnValue({ configured: true }),
      sendMail: jest.fn().mockResolvedValue(undefined),
    };

    configService = {
      get: jest.fn().mockImplementation((key: string, def?: string) => {
        if (key === "PUBLIC_APP_URL") return "http://localhost:3000";
        return def;
      }),
    };

    let scopedManager: Record<string, jest.Mock>;
    ({ manager: scopedManager, dataSource: scopedDataSource } =
      createScopedDbMocks([
        [Budget, budgetsRepository as never],
        [Notification, alertsRepository as never],
        [Transaction, transactionsRepository as never],
        [TransactionSplit, splitsRepository as never],
        [User, usersRepository as never],
        [UserPreference, preferencesRepository as never],
        [ScheduledTransaction, scheduledTransactionsRepository as never],
      ]));

    // Alerts are inserted with `ON CONFLICT DO NOTHING RETURNING id`, and what
    // that statement returns is what decides whether an alert is new -- the
    // unique fingerprint from migration 140 is the de-duplication rule now, not
    // the in-memory comparison (audit P4-015). So the double has to behave like
    // the real insert: record the row, hand back an id, and let the follow-up
    // read find it.
    //
    // Parameters are read by the column the statement names rather than by
    // position: by index this double silently mapped `target` onto `periodStart`
    // the moment the INSERT moved behind one write door, which is a fact about
    // that writer's column order and not about the row.
    insertedAlerts = [];
    scopedManager.query.mockImplementation(
      async (sql: string, params: unknown[]) => {
        if (!sql.includes("INSERT INTO notifications")) return [];
        const columns = /INSERT INTO notifications\s*\(([^)]*)\)/.exec(sql);
        if (!columns) throw new Error(`no column list in: ${sql}`);
        const byColumn = Object.fromEntries(
          columns[1]
            .split(",")
            .map((name, i) => [name.trim(), params[i]] as const),
        );
        const row = {
          id: `alert-${insertedAlerts.length + 1}`,
          userId: byColumn.user_id,
          budgetId: byColumn.budget_id,
          budgetCategoryId: byColumn.budget_category_id,
          type: byColumn.alert_type,
          severity: byColumn.severity,
          title: byColumn.title,
          message: byColumn.message,
          data: JSON.parse(String(byColumn.data)),
          periodStart: byColumn.period_start,
        };
        insertedAlerts.push(row);
        return [[{ id: row.id }], 1];
      },
    );
    alertsRepository.findOne.mockImplementation(
      async ({ where }: { where: { id: string } }) =>
        insertedAlerts.find((row) => row.id === where.id) ?? null,
    );

    const module: TestingModule = await Test.createTestingModule({
      providers: [
        BudgetAlertService,
        // The real write door on the same mocked connection: these tests are
        // about the statement that lands and which alerts email, so a double
        // standing in for the writer would assert the call instead of the row.
        {
          provide: NotificationService,
          useFactory: () => new NotificationService(scopedDataSource as never),
        },
        {
          // The fan-out seam forwards to the real write door here, so the
          // existing "which statement lands / which alerts email" assertions
          // hold unchanged; the push/email fan-out has its own dedicated spec.
          provide: NotificationDispatchService,
          useFactory: (notifications: NotificationService) => ({
            notify: (userId: string, input: unknown) =>
              notifications.create(userId, input as never),
          }),
          inject: [NotificationService],
        },
        { provide: getRepositoryToken(Budget), useValue: budgetsRepository },
        {
          provide: getRepositoryToken(Notification),
          useValue: alertsRepository,
        },
        {
          provide: getRepositoryToken(Transaction),
          useValue: transactionsRepository,
        },
        {
          provide: getRepositoryToken(TransactionSplit),
          useValue: splitsRepository,
        },
        { provide: getRepositoryToken(User), useValue: usersRepository },
        {
          provide: getRepositoryToken(UserPreference),
          useValue: preferencesRepository,
        },
        {
          provide: getRepositoryToken(ScheduledTransaction),
          useValue: scheduledTransactionsRepository,
        },
        { provide: EmailService, useValue: emailService },
        { provide: ConfigService, useValue: configService },
        {
          provide: I18nService,
          useValue: {
            translate: (key: string, opts?: { defaultValue?: string }) =>
              opts?.defaultValue ?? key,
          },
        },
        { provide: DataSource, useValue: scopedDataSource },
        {
          // Mirror the real resolver's master-gate: with no per-category row,
          // resolveEmail == the user's notification_email. So the existing
          // notificationEmail fixtures keep controlling the email path.
          provide: NotificationPreferenceService,
          useValue: {
            resolveEmail: jest.fn(async (userId: string) => {
              const prefs = await preferencesRepository.findOne({
                where: { userId },
              });
              return prefs ? prefs.notificationEmail !== false : true;
            }),
          },
        },
      ],
    }).compile();

    service = module.get<BudgetAlertService>(BudgetAlertService);
  });

  describe("localized alert emails", () => {
    beforeEach(() => {
      preferencesRepository.findOne.mockResolvedValue({
        language: "pl",
        notificationEmail: true,
        budgetDigestEnabled: true,
      });
      jest
        .spyOn(service["i18n"], "translate")
        .mockImplementation((key, options) => {
          expect(options?.lang).toBe("pl");
          if (key === "emails.notificationCopy.budget.overTitle")
            return "Jedzenie: limit przekroczony";
          if (key === "emails.notificationCopy.budget.overMessage")
            return `Wydano ${(options?.args as Record<string, unknown>)?.amount}`;
          return options?.defaultValue ?? key;
        });
    });
    const alert = () =>
      makeAlert({
        type: NotificationType.OVER_BUDGET,
        title: "Stored title",
        message: "Stored message",
        data: {
          categoryName: "Food",
          amount: 120,
          limit: 100,
          percent: 120,
          currencyCode: "PLN",
        },
      });
    it("uses localized copy in the critical email body and single-alert subject", async () => {
      await service["sendImmediateAlertEmail"]("u1", [alert()]);
      const [, subject, html] = emailService.sendMail.mock.calls[0];
      expect(subject).toContain("Jedzenie: limit przekroczony");
      expect(html).toContain("Wydano 120,00");
      expect(html).not.toContain("Stored title");
    });
    it("uses the same localized copy in the weekly digest", async () => {
      alertsRepository.find.mockResolvedValue([alert()]);
      await service["sendDigestForUser"]("u1", [makeBudget()]);
      const html = emailService.sendMail.mock.calls[0][2];
      expect(html).toContain("Jedzenie: limit przekroczony");
      expect(html).not.toContain("Stored title");
    });
  });

  describe("checkThresholdAlerts", () => {
    it("returns OVER_BUDGET alert when spending is > 100%", () => {
      const alerts = service.checkThresholdAlerts({
        budgetCategoryId: "bc-1",
        categoryId: "cat-1",
        categoryName: "Groceries",
        currencyCode: "USD",
        budgeted: 500,
        spent: 550,
        percentUsed: 110,
        isIncome: false,
        alertWarnPercent: 80,
        alertCriticalPercent: 95,
        flexGroup: null,
      });

      expect(alerts).toHaveLength(1);
      expect(alerts[0].type).toBe(NotificationType.OVER_BUDGET);
      expect(alerts[0].severity).toBe(NotificationSeverity.CRITICAL);
      expect(alerts[0].title).toContain("Groceries");
      expect(alerts[0].title).toContain("over budget");
    });

    it("returns THRESHOLD_CRITICAL alert when at critical threshold", () => {
      const alerts = service.checkThresholdAlerts({
        budgetCategoryId: "bc-1",
        categoryId: "cat-1",
        categoryName: "Dining",
        currencyCode: "USD",
        budgeted: 300,
        spent: 290,
        percentUsed: 96.67,
        isIncome: false,
        alertWarnPercent: 80,
        alertCriticalPercent: 95,
        flexGroup: null,
      });

      expect(alerts).toHaveLength(1);
      expect(alerts[0].type).toBe(NotificationType.THRESHOLD_CRITICAL);
      expect(alerts[0].severity).toBe(NotificationSeverity.WARNING);
    });

    it("returns THRESHOLD_WARNING alert when at warn threshold", () => {
      const alerts = service.checkThresholdAlerts({
        budgetCategoryId: "bc-1",
        categoryId: "cat-1",
        categoryName: "Entertainment",
        currencyCode: "USD",
        budgeted: 200,
        spent: 170,
        percentUsed: 85,
        isIncome: false,
        alertWarnPercent: 80,
        alertCriticalPercent: 95,
        flexGroup: null,
      });

      expect(alerts).toHaveLength(1);
      expect(alerts[0].type).toBe(NotificationType.THRESHOLD_WARNING);
      expect(alerts[0].severity).toBe(NotificationSeverity.WARNING);
    });

    it("returns no alerts when spending is below warn threshold", () => {
      const alerts = service.checkThresholdAlerts({
        budgetCategoryId: "bc-1",
        categoryId: "cat-1",
        categoryName: "Clothing",
        currencyCode: "USD",
        budgeted: 400,
        spent: 200,
        percentUsed: 50,
        isIncome: false,
        alertWarnPercent: 80,
        alertCriticalPercent: 95,
        flexGroup: null,
      });

      expect(alerts).toHaveLength(0);
    });

    it("respects custom alert thresholds per category", () => {
      const alerts = service.checkThresholdAlerts({
        budgetCategoryId: "bc-1",
        categoryId: "cat-1",
        categoryName: "Travel",
        currencyCode: "USD",
        budgeted: 1000,
        spent: 710,
        percentUsed: 71,
        isIncome: false,
        alertWarnPercent: 70,
        alertCriticalPercent: 90,
        flexGroup: null,
      });

      expect(alerts).toHaveLength(1);
      expect(alerts[0].type).toBe(NotificationType.THRESHOLD_WARNING);
    });

    it("includes data fields in alert", () => {
      const alerts = service.checkThresholdAlerts({
        budgetCategoryId: "bc-1",
        categoryId: "cat-1",
        categoryName: "Groceries",
        currencyCode: "USD",
        budgeted: 500,
        spent: 450,
        percentUsed: 90,
        isIncome: false,
        alertWarnPercent: 80,
        alertCriticalPercent: 95,
        flexGroup: null,
      });

      expect(alerts).toHaveLength(1);
      expect(alerts[0].data.categoryName).toBe("Groceries");
      expect(alerts[0].data.percent).toBe(90);
      expect(alerts[0].data.amount).toBe(450);
      expect(alerts[0].data.limit).toBe(500);
    });

    it("returns THRESHOLD_CRITICAL at exactly 100% (not OVER_BUDGET)", () => {
      // At exactly 100%, spending equals budget -- not over budget
      const alerts = service.checkThresholdAlerts({
        budgetCategoryId: "bc-1",
        categoryId: "cat-1",
        categoryName: "Groceries",
        currencyCode: "USD",
        budgeted: 500,
        spent: 500,
        percentUsed: 100,
        isIncome: false,
        alertWarnPercent: 80,
        alertCriticalPercent: 95,
        flexGroup: null,
      });

      expect(alerts).toHaveLength(1);
      expect(alerts[0].type).toBe(NotificationType.THRESHOLD_CRITICAL);
      expect(alerts[0].severity).toBe(NotificationSeverity.WARNING);
    });
  });

  describe("checkVelocityAlert", () => {
    it("returns PROJECTED_OVERSPEND when pace exceeds 110% projection", () => {
      const alert = service.checkVelocityAlert(
        {
          budgetCategoryId: "bc-1",
          categoryId: "cat-1",
          categoryName: "Dining",
          currencyCode: "USD",
          budgeted: 300,
          spent: 200,
          percentUsed: 66.67,
          isIncome: false,
          alertWarnPercent: 80,
          alertCriticalPercent: 95,
          flexGroup: null,
        },
        10, // daysElapsed
        30, // totalDays
      );

      // dailyRate = 200/10 = 20, projected = 20*30 = 600, 600/300 = 200%
      expect(alert).not.toBeNull();
      expect(alert!.type).toBe(NotificationType.PROJECTED_OVERSPEND);
      expect(alert!.severity).toBe(NotificationSeverity.WARNING);
      expect(alert!.data.projectedTotal).toBe(600);
    });

    it("returns null when pace is within budget", () => {
      const alert = service.checkVelocityAlert(
        {
          budgetCategoryId: "bc-1",
          categoryId: "cat-1",
          categoryName: "Groceries",
          currencyCode: "USD",
          budgeted: 500,
          spent: 100,
          percentUsed: 20,
          isIncome: false,
          alertWarnPercent: 80,
          alertCriticalPercent: 95,
          flexGroup: null,
        },
        10,
        30,
      );

      // dailyRate = 100/10 = 10, projected = 10*30 = 300, 300/500 = 60%
      expect(alert).toBeNull();
    });

    it("returns null when already over budget (handled by threshold alerts)", () => {
      const alert = service.checkVelocityAlert(
        {
          budgetCategoryId: "bc-1",
          categoryId: "cat-1",
          categoryName: "Groceries",
          currencyCode: "USD",
          budgeted: 500,
          spent: 600,
          percentUsed: 120,
          isIncome: false,
          alertWarnPercent: 80,
          alertCriticalPercent: 95,
          flexGroup: null,
        },
        15,
        30,
      );

      expect(alert).toBeNull();
    });

    it("includes daily rate and projected amounts in data", () => {
      const alert = service.checkVelocityAlert(
        {
          budgetCategoryId: "bc-1",
          categoryId: "cat-1",
          categoryName: "Transport",
          currencyCode: "USD",
          budgeted: 200,
          spent: 150,
          percentUsed: 75,
          isIncome: false,
          alertWarnPercent: 80,
          alertCriticalPercent: 95,
          flexGroup: null,
        },
        10,
        30,
      );

      // dailyRate = 150/10 = 15, projected = 15*30 = 450, 450/200 = 225%
      expect(alert).not.toBeNull();
      expect(alert!.data.dailyRate).toBe(15);
      expect(alert!.data.projectedTotal).toBe(450);
      expect(alert!.data.budgeted).toBe(200);
    });
  });

  describe("checkFlexGroupAlerts", () => {
    it("returns alert when flex group reaches 90%", () => {
      const alerts = service.checkFlexGroupAlerts([
        {
          budgetCategoryId: "bc-1",
          categoryId: "cat-1",
          categoryName: "Dining",
          currencyCode: "USD",
          budgeted: 300,
          spent: 280,
          percentUsed: 93.33,
          isIncome: false,
          alertWarnPercent: 80,
          alertCriticalPercent: 95,
          flexGroup: "Fun Money",
        },
        {
          budgetCategoryId: "bc-2",
          categoryId: "cat-2",
          categoryName: "Entertainment",
          currencyCode: "USD",
          budgeted: 200,
          spent: 180,
          percentUsed: 90,
          isIncome: false,
          alertWarnPercent: 80,
          alertCriticalPercent: 95,
          flexGroup: "Fun Money",
        },
      ]);

      // Total: 460/500 = 92%
      expect(alerts).toHaveLength(1);
      expect(alerts[0].type).toBe(NotificationType.FLEX_GROUP_WARNING);
      expect(alerts[0].data.flexGroup).toBe("Fun Money");
      expect(alerts[0].data.percent).toBe(92);
    });

    it("returns no alert when flex group is under 90%", () => {
      const alerts = service.checkFlexGroupAlerts([
        {
          budgetCategoryId: "bc-1",
          categoryId: "cat-1",
          categoryName: "Dining",
          currencyCode: "USD",
          budgeted: 300,
          spent: 100,
          percentUsed: 33.33,
          isIncome: false,
          alertWarnPercent: 80,
          alertCriticalPercent: 95,
          flexGroup: "Fun Money",
        },
        {
          budgetCategoryId: "bc-2",
          categoryId: "cat-2",
          categoryName: "Entertainment",
          currencyCode: "USD",
          budgeted: 200,
          spent: 50,
          percentUsed: 25,
          isIncome: false,
          alertWarnPercent: 80,
          alertCriticalPercent: 95,
          flexGroup: "Fun Money",
        },
      ]);

      // Total: 150/500 = 30%
      expect(alerts).toHaveLength(0);
    });

    it("handles multiple flex groups independently", () => {
      const alerts = service.checkFlexGroupAlerts([
        {
          budgetCategoryId: "bc-1",
          categoryId: "cat-1",
          categoryName: "Dining",
          currencyCode: "USD",
          budgeted: 300,
          spent: 280,
          percentUsed: 93.33,
          isIncome: false,
          alertWarnPercent: 80,
          alertCriticalPercent: 95,
          flexGroup: "Fun Money",
        },
        {
          budgetCategoryId: "bc-2",
          categoryId: "cat-2",
          categoryName: "Hobbies",
          currencyCode: "USD",
          budgeted: 200,
          spent: 180,
          percentUsed: 90,
          isIncome: false,
          alertWarnPercent: 80,
          alertCriticalPercent: 95,
          flexGroup: "Fun Money",
        },
        {
          budgetCategoryId: "bc-3",
          categoryId: "cat-3",
          categoryName: "Gas",
          currencyCode: "USD",
          budgeted: 200,
          spent: 50,
          percentUsed: 25,
          isIncome: false,
          alertWarnPercent: 80,
          alertCriticalPercent: 95,
          flexGroup: "Transport",
        },
      ]);

      // Fun Money: 460/500 = 92% -> alert
      // Transport: 50/200 = 25% -> no alert
      expect(alerts).toHaveLength(1);
      expect(alerts[0].data.flexGroup).toBe("Fun Money");
    });

    it("ignores categories without flex group", () => {
      const alerts = service.checkFlexGroupAlerts([
        {
          budgetCategoryId: "bc-1",
          categoryId: "cat-1",
          categoryName: "Rent",
          currencyCode: "USD",
          budgeted: 1500,
          spent: 1500,
          percentUsed: 100,
          isIncome: false,
          alertWarnPercent: 80,
          alertCriticalPercent: 95,
          flexGroup: null,
        },
      ]);

      expect(alerts).toHaveLength(0);
    });
  });

  describe("checkIncomeShortfall", () => {
    it("returns INCOME_SHORTFALL when income is < 80% of expected at 50%+ progress", () => {
      const alert = service.checkIncomeShortfall(
        [
          {
            budgetCategoryId: "bc-inc-1",
            categoryId: "cat-inc-1",
            categoryName: "Salary",
            currencyCode: "USD",
            budgeted: 5000,
            spent: 1500,
            percentUsed: 30,
            isIncome: true,
            alertWarnPercent: 80,
            alertCriticalPercent: 95,
            flexGroup: null,
          },
        ],
        5000,
        0.6, // 60% through period
      );

      // Expected at 60%: 5000 * 0.6 = 3000, actual: 1500, ratio = 0.5 < 0.8
      expect(alert).not.toBeNull();
      expect(alert!.type).toBe(NotificationType.INCOME_SHORTFALL);
      expect(alert!.severity).toBe(NotificationSeverity.CRITICAL);
    });

    it("returns null when income is on track", () => {
      const alert = service.checkIncomeShortfall(
        [
          {
            budgetCategoryId: "bc-inc-1",
            categoryId: "cat-inc-1",
            categoryName: "Salary",
            currencyCode: "USD",
            budgeted: 5000,
            spent: 4000,
            percentUsed: 80,
            isIncome: true,
            alertWarnPercent: 80,
            alertCriticalPercent: 95,
            flexGroup: null,
          },
        ],
        5000,
        0.7,
      );

      // Expected at 70%: 3500, actual: 4000, ratio = 1.14 > 0.8
      expect(alert).toBeNull();
    });

    it("returns null when period progress is less than 50%", () => {
      const alert = service.checkIncomeShortfall(
        [
          {
            budgetCategoryId: "bc-inc-1",
            categoryId: "cat-inc-1",
            categoryName: "Salary",
            currencyCode: "USD",
            budgeted: 5000,
            spent: 0,
            percentUsed: 0,
            isIncome: true,
            alertWarnPercent: 80,
            alertCriticalPercent: 95,
            flexGroup: null,
          },
        ],
        5000,
        0.3,
      );

      expect(alert).toBeNull();
    });
  });

  describe("checkPositiveMilestones", () => {
    it("returns POSITIVE_MILESTONE when under 60% used at 50%+ progress", () => {
      const alerts = service.checkPositiveMilestones(
        [
          {
            budgetCategoryId: "bc-1",
            categoryId: "cat-1",
            categoryName: "Groceries",
            currencyCode: "USD",
            budgeted: 500,
            spent: 200,
            percentUsed: 40,
            isIncome: false,
            alertWarnPercent: 80,
            alertCriticalPercent: 95,
            flexGroup: null,
          },
          {
            budgetCategoryId: "bc-2",
            categoryId: "cat-2",
            categoryName: "Dining",
            currencyCode: "USD",
            budgeted: 300,
            spent: 100,
            percentUsed: 33.33,
            isIncome: false,
            alertWarnPercent: 80,
            alertCriticalPercent: 95,
            flexGroup: null,
          },
        ],
        0.6, // 60% through
        12, // 12 days remaining
      );

      // Total: 300/800 = 37.5%
      expect(alerts).toHaveLength(1);
      expect(alerts[0].type).toBe(NotificationType.POSITIVE_MILESTONE);
      expect(alerts[0].severity).toBe(NotificationSeverity.SUCCESS);
    });

    it("returns no milestone when spending is >= 60%", () => {
      const alerts = service.checkPositiveMilestones(
        [
          {
            budgetCategoryId: "bc-1",
            categoryId: "cat-1",
            categoryName: "Groceries",
            currencyCode: "USD",
            budgeted: 500,
            spent: 350,
            percentUsed: 70,
            isIncome: false,
            alertWarnPercent: 80,
            alertCriticalPercent: 95,
            flexGroup: null,
          },
        ],
        0.6,
        12,
      );

      expect(alerts).toHaveLength(0);
    });

    it("returns no milestone when period progress is less than 50%", () => {
      const alerts = service.checkPositiveMilestones(
        [
          {
            budgetCategoryId: "bc-1",
            categoryId: "cat-1",
            categoryName: "Groceries",
            currencyCode: "USD",
            budgeted: 500,
            spent: 50,
            percentUsed: 10,
            isIncome: false,
            alertWarnPercent: 80,
            alertCriticalPercent: 95,
            flexGroup: null,
          },
        ],
        0.3,
        21,
      );

      expect(alerts).toHaveLength(0);
    });

    it("returns no milestone when no days remaining", () => {
      const alerts = service.checkPositiveMilestones(
        [
          {
            budgetCategoryId: "bc-1",
            categoryId: "cat-1",
            categoryName: "Groceries",
            currencyCode: "USD",
            budgeted: 500,
            spent: 100,
            percentUsed: 20,
            isIncome: false,
            alertWarnPercent: 80,
            alertCriticalPercent: 95,
            flexGroup: null,
          },
        ],
        1.0,
        0,
      );

      expect(alerts).toHaveLength(0);
    });
  });

  describe("deduplicateAlerts", () => {
    it("filters out alerts that already exist for the same type and category", () => {
      const candidates = [
        {
          budgetId: "budget-1",
          budgetCategoryId: "bc-1",
          type: NotificationType.THRESHOLD_WARNING,
          severity: NotificationSeverity.WARNING,
          title: "Warning",
          message: "Warning message",
          data: {},
        },
        {
          budgetId: "budget-1",
          budgetCategoryId: "bc-2",
          type: NotificationType.OVER_BUDGET,
          severity: NotificationSeverity.CRITICAL,
          title: "Over budget",
          message: "Over budget message",
          data: {},
        },
      ];

      const existing = [
        makeAlert({
          type: NotificationType.THRESHOLD_WARNING,
          budgetCategoryId: "bc-1",
        }),
      ];

      const result = service.deduplicateAlerts(candidates, existing);

      expect(result).toHaveLength(1);
      expect(result[0].type).toBe(NotificationType.OVER_BUDGET);
      expect(result[0].budgetCategoryId).toBe("bc-2");
    });

    it("allows alerts of different types for the same category", () => {
      const candidates = [
        {
          budgetId: "budget-1",
          budgetCategoryId: "bc-1",
          type: NotificationType.THRESHOLD_WARNING,
          severity: NotificationSeverity.WARNING,
          title: "Warning",
          message: "Warning message",
          data: {},
        },
        {
          budgetId: "budget-1",
          budgetCategoryId: "bc-1",
          type: NotificationType.PROJECTED_OVERSPEND,
          severity: NotificationSeverity.WARNING,
          title: "Projected overspend",
          message: "Projected message",
          data: {},
        },
      ];

      const existing = [
        makeAlert({
          type: NotificationType.THRESHOLD_WARNING,
          budgetCategoryId: "bc-1",
        }),
      ];

      const result = service.deduplicateAlerts(candidates, existing);

      expect(result).toHaveLength(1);
      expect(result[0].type).toBe(NotificationType.PROJECTED_OVERSPEND);
    });

    it("returns all candidates when no existing alerts", () => {
      const candidates = [
        {
          budgetId: "budget-1",
          budgetCategoryId: "bc-1",
          type: NotificationType.THRESHOLD_WARNING,
          severity: NotificationSeverity.WARNING,
          title: "Warning",
          message: "Warning message",
          data: {},
        },
      ];

      const result = service.deduplicateAlerts(candidates, []);

      expect(result).toHaveLength(1);
    });

    it("handles null budgetCategoryId for budget-level alerts", () => {
      const candidates = [
        {
          budgetId: "budget-1",
          budgetCategoryId: null,
          type: NotificationType.POSITIVE_MILESTONE,
          severity: NotificationSeverity.SUCCESS,
          title: "On track",
          message: "On track message",
          data: {},
        },
      ];

      const existing = [
        makeAlert({
          type: NotificationType.POSITIVE_MILESTONE,
          budgetCategoryId: null,
        }),
      ];

      const result = service.deduplicateAlerts(candidates, existing);

      expect(result).toHaveLength(0);
    });
  });

  describe("processAlerts", () => {
    it("returns zero alerts when budget has no categories", async () => {
      const budget = makeBudget({ categories: [] });

      const result = await service.processAlerts(budget);

      expect(result.alertsCreated).toBe(0);
      expect(result.emailsSent).toBe(0);
    });

    it("creates threshold alerts for over-budget categories", async () => {
      const budget = makeBudget({
        categories: [
          makeCategory({
            id: "bc-1",
            categoryId: "cat-1",
            category: {
              id: "cat-1",
              name: "Groceries",
              isIncome: false,
            } as any,
            amount: 500,
          }),
        ],
      });

      const qb = {
        select: jest.fn().mockReturnThis(),
        addSelect: jest.fn().mockReturnThis(),
        where: jest.fn().mockReturnThis(),
        andWhere: jest.fn().mockReturnThis(),
        innerJoin: jest.fn().mockReturnThis(),
        groupBy: jest.fn().mockReturnThis(),
        getRawMany: jest
          .fn()
          .mockResolvedValue([{ categoryId: "cat-1", total: "-550" }]),
      };

      transactionsRepository.createQueryBuilder.mockReturnValue(qb);
      splitsRepository.createQueryBuilder.mockReturnValue({
        ...qb,
        getRawMany: jest.fn().mockResolvedValue([]),
      });

      alertsRepository.find.mockResolvedValue([]);

      const result = await service.processAlerts(budget);

      expect(result.alertsCreated).toBeGreaterThan(0);
      expect(insertedAlerts.length).toBeGreaterThan(0);
      expect(insertedAlerts[0].type).toBe(NotificationType.OVER_BUDGET);
      expect(insertedAlerts[0].data).toEqual(
        expect.objectContaining({ currencyCode: budget.currencyCode }),
      );
    });

    it("sends immediate email for critical alerts", async () => {
      const budget = makeBudget({
        categories: [
          makeCategory({
            id: "bc-1",
            categoryId: "cat-1",
            category: {
              id: "cat-1",
              name: "Groceries",
              isIncome: false,
            } as any,
            amount: 500,
            alertCriticalPercent: 95,
          }),
        ],
      });

      const qb = {
        select: jest.fn().mockReturnThis(),
        addSelect: jest.fn().mockReturnThis(),
        where: jest.fn().mockReturnThis(),
        andWhere: jest.fn().mockReturnThis(),
        innerJoin: jest.fn().mockReturnThis(),
        groupBy: jest.fn().mockReturnThis(),
        getRawMany: jest
          .fn()
          .mockResolvedValue([{ categoryId: "cat-1", total: "-600" }]),
      };

      transactionsRepository.createQueryBuilder.mockReturnValue(qb);
      splitsRepository.createQueryBuilder.mockReturnValue({
        ...qb,
        getRawMany: jest.fn().mockResolvedValue([]),
      });
      alertsRepository.find.mockResolvedValue([]);

      const result = await service.processAlerts(budget);

      expect(result.emailsSent).toBe(1);
      expect(emailService.sendMail).toHaveBeenCalled();
    });

    it("does not send email when user has notifications disabled", async () => {
      preferencesRepository.findOne.mockResolvedValue({
        userId: "11111111-1111-1111-1111-111111111111",
        notificationEmail: false,
      });

      const budget = makeBudget({
        categories: [
          makeCategory({
            id: "bc-1",
            categoryId: "cat-1",
            category: {
              id: "cat-1",
              name: "Groceries",
              isIncome: false,
            } as any,
            amount: 500,
          }),
        ],
      });

      const qb = {
        select: jest.fn().mockReturnThis(),
        addSelect: jest.fn().mockReturnThis(),
        where: jest.fn().mockReturnThis(),
        andWhere: jest.fn().mockReturnThis(),
        innerJoin: jest.fn().mockReturnThis(),
        groupBy: jest.fn().mockReturnThis(),
        getRawMany: jest
          .fn()
          .mockResolvedValue([{ categoryId: "cat-1", total: "-600" }]),
      };

      transactionsRepository.createQueryBuilder.mockReturnValue(qb);
      splitsRepository.createQueryBuilder.mockReturnValue({
        ...qb,
        getRawMany: jest.fn().mockResolvedValue([]),
      });
      alertsRepository.find.mockResolvedValue([]);

      const result = await service.processAlerts(budget);

      expect(result.emailsSent).toBe(0);
      expect(emailService.sendMail).not.toHaveBeenCalled();
    });

    it("deduplicates against existing alerts for the same period", async () => {
      const budget = makeBudget({
        categories: [
          makeCategory({
            id: "bc-1",
            categoryId: "cat-1",
            category: {
              id: "cat-1",
              name: "Groceries",
              isIncome: false,
            } as any,
            amount: 500,
          }),
        ],
      });

      const qb = {
        select: jest.fn().mockReturnThis(),
        addSelect: jest.fn().mockReturnThis(),
        where: jest.fn().mockReturnThis(),
        andWhere: jest.fn().mockReturnThis(),
        innerJoin: jest.fn().mockReturnThis(),
        groupBy: jest.fn().mockReturnThis(),
        getRawMany: jest
          .fn()
          .mockResolvedValue([{ categoryId: "cat-1", total: "-600" }]),
      };

      transactionsRepository.createQueryBuilder.mockReturnValue(qb);
      splitsRepository.createQueryBuilder.mockReturnValue({
        ...qb,
        getRawMany: jest.fn().mockResolvedValue([]),
      });

      // Existing alert for same type+category at WARNING severity
      // (M25: dedup now allows severity escalation, so CRITICAL candidate passes through)
      alertsRepository.find.mockResolvedValue([
        makeAlert({
          type: NotificationType.OVER_BUDGET,
          budgetCategoryId: "bc-1",
          severity: NotificationSeverity.WARNING,
        }),
      ]);

      await service.processAlerts(budget);

      // The OVER_BUDGET candidate has CRITICAL severity which is higher than the
      // existing WARNING, so severity escalation allows it through -- and the
      // unique fingerprint includes severity precisely so that it can.
      expect(insertedAlerts.map((row) => row.type)).toContain(
        NotificationType.OVER_BUDGET,
      );
    });

    it("suppresses alert when existing alert has same or higher severity", async () => {
      const budget = makeBudget({
        categories: [
          makeCategory({
            id: "bc-1",
            categoryId: "cat-1",
            category: {
              id: "cat-1",
              name: "Groceries",
              isIncome: false,
            } as any,
            amount: 500,
          }),
        ],
      });

      const qb = {
        select: jest.fn().mockReturnThis(),
        addSelect: jest.fn().mockReturnThis(),
        where: jest.fn().mockReturnThis(),
        andWhere: jest.fn().mockReturnThis(),
        innerJoin: jest.fn().mockReturnThis(),
        groupBy: jest.fn().mockReturnThis(),
        getRawMany: jest
          .fn()
          .mockResolvedValue([{ categoryId: "cat-1", total: "-600" }]),
      };

      transactionsRepository.createQueryBuilder.mockReturnValue(qb);
      splitsRepository.createQueryBuilder.mockReturnValue({
        ...qb,
        getRawMany: jest.fn().mockResolvedValue([]),
      });

      // Existing alert for same type+category already at CRITICAL severity
      // (M25: same-or-higher severity still suppresses the candidate)
      alertsRepository.find.mockResolvedValue([
        makeAlert({
          type: NotificationType.OVER_BUDGET,
          budgetCategoryId: "bc-1",
          severity: NotificationSeverity.CRITICAL,
        }),
      ]);

      await service.processAlerts(budget);

      // The OVER_BUDGET candidate has CRITICAL severity which equals the existing
      // CRITICAL, so no escalation -- the candidate is suppressed
      const createdAlerts = alertsRepository.create.mock.calls.map(
        (call: any[]) => call[0].type,
      );
      expect(createdAlerts).not.toContain(NotificationType.OVER_BUDGET);
    });
  });

  describe("checkBudgetAlerts", () => {
    it("does nothing when no active budgets exist", async () => {
      budgetsRepository.find.mockResolvedValue([]);

      await service.checkBudgetAlerts();

      expect(alertsRepository.create).not.toHaveBeenCalled();
    });

    it("processes all active budgets", async () => {
      const budget1 = makeBudget({ id: "budget-1", categories: [] });
      const budget2 = makeBudget({
        id: "budget-2",
        userId: "22222222-2222-2222-2222-222222222222",
        categories: [],
      });

      budgetsRepository.find.mockResolvedValue([budget1, budget2]);

      await service.checkBudgetAlerts();

      // Both budgets were processed (even with no categories)
      expect(budgetsRepository.find).toHaveBeenCalledWith({
        where: { isActive: true },
        relations: [
          "categories",
          "categories.category",
          "categories.category.parent",
          "categories.transferAccount",
        ],
      });
    });

    it("continues processing other budgets when one fails", async () => {
      const budget1 = makeBudget({
        id: "budget-1",
        categories: [makeCategory()],
      });
      const budget2 = makeBudget({
        id: "budget-2",
        userId: "22222222-2222-2222-2222-222222222222",
        categories: [],
      });

      budgetsRepository.find.mockResolvedValue([budget1, budget2]);

      // First budget's query will throw
      transactionsRepository.createQueryBuilder.mockImplementationOnce(() => {
        throw new Error("Database error");
      });

      await expect(service.checkBudgetAlerts()).resolves.not.toThrow();
    });

    it("handles top-level error gracefully", async () => {
      budgetsRepository.find.mockRejectedValue(new Error("Connection error"));

      await expect(service.checkBudgetAlerts()).resolves.not.toThrow();
    });
  });

  describe("sendWeeklyDigest", () => {
    it("does nothing when SMTP is not configured", async () => {
      emailService.getStatus.mockReturnValue({ configured: false });
      budgetsRepository.find.mockResolvedValue([makeBudget()]);

      await service.sendWeeklyDigest();

      expect(emailService.sendMail).not.toHaveBeenCalled();
    });

    it("does nothing when no active budgets exist", async () => {
      budgetsRepository.find.mockResolvedValue([]);

      await service.sendWeeklyDigest();

      expect(emailService.sendMail).not.toHaveBeenCalled();
    });

    it("skips users with budget digest disabled", async () => {
      budgetsRepository.find.mockResolvedValue([makeBudget()]);
      preferencesRepository.findOne.mockResolvedValue({
        userId: "11111111-1111-1111-1111-111111111111",
        notificationEmail: true,
        budgetDigestEnabled: false,
      });

      await service.sendWeeklyDigest();

      expect(emailService.sendMail).not.toHaveBeenCalled();
    });

    it("skips users with email notifications disabled", async () => {
      budgetsRepository.find.mockResolvedValue([makeBudget()]);
      preferencesRepository.findOne.mockResolvedValue({
        userId: "11111111-1111-1111-1111-111111111111",
        notificationEmail: false,
        budgetDigestEnabled: true,
      });

      await service.sendWeeklyDigest();

      expect(emailService.sendMail).not.toHaveBeenCalled();
    });

    it("sends digest email when alerts exist", async () => {
      budgetsRepository.find.mockResolvedValue([makeBudget()]);

      alertsRepository.find.mockResolvedValue([
        makeAlert({ type: NotificationType.THRESHOLD_WARNING }),
      ]);

      await service.sendWeeklyDigest();

      expect(emailService.sendMail).toHaveBeenCalledWith(
        "user@test.com",
        "Monize: Your weekly budget summary",
        expect.any(String),
      );
    });

    it("asks the database only for budget alerts, never for system alerts", async () => {
      // Both live in `notifications`, and a system alert raised on the FIRST
      // of a month carries that day as its `period_start` -- which is also the
      // month's budget period start. Without the `dedupe_key IS NULL` filter
      // it matched this query and was rendered inside the budget digest for
      // the rest of the month, and could produce a digest for a user with no
      // budget news at all.
      budgetsRepository.find.mockResolvedValue([makeBudget()]);
      alertsRepository.find.mockResolvedValue([
        makeAlert({ type: NotificationType.THRESHOLD_WARNING }),
      ]);

      await service.sendWeeklyDigest();

      const digestQuery = alertsRepository.find.mock.calls
        .map(([options]) => options)
        .find((options) => options?.where?.periodStart !== undefined);
      // Selected POSITIVELY -- the budget types plus BILL_DUE -- never by an
      // exclusion. `dedupeKey IS NULL` dropped every BILL_DUE row once they
      // carried an occurrence key; `NOT IN the system set` let a first-of-month
      // SCHEDULED_POST_FAILED (PAYMENTS, not system) into the budget digest.
      expect(digestQuery.where).toEqual(
        expect.objectContaining({ type: In(DIGEST_TYPES) }),
      );
      expect(DIGEST_TYPES).toContain(NotificationType.BILL_DUE);
      expect(DIGEST_TYPES).not.toContain(
        NotificationType.SCHEDULED_POST_FAILED,
      );
      expect(DIGEST_TYPES).not.toContain(NotificationType.SMTP_FAILURE);
      expect(digestQuery.where.dedupeKey).toBeUndefined();
    });

    it("sends no digest when the period's only alerts are system alerts", async () => {
      budgetsRepository.find.mockResolvedValue([makeBudget()]);
      // The filtered query is what the repository answers: no budget alerts.
      alertsRepository.find.mockResolvedValue([]);

      await service.sendWeeklyDigest();

      expect(emailService.sendMail).not.toHaveBeenCalled();
    });

    /**
     * "Has the schedule moved past this occurrence" is a question about the
     * occurrence's slot. An override can move an occurrence EARLIER than its
     * slot, so comparing `nextDueDate` against the announced date reads an
     * unposted bill as already paid and silently drops it from the digest
     * (issue #1247).
     */
    it("keeps a bill-due alert whose occurrence an override moved earlier", async () => {
      budgetsRepository.find.mockResolvedValue([makeBudget()]);
      alertsRepository.find.mockResolvedValue([
        makeAlert({
          type: NotificationType.BILL_DUE,
          data: {
            billId: "st-1",
            // Announced for the 20th; its recurrence slot is the 1st of March.
            dueDate: "2026-02-20",
            originalDate: "2026-03-01",
          },
        }),
      ]);
      scheduledTransactionsRepository.createQueryBuilder.mockReturnValue({
        where: jest.fn().mockReturnThis(),
        getMany: jest
          .fn()
          .mockResolvedValue([{ id: "st-1", nextDueDate: "2026-03-01" }]),
      });

      await service.sendWeeklyDigest();

      expect(emailService.sendMail).toHaveBeenCalled();
    });

    it("drops a bill-due alert once the schedule has advanced past its slot", async () => {
      budgetsRepository.find.mockResolvedValue([makeBudget()]);
      alertsRepository.find.mockResolvedValue([
        makeAlert({
          type: NotificationType.BILL_DUE,
          data: {
            billId: "st-1",
            dueDate: "2026-02-20",
            originalDate: "2026-03-01",
          },
        }),
      ]);
      scheduledTransactionsRepository.createQueryBuilder.mockReturnValue({
        where: jest.fn().mockReturnThis(),
        getMany: jest.fn().mockResolvedValue([
          // Posted: the schedule is on April now.
          { id: "st-1", nextDueDate: "2026-04-01" },
        ]),
      });

      await service.sendWeeklyDigest();

      expect(emailService.sendMail).not.toHaveBeenCalled();
    });

    it("falls back to the announced date for a row written before the slot was recorded", async () => {
      budgetsRepository.find.mockResolvedValue([makeBudget()]);
      alertsRepository.find.mockResolvedValue([
        makeAlert({
          type: NotificationType.BILL_DUE,
          data: { billId: "st-1", dueDate: "2026-02-20" },
        }),
      ]);
      scheduledTransactionsRepository.createQueryBuilder.mockReturnValue({
        where: jest.fn().mockReturnThis(),
        getMany: jest
          .fn()
          .mockResolvedValue([{ id: "st-1", nextDueDate: "2026-03-01" }]),
      });

      await service.sendWeeklyDigest();

      expect(emailService.sendMail).not.toHaveBeenCalled();
    });

    it("skips users with no recent alerts", async () => {
      budgetsRepository.find.mockResolvedValue([makeBudget()]);
      alertsRepository.find.mockResolvedValue([]);

      await service.sendWeeklyDigest();

      expect(emailService.sendMail).not.toHaveBeenCalled();
    });

    it("handles errors gracefully", async () => {
      budgetsRepository.find.mockRejectedValue(new Error("Connection error"));

      await expect(service.sendWeeklyDigest()).resolves.not.toThrow();
    });
  });

  describe("checkSeasonalSpikes", () => {
    it("returns SEASONAL_SPIKE alert when next month is historically expensive", async () => {
      const nextMonth = new Date();
      nextMonth.setMonth(nextMonth.getMonth() + 1);
      const nextMonthNum = nextMonth.getMonth() + 1;

      const budget = makeBudget({
        categories: [
          makeCategory({
            id: "bc-1",
            categoryId: "cat-1",
            category: {
              id: "cat-1",
              name: "Gifts",
              isIncome: false,
            } as any,
            amount: 100,
          }),
        ],
      });

      // Build monthly spending data where the next month is 2.5x above average
      const monthlyData: Array<{
        categoryId: string;
        month: number;
        total: string;
      }> = [];
      for (let m = 1; m <= 12; m++) {
        const amount = m === nextMonthNum ? "500" : "200";
        monthlyData.push({ categoryId: "cat-1", month: m, total: amount });
      }

      const qb = {
        select: jest.fn().mockReturnThis(),
        addSelect: jest.fn().mockReturnThis(),
        where: jest.fn().mockReturnThis(),
        andWhere: jest.fn().mockReturnThis(),
        innerJoin: jest.fn().mockReturnThis(),
        groupBy: jest.fn().mockReturnThis(),
        addGroupBy: jest.fn().mockReturnThis(),
        getRawMany: jest.fn().mockResolvedValue(monthlyData),
      };

      transactionsRepository.createQueryBuilder.mockReturnValue(qb);
      splitsRepository.createQueryBuilder.mockReturnValue({
        ...qb,
        getRawMany: jest.fn().mockResolvedValue([]),
      });

      const alerts = await service.checkSeasonalSpikes(
        "11111111-1111-1111-1111-111111111111",
        budget,
      );

      expect(alerts.length).toBeGreaterThanOrEqual(1);
      const spikeAlert = alerts.find(
        (a) => a.type === NotificationType.SEASONAL_SPIKE,
      );
      expect(spikeAlert).toBeDefined();
      expect(spikeAlert!.severity).toBe(NotificationSeverity.INFO);
      expect(spikeAlert!.data.typicalIncrease).toBeGreaterThanOrEqual(1.5);
      expect(spikeAlert!.data.highMonth).toBe(nextMonthNum);
    });

    it("returns no alerts when no categories have seasonal spikes", async () => {
      const budget = makeBudget({
        categories: [
          makeCategory({
            id: "bc-1",
            categoryId: "cat-1",
            category: {
              id: "cat-1",
              name: "Groceries",
              isIncome: false,
            } as any,
          }),
        ],
      });

      // Flat spending across all months
      const monthlyData: Array<{
        categoryId: string;
        month: number;
        total: string;
      }> = [];
      for (let m = 1; m <= 12; m++) {
        monthlyData.push({ categoryId: "cat-1", month: m, total: "200" });
      }

      const qb = {
        select: jest.fn().mockReturnThis(),
        addSelect: jest.fn().mockReturnThis(),
        where: jest.fn().mockReturnThis(),
        andWhere: jest.fn().mockReturnThis(),
        innerJoin: jest.fn().mockReturnThis(),
        groupBy: jest.fn().mockReturnThis(),
        addGroupBy: jest.fn().mockReturnThis(),
        getRawMany: jest.fn().mockResolvedValue(monthlyData),
      };

      transactionsRepository.createQueryBuilder.mockReturnValue(qb);
      splitsRepository.createQueryBuilder.mockReturnValue({
        ...qb,
        getRawMany: jest.fn().mockResolvedValue([]),
      });

      const alerts = await service.checkSeasonalSpikes(
        "11111111-1111-1111-1111-111111111111",
        budget,
      );

      expect(alerts).toHaveLength(0);
    });

    it("returns no alerts when budget has no expense categories", async () => {
      const budget = makeBudget({
        categories: [
          makeCategory({
            id: "bc-1",
            categoryId: "cat-1",
            isIncome: true,
            category: {
              id: "cat-1",
              name: "Salary",
              isIncome: true,
            } as any,
          }),
        ],
      });

      const alerts = await service.checkSeasonalSpikes(
        "11111111-1111-1111-1111-111111111111",
        budget,
      );

      expect(alerts).toHaveLength(0);
    });

    it("returns no alerts when insufficient data for analysis", async () => {
      const budget = makeBudget({
        categories: [
          makeCategory({
            id: "bc-1",
            categoryId: "cat-1",
            category: {
              id: "cat-1",
              name: "Groceries",
              isIncome: false,
            } as any,
          }),
        ],
      });

      // Only 2 months of data (below minimum of 3)
      const monthlyData = [
        { categoryId: "cat-1", month: 1, total: "200" },
        { categoryId: "cat-1", month: 2, total: "300" },
      ];

      const qb = {
        select: jest.fn().mockReturnThis(),
        addSelect: jest.fn().mockReturnThis(),
        where: jest.fn().mockReturnThis(),
        andWhere: jest.fn().mockReturnThis(),
        innerJoin: jest.fn().mockReturnThis(),
        groupBy: jest.fn().mockReturnThis(),
        addGroupBy: jest.fn().mockReturnThis(),
        getRawMany: jest.fn().mockResolvedValue(monthlyData),
      };

      transactionsRepository.createQueryBuilder.mockReturnValue(qb);
      splitsRepository.createQueryBuilder.mockReturnValue({
        ...qb,
        getRawMany: jest.fn().mockResolvedValue([]),
      });

      const alerts = await service.checkSeasonalSpikes(
        "11111111-1111-1111-1111-111111111111",
        budget,
      );

      expect(alerts).toHaveLength(0);
    });

    it("includes suggested budget amount in alert data", async () => {
      const nextMonth = new Date();
      nextMonth.setMonth(nextMonth.getMonth() + 1);
      const nextMonthNum = nextMonth.getMonth() + 1;

      const budget = makeBudget({
        categories: [
          makeCategory({
            id: "bc-1",
            categoryId: "cat-1",
            category: {
              id: "cat-1",
              name: "Gifts",
              isIncome: false,
            } as any,
            amount: 100,
          }),
        ],
      });

      const monthlyData: Array<{
        categoryId: string;
        month: number;
        total: string;
      }> = [];
      for (let m = 1; m <= 12; m++) {
        const amount = m === nextMonthNum ? "600" : "200";
        monthlyData.push({ categoryId: "cat-1", month: m, total: amount });
      }

      const qb = {
        select: jest.fn().mockReturnThis(),
        addSelect: jest.fn().mockReturnThis(),
        where: jest.fn().mockReturnThis(),
        andWhere: jest.fn().mockReturnThis(),
        innerJoin: jest.fn().mockReturnThis(),
        groupBy: jest.fn().mockReturnThis(),
        addGroupBy: jest.fn().mockReturnThis(),
        getRawMany: jest.fn().mockResolvedValue(monthlyData),
      };

      transactionsRepository.createQueryBuilder.mockReturnValue(qb);
      splitsRepository.createQueryBuilder.mockReturnValue({
        ...qb,
        getRawMany: jest.fn().mockResolvedValue([]),
      });

      const alerts = await service.checkSeasonalSpikes(
        "11111111-1111-1111-1111-111111111111",
        budget,
      );

      if (alerts.length > 0) {
        const alert = alerts[0];
        expect(alert.data.suggestedBudget).toBeDefined();
        expect(alert.data.typicalMonthlySpend).toBeDefined();
        expect(alert.data.categoryName).toBe("Gifts");
        expect(typeof alert.data.suggestedBudget).toBe("number");
        expect(alert.data.suggestedBudget).toBeGreaterThan(0);
      }
    });
  });

  describe("getCurrentPeriodDates", () => {
    it("returns first and last day of current month", () => {
      const { periodStart, periodEnd } = service.getCurrentPeriodDates();

      const today = new Date();
      const year = today.getFullYear();
      const month = String(today.getMonth() + 1).padStart(2, "0");

      expect(periodStart).toBe(`${year}-${month}-01`);
      expect(periodEnd).toMatch(new RegExp(`^${year}-${month}-\\d{2}$`));

      // Verify last day of month
      const lastDay = new Date(year, today.getMonth() + 1, 0).getDate();
      expect(periodEnd).toBe(
        `${year}-${month}-${String(lastDay).padStart(2, "0")}`,
      );
    });
  });
});
