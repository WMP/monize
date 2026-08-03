import { Test, TestingModule } from "@nestjs/testing";
import { gemConfigFingerprint } from "../strategies/gem-signal.service";
import { DataSource } from "typeorm";
import {
  UnauthorizedException,
  BadRequestException,
  NotFoundException,
} from "@nestjs/common";
import { gzipSync, gunzipSync } from "zlib";
import { PassThrough } from "stream";
import { randomUUID } from "crypto";
import * as fs from "fs";
import * as path from "path";
import { getRequestContext } from "../common/request-context";
import { OidcReauthService } from "../auth/oidc/oidc-reauth.service";
import { BackupService, RestoreBackupInput } from "./backup.service";
import { User } from "../users/entities/user.entity";
import { AiEncryptionService } from "../ai/ai-encryption.service";
import { encryptBackup } from "./backup-crypto.util";
import * as bcrypt from "bcryptjs";
import { createScopedDbMocks } from "../test-helpers/scoped-db-testing";

jest.mock("../common/db/scoped-db", () =>
  jest.requireActual("../test-helpers/scoped-db-testing").scopedDbMockModule(),
);

jest.mock("bcryptjs");

function compressBackupData(data: Record<string, unknown>): Buffer {
  return gzipSync(Buffer.from(JSON.stringify(data), "utf-8"));
}

// Parses an INSERT call captured by the query mock into a { column: value }
// map, pairing the column list in the SQL with the parameter array. Used to
// read back the (remapped) values the restore actually inserted.
function insertColumnMap(call: unknown[]): Record<string, unknown> {
  const sql = call[0] as string;
  const colMatch = sql.match(/\(([^)]*)\)\s*VALUES/i);
  if (!colMatch) return {};
  const columns = colMatch[1].split(",").map((c) => c.trim().replace(/"/g, ""));
  const values = (call[1] as unknown[]) ?? [];
  return Object.fromEntries(columns.map((col, i) => [col, values[i]]));
}

describe("BackupService", () => {
  let service: BackupService;
  let mockUserRepo: Record<string, jest.Mock>;
  let mockDataSource: Record<string, jest.Mock>;
  let mockQueryRunner: Record<string, jest.Mock>;

  const userId = "test-user-id";
  const mockUser = {
    id: userId,
    email: "test@example.com",
    authProvider: "local",
    passwordHash: "hashed-password",
  };

  // Known columns per table for schema validation mock. When insertRows()
  // queries information_schema.columns, the mock returns these so that
  // column-name validation does not strip legitimate backup data.
  const schemaColumns: Record<string, string[]> = {
    categories: [
      "id",
      "user_id",
      "name",
      "parent_id",
      "type",
      "icon",
      "color",
      "is_active",
      "sort_order",
      "created_at",
      "updated_at",
    ],
    accounts: [
      "id",
      "user_id",
      "name",
      "type",
      "currency_code",
      "current_balance",
      "opening_balance",
      "is_active",
      "institution",
      "institution_id",
      "account_number",
      "notes",
      "sort_order",
      "linked_account_id",
      "source_account_id",
      "scheduled_transaction_id",
      "principal_category_id",
      "interest_category_id",
      "asset_category_id",
      "interest_rate",
      "loan_amount",
      "original_term_months",
      "loan_start_date",
      "maturity_date",
      "payment_amount",
      "payment_frequency",
      "compounding_frequency",
      "amortization_months",
      "extra_payment",
      "asset_value",
      "asset_date",
      "depreciation_rate",
      "appreciation_rate",
      "created_at",
      "updated_at",
    ],
    payees: [
      "id",
      "user_id",
      "name",
      "default_category_id",
      "created_at",
      "updated_at",
    ],
    tags: ["id", "user_id", "name", "color", "created_at", "updated_at"],
    transactions: [
      "id",
      "user_id",
      "account_id",
      "amount",
      "transaction_date",
      "payee_id",
      "category_id",
      "memo",
      "is_reconciled",
      "check_number",
      "type",
      "linked_transaction_id",
      "parent_transaction_id",
      "is_split",
      "created_at",
      "updated_at",
    ],
    transaction_splits: [
      "id",
      "transaction_id",
      "amount",
      "category_id",
      "memo",
      "transfer_account_id",
      "created_at",
      "updated_at",
    ],
    transaction_tags: ["transaction_id", "tag_id"],
    transaction_split_tags: ["transaction_split_id", "tag_id"],
    securities: [
      "id",
      "user_id",
      "symbol",
      "name",
      "type",
      "exchange",
      "currency_code",
      "sector_weightings",
      "skip_price_updates",
      "data_source",
      "created_at",
      "updated_at",
    ],
    security_prices: ["id", "security_id", "date", "close_price", "created_at"],
    holdings: [
      "id",
      "user_id",
      "account_id",
      "security_id",
      "quantity",
      "cost_basis",
      "created_at",
      "updated_at",
    ],
    investment_transactions: [
      "id",
      "user_id",
      "account_id",
      "security_id",
      "type",
      "quantity",
      "price",
      "amount",
      "commission",
      "transaction_date",
      "memo",
      "created_at",
      "updated_at",
    ],
    user_preferences: [
      "id",
      "user_id",
      "key",
      "value",
      "created_at",
      "updated_at",
    ],
    user_currency_preferences: [
      "id",
      "user_id",
      "currency_code",
      "decimal_places",
      "created_at",
      "updated_at",
    ],
    scheduled_transactions: [
      "id",
      "user_id",
      "account_id",
      "amount",
      "payee_id",
      "category_id",
      "memo",
      "frequency",
      "start_date",
      "end_date",
      "next_due_date",
      "is_active",
      "type",
      "investment_security_id",
      "tag_ids",
      "created_at",
      "updated_at",
    ],
    scheduled_transaction_splits: [
      "id",
      "scheduled_transaction_id",
      "amount",
      "category_id",
      "memo",
      "transfer_account_id",
      "investment_security_id",
      "created_at",
      "updated_at",
    ],
    scheduled_transaction_overrides: [
      "id",
      "scheduled_transaction_id",
      "original_date",
      "new_date",
      "skip",
      "created_at",
      "updated_at",
    ],
    budgets: [
      "id",
      "user_id",
      "name",
      "period_type",
      "currency_code",
      "is_active",
      "created_at",
      "updated_at",
    ],
    budget_categories: [
      "id",
      "budget_id",
      "category_id",
      "amount",
      "created_at",
      "updated_at",
    ],
    budget_periods: [
      "id",
      "budget_id",
      "start_date",
      "end_date",
      "created_at",
      "updated_at",
    ],
    budget_period_categories: [
      "id",
      "budget_period_id",
      "category_id",
      "budgeted",
      "actual",
      "created_at",
      "updated_at",
    ],
    budget_alerts: [
      "id",
      "budget_id",
      "type",
      "threshold",
      "created_at",
      "updated_at",
    ],
    custom_reports: [
      "id",
      "user_id",
      "name",
      "config",
      "created_at",
      "updated_at",
    ],
    investment_reports: [
      "id",
      "user_id",
      "name",
      "description",
      "icon",
      "background_color",
      "group_by",
      "config",
      "is_favourite",
      "sort_order",
      "created_at",
      "updated_at",
    ],
    import_column_mappings: [
      "id",
      "user_id",
      "name",
      "mappings",
      "created_at",
      "updated_at",
    ],
    monthly_account_balances: [
      "id",
      "account_id",
      "year_month",
      "balance",
      "created_at",
      "updated_at",
    ],
    payee_aliases: [
      "id",
      "user_id",
      "payee_id",
      "alias",
      "created_at",
      "updated_at",
    ],
    institutions: [
      "id",
      "user_id",
      "name",
      "website",
      "country",
      "logo_data",
      "logo_content_type",
      "has_logo",
      "logo_fetched_at",
      "created_at",
      "updated_at",
    ],
    currencies: [
      "code",
      "name",
      "symbol",
      "decimal_places",
      "is_active",
      "created_by_user_id",
      "created_at",
      "updated_at",
    ],
    gem_strategies: [
      "id",
      "user_id",
      "name",
      "cadence",
      "lookback_months",
      "created_at",
      "updated_at",
    ],
    gem_strategy_assets: [
      "id",
      "user_id",
      "strategy_id",
      "role",
      "security_id",
      "created_at",
      "updated_at",
    ],
    gem_strategy_signals: [
      "id",
      "user_id",
      "strategy_id",
      "evaluated_on",
      "config_fingerprint",
      "algorithm_version",
      "created_at",
      "updated_at",
    ],
  };

  function mockQueryHandler(sql: string, params?: unknown[]) {
    if (typeof sql === "string" && sql.includes("information_schema.columns")) {
      // Extract table name from params (insertRows) or from the SQL itself (ensureCurrenciesExist)
      let tableName: string | undefined;
      if (Array.isArray(params) && params.length > 0) {
        tableName = params[0] as string;
      } else if (sql.includes("'currencies'")) {
        tableName = "currencies";
      }
      const cols =
        tableName && schemaColumns[tableName] ? schemaColumns[tableName] : [];
      return Promise.resolve(
        cols.map((col) => ({
          column_name: col,
          data_type: col === "logo_data" ? "bytea" : "text",
        })),
      );
    }
    return Promise.resolve([]);
  }

  // Signing key for the re-authentication artifacts below. The service reads it
  // fresh from the environment, so a spec that mints one has to supply it.
  const ORIGINAL_JWT_SECRET = process.env.JWT_SECRET;

  beforeAll(() => {
    process.env.JWT_SECRET = "spec-jwt-secret-of-at-least-32-characters";
  });

  afterAll(() => {
    if (ORIGINAL_JWT_SECRET === undefined) delete process.env.JWT_SECRET;
    else process.env.JWT_SECRET = ORIGINAL_JWT_SECRET;
  });

  /**
   * A genuine artifact for the restore action, minted the way the OIDC callback
   * does. Deliberately not a literal: the defect P2-005 fixed was that any
   * non-empty string was accepted, so a fixture string would keep this spec green
   * if the verification were removed again.
   */
  function oidcArtifact(
    purpose: Parameters<OidcReauthService["issue"]>[1] = "restore-backup",
    forUser = userId,
  ): string {
    return new OidcReauthService().issue(forUser, purpose);
  }

  beforeEach(async () => {
    mockUserRepo = {
      findOne: jest.fn(),
    };

    // Export reads and the restore transaction now both run through
    // `withScopedDb`, so the former QueryRunner is the transaction's
    // EntityManager -- `mockQueryRunner.query` and `mockDataSource.query` are
    // the same jest.fn the manager exposes, keeping the assertions below
    // pointed at the same statements.
    const scoped = createScopedDbMocks([[User, mockUserRepo as never]]);
    scoped.manager.query.mockImplementation(mockQueryHandler);
    scoped.dataSource.query = scoped.manager.query;
    mockQueryRunner = { query: scoped.manager.query };
    mockDataSource = scoped.dataSource as unknown as Record<string, jest.Mock>;

    const module: TestingModule = await Test.createTestingModule({
      providers: [
        BackupService,
        {
          provide: DataSource,
          useValue: mockDataSource,
        },
        // Real instance, not a double: its whole job is cryptographic
        // verification, and a mock that always accepts would make every
        // re-authentication assertion vacuous -- which is how the sentinel
        // survived (P2-005).
        OidcReauthService,
        {
          provide: AiEncryptionService,
          useValue: {
            isConfigured: jest.fn().mockReturnValue(true),
            encrypt: jest.fn((s: string) => `enc:${s}`),
            decrypt: jest.fn((s: string) =>
              s.startsWith("enc:") ? s.slice(4) : s,
            ),
          },
        },
      ],
    }).compile();

    service = module.get<BackupService>(BackupService);
  });

  describe("streamExport", () => {
    async function collectGzipOutput(
      mockRes: PassThrough,
    ): Promise<Record<string, unknown>> {
      const chunks: Buffer[] = [];
      for await (const chunk of mockRes) {
        chunks.push(Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk));
      }
      const compressed = Buffer.concat(chunks);
      const json = gunzipSync(compressed).toString("utf-8");
      return JSON.parse(json);
    }

    it("should stream gzip-compressed JSON to the response", async () => {
      const mockCategories = [{ id: "cat-1", name: "Food", user_id: userId }];
      const mockAccounts = [{ id: "acc-1", name: "Checking", user_id: userId }];

      mockDataSource.query.mockImplementation((sql: string) => {
        if (sql.includes("categories")) return Promise.resolve(mockCategories);
        if (sql.includes("accounts") && !sql.includes("monthly_account")) {
          return Promise.resolve(mockAccounts);
        }
        return Promise.resolve([]);
      });

      const mockRes = new PassThrough();
      const resultPromise = collectGzipOutput(mockRes);
      await service.streamExport(userId, mockRes as any);
      const result = await resultPromise;

      expect(result.version).toBe(1);
      expect(result.exportedAt).toBeDefined();
      expect(result.categories).toEqual(mockCategories);
      expect(result.accounts).toEqual(mockAccounts);
      expect(mockDataSource.query).toHaveBeenCalled();
    });

    it("should stream empty arrays when user has no data", async () => {
      mockDataSource.query.mockResolvedValue([]);

      const mockRes = new PassThrough();
      const resultPromise = collectGzipOutput(mockRes);
      await service.streamExport(userId, mockRes as any);
      const result = await resultPromise;

      expect(result.version).toBe(1);
      expect(result.categories).toEqual([]);
      expect(result.transactions).toEqual([]);
      expect(result.accounts).toEqual([]);
    });

    it("should include investment_reports in the exported payload", async () => {
      const mockInvestmentReports = [
        { id: "ir-1", name: "By Symbol", user_id: userId },
      ];
      mockDataSource.query.mockImplementation((sql: string) => {
        if (sql.includes("investment_reports")) {
          return Promise.resolve(mockInvestmentReports);
        }
        return Promise.resolve([]);
      });

      const mockRes = new PassThrough();
      const resultPromise = collectGzipOutput(mockRes);
      await service.streamExport(userId, mockRes as any);
      const result = await resultPromise;

      expect(result.investment_reports).toEqual(mockInvestmentReports);
    });

    it("reads every table inside one REPEATABLE READ transaction", async () => {
      // The regression: each table used to be read in its own autocommit
      // transaction, so a concurrent write could land between two reads and the
      // file could hold a split whose parent transaction is missing. The
      // restore inserts with ON CONFLICT DO NOTHING, so that orphan is dropped
      // silently rather than failing -- a backup that is quietly incomplete.
      mockDataSource.query.mockResolvedValue([]);

      const mockRes = new PassThrough();
      const resultPromise = collectGzipOutput(mockRes);
      await service.streamExport(userId, mockRes as any);
      await resultPromise;

      const isolations = mockDataSource.transaction.mock.calls
        .map((call) => call[0])
        .filter((arg) => typeof arg === "string");
      expect(isolations).toEqual(["REPEATABLE READ"]);
      // One transaction for the whole export, not one per table.
      expect(mockDataSource.transaction).toHaveBeenCalledTimes(1);
    });

    it("bounds how long the snapshot may sit idle waiting on the client", async () => {
      // The cost of holding one snapshot across a streamed download is that a
      // client which stops draining keeps a REPEATABLE READ transaction open,
      // and that blocks vacuum database-wide. The timeout turns that into a
      // failed download instead.
      mockDataSource.query.mockResolvedValue([]);

      const mockRes = new PassThrough();
      const resultPromise = collectGzipOutput(mockRes);
      await service.streamExport(userId, mockRes as any);
      await resultPromise;

      const idleGuard = mockDataSource.query.mock.calls.find((call) =>
        String(call[0]).includes("idle_in_transaction_session_timeout"),
      );
      expect(idleGuard).toBeDefined();
      // Transaction-local (`set_config(..., true)`), so it cannot leak onto the
      // pooled connection and shorten an unrelated request's allowance.
      expect(idleGuard![1]).toEqual([expect.any(String)]);
      expect(String(idleGuard![0])).toContain("true");
    });

    it("writes an encrypted envelope when a password is provided", async () => {
      mockDataSource.query.mockResolvedValue([]);
      const mockCategories = [{ id: "cat-1", name: "Food", user_id: userId }];
      mockDataSource.query.mockImplementation((sql: string) => {
        if (sql.includes("categories")) return Promise.resolve(mockCategories);
        return Promise.resolve([]);
      });

      const chunks: Buffer[] = [];
      const mockRes = {
        write: jest.fn((c: Buffer) => chunks.push(c)),
        end: jest.fn(),
      };
      await service.streamExport(userId, mockRes as any, "secret");

      const written = Buffer.concat(chunks);
      // Magic header check -- the file starts with MZBE
      expect(written.subarray(0, 4).toString("ascii")).toBe("MZBE");
      expect(mockRes.end).toHaveBeenCalled();
    });
  });

  describe("exportToBuffer", () => {
    it("returns gzipped JSON for unencrypted exports", async () => {
      mockDataSource.query.mockResolvedValue([]);
      const buf = await service.exportToBuffer(userId);
      // gzip magic 1f 8b
      expect(buf[0]).toBe(0x1f);
      expect(buf[1]).toBe(0x8b);
    });

    it("returns an encrypted envelope when a password is provided", async () => {
      mockDataSource.query.mockResolvedValue([]);
      const buf = await service.exportToBuffer(userId, "pw");
      expect(buf.subarray(0, 4).toString("ascii")).toBe("MZBE");
    });
  });

  describe("resolveStoredBackupPassword", () => {
    it("returns null when encryption is disabled", () => {
      const user = { ...mockUser, backupEncryptionEnabled: false } as any;
      expect(service.resolveStoredBackupPassword(user)).toBeNull();
    });

    it("returns null when no stored password exists", () => {
      const user = {
        ...mockUser,
        backupEncryptionEnabled: true,
        backupPasswordEnc: null,
      } as any;
      expect(service.resolveStoredBackupPassword(user)).toBeNull();
    });

    it("decrypts the stored password via AiEncryptionService", () => {
      const user = {
        ...mockUser,
        backupEncryptionEnabled: true,
        backupPasswordEnc: "enc:my-password",
      } as any;
      expect(service.resolveStoredBackupPassword(user)).toBe("my-password");
    });

    it("returns null and logs when decryption throws (e.g. master key rotated)", () => {
      // The mock decrypt throws when called -- this also exercises the catch
      // block that maps a thrown error to a null return value.
      const failingService = service as unknown as {
        aiEncryption: { decrypt: jest.Mock };
      };
      failingService.aiEncryption.decrypt = jest.fn(() => {
        throw new Error("bad ciphertext");
      });
      const user = {
        ...mockUser,
        id: "rotated-user",
        backupEncryptionEnabled: true,
        backupPasswordEnc: "enc:rotated",
      } as any;
      expect(service.resolveStoredBackupPassword(user)).toBeNull();
    });
  });

  describe("restoreData", () => {
    const validBackupData = {
      version: 1,
      exportedAt: "2026-01-01T00:00:00.000Z",
      currencies: [],
      user_preferences: [],
      user_currency_preferences: [],
      categories: [],
      payees: [],
      payee_aliases: [],
      institutions: [],
      accounts: [],
      tags: [],
      transactions: [],
      transaction_splits: [],
      transaction_tags: [],
      transaction_split_tags: [],
      scheduled_transactions: [],
      scheduled_transaction_splits: [],
      scheduled_transaction_overrides: [],
      securities: [],
      security_prices: [],
      holdings: [],
      investment_transactions: [],
      budgets: [],
      budget_categories: [],
      budget_periods: [],
      budget_period_categories: [],
      budget_alerts: [],
      custom_reports: [],
      investment_reports: [],
      import_column_mappings: [],
      monthly_account_balances: [],
    };

    function makeInput(
      overrides: Partial<RestoreBackupInput> & {
        data?: Record<string, unknown>;
      } = {},
    ): RestoreBackupInput {
      const { data, ...rest } = overrides;
      return {
        compressedData: compressBackupData(data ?? validBackupData),
        ...rest,
      };
    }

    it("should throw NotFoundException if user not found", async () => {
      mockUserRepo.findOne.mockResolvedValue(null);

      await expect(
        service.restoreData(userId, makeInput({ password: "test" })),
      ).rejects.toThrow(NotFoundException);
    });

    it("should throw UnauthorizedException if password is missing for local user", async () => {
      mockUserRepo.findOne.mockResolvedValue(mockUser);

      await expect(service.restoreData(userId, makeInput())).rejects.toThrow(
        UnauthorizedException,
      );
    });

    it("should throw UnauthorizedException if password is invalid", async () => {
      mockUserRepo.findOne.mockResolvedValue(mockUser);
      (bcrypt.compare as jest.Mock).mockResolvedValue(false);

      await expect(
        service.restoreData(userId, makeInput({ password: "wrong-password" })),
      ).rejects.toThrow(UnauthorizedException);
    });

    it("should throw UnauthorizedException if OIDC token is missing for OIDC user", async () => {
      mockUserRepo.findOne.mockResolvedValue({
        ...mockUser,
        authProvider: "oidc",
        passwordHash: null,
      });

      await expect(service.restoreData(userId, makeInput())).rejects.toThrow(
        UnauthorizedException,
      );
    });

    it("should throw BadRequestException for invalid backup version", async () => {
      mockUserRepo.findOne.mockResolvedValue(mockUser);
      (bcrypt.compare as jest.Mock).mockResolvedValue(true);

      await expect(
        service.restoreData(
          userId,
          makeInput({
            password: "test",
            data: { ...validBackupData, version: 999 },
          }),
        ),
      ).rejects.toThrow(BadRequestException);
    });

    it("should throw BadRequestException for missing exportedAt", async () => {
      mockUserRepo.findOne.mockResolvedValue(mockUser);
      (bcrypt.compare as jest.Mock).mockResolvedValue(true);

      const badData = { ...validBackupData, exportedAt: undefined };
      await expect(
        service.restoreData(
          userId,
          makeInput({
            password: "test",
            data: badData as any,
          }),
        ),
      ).rejects.toThrow(BadRequestException);
    });

    it("should throw BadRequestException for invalid gzip data", async () => {
      mockUserRepo.findOne.mockResolvedValue(mockUser);
      (bcrypt.compare as jest.Mock).mockResolvedValue(true);

      await expect(
        service.restoreData(userId, {
          compressedData: Buffer.from("not-gzip-data"),
          password: "test",
        }),
      ).rejects.toThrow(BadRequestException);
    });

    it("should throw BadRequestException for gzip of non-JSON content", async () => {
      mockUserRepo.findOne.mockResolvedValue(mockUser);
      (bcrypt.compare as jest.Mock).mockResolvedValue(true);

      await expect(
        service.restoreData(userId, {
          compressedData: gzipSync(Buffer.from("not json")),
          password: "test",
        }),
      ).rejects.toThrow(BadRequestException);
    });

    it("should successfully restore backup data within a transaction", async () => {
      mockUserRepo.findOne.mockResolvedValue(mockUser);
      (bcrypt.compare as jest.Mock).mockResolvedValue(true);

      const backupWithData = {
        ...validBackupData,
        categories: [
          { id: "cat-1", user_id: userId, name: "Food", parent_id: null },
        ],
        accounts: [
          {
            id: "acc-1",
            user_id: userId,
            name: "Checking",
            account_type: "CHEQUING",
          },
        ],
      };

      const result = await service.restoreData(
        userId,
        makeInput({
          password: "test",
          data: backupWithData,
        }),
      );

      expect(result.message).toBe("Backup restored successfully");
      expect(result.restored.categories).toBe(1);
      expect(result.restored.accounts).toBe(1);
      expect(mockDataSource.transaction).toHaveBeenCalled();
      expect(mockDataSource.transaction).toHaveBeenCalled();
      expect(mockDataSource.transaction).toHaveBeenCalled();
      expect(mockDataSource.transaction).toHaveBeenCalled();
    });

    it("should restore investment_reports rows and scope them to the current user", async () => {
      mockUserRepo.findOne.mockResolvedValue(mockUser);
      (bcrypt.compare as jest.Mock).mockResolvedValue(true);

      const backupWithInvestmentReports = {
        ...validBackupData,
        investment_reports: [
          {
            id: "ir-1",
            user_id: "different-user-id",
            name: "By Symbol",
            description: null,
            icon: null,
            background_color: null,
            group_by: "SYMBOL",
            config: { columns: ["symbol"], accountIds: [] },
            is_favourite: false,
            sort_order: 0,
          },
        ],
      };

      const result = await service.restoreData(
        userId,
        makeInput({ password: "test", data: backupWithInvestmentReports }),
      );

      expect(result.restored.investmentReports).toBe(1);

      const insertCalls = mockQueryRunner.query.mock.calls.filter(
        (call: unknown[]) =>
          typeof call[0] === "string" &&
          call[0].includes('INSERT INTO "investment_reports"'),
      );
      expect(insertCalls).toHaveLength(1);
      const inserted = insertColumnMap(insertCalls[0]);
      expect(inserted.user_id).toBe(userId);
      expect(inserted.name).toBe("By Symbol");
      expect(inserted.group_by).toBe("SYMBOL");
    });

    it("should delete existing investment_reports during restore wipe", async () => {
      mockUserRepo.findOne.mockResolvedValue(mockUser);
      (bcrypt.compare as jest.Mock).mockResolvedValue(true);

      await service.restoreData(userId, makeInput({ password: "test" }));

      const deleteCalls = mockQueryRunner.query.mock.calls.filter(
        (call: unknown[]) =>
          typeof call[0] === "string" &&
          call[0].includes("DELETE FROM investment_reports"),
      );
      expect(deleteCalls).toHaveLength(1);
      expect(deleteCalls[0][1]).toEqual([userId]);
    });

    it("should delete existing action_history during restore wipe", async () => {
      mockUserRepo.findOne.mockResolvedValue(mockUser);
      (bcrypt.compare as jest.Mock).mockResolvedValue(true);

      await service.restoreData(userId, makeInput({ password: "test" }));

      const deleteCalls = mockQueryRunner.query.mock.calls.filter(
        (call: unknown[]) =>
          typeof call[0] === "string" &&
          call[0].includes("DELETE FROM action_history"),
      );
      expect(deleteCalls).toHaveLength(1);
      expect(deleteCalls[0][1]).toEqual([userId]);
    });

    // Regression: the wipe used to guard the user-created-currency delete with
    // only user_currency_preferences and accounts. `currencies.code` is
    // referenced by nine columns across eight tables, and the one that actually
    // bit was `exchange_rates` -- global, never cleared by a restore, and
    // populated for every currency the FX backfill has seen. Any user who added
    // a custom currency and let the daily rate refresh run got
    // "violates foreign key constraint exchange_rates_to_currency_fkey" and
    // could not restore at all.
    it("guards the user-created-currency delete against every FK to currencies", async () => {
      mockUserRepo.findOne.mockResolvedValue(mockUser);
      (bcrypt.compare as jest.Mock).mockResolvedValue(true);

      await service.restoreData(userId, makeInput({ password: "test" }));

      const [sql] = mockQueryRunner.query.mock.calls.find(
        (call: unknown[]) =>
          typeof call[0] === "string" &&
          call[0].includes("DELETE FROM currencies"),
      ) as [string];

      for (const referrer of [
        "exchange_rates",
        "user_currency_preferences",
        "accounts",
        "transactions",
        "securities",
        "scheduled_transactions",
        "budgets",
        "user_preferences",
      ]) {
        expect(sql).toContain(referrer);
      }
      // transactions references currencies twice (paid-in currency included).
      expect(sql).toContain("original_currency_code");
    });

    it("should rollback transaction on error", async () => {
      mockUserRepo.findOne.mockResolvedValue(mockUser);
      (bcrypt.compare as jest.Mock).mockResolvedValue(true);
      mockQueryRunner.query.mockRejectedValueOnce(new Error("DB error"));

      await expect(
        service.restoreData(userId, makeInput({ password: "test" })),
      ).rejects.toThrow("DB error");

      expect(mockDataSource.transaction).toHaveBeenCalled();
      expect(mockDataSource.transaction).toHaveBeenCalled();
    });

    it("should override user_id in restored data to match current user", async () => {
      mockUserRepo.findOne.mockResolvedValue(mockUser);
      (bcrypt.compare as jest.Mock).mockResolvedValue(true);

      const backupWithDifferentUser = {
        ...validBackupData,
        categories: [
          { id: "cat-1", user_id: "different-user-id", name: "Food" },
        ],
      };

      await service.restoreData(
        userId,
        makeInput({
          password: "test",
          data: backupWithDifferentUser,
        }),
      );

      // Verify the INSERT query was called with the current user's ID
      const insertCalls = mockQueryRunner.query.mock.calls.filter(
        (call: unknown[]) =>
          typeof call[0] === "string" && call[0].includes("INSERT INTO"),
      );
      const categoryInsert = insertCalls.find(
        (call: unknown[]) =>
          typeof call[0] === "string" && call[0].includes("categories"),
      );
      if (categoryInsert) {
        expect(categoryInsert[1]).toContain(userId);
      }
    });

    it("clears scheduled-transaction references to securities before deleting securities", async () => {
      mockUserRepo.findOne.mockResolvedValue(mockUser);
      (bcrypt.compare as jest.Mock).mockResolvedValue(true);

      await service.restoreData(userId, makeInput({ password: "test" }));

      const sql = mockQueryRunner.query.mock.calls.map(
        (c: unknown[]) => c[0] as string,
      );
      const splitsFkCleared = sql.findIndex(
        (q) =>
          typeof q === "string" &&
          q.includes("UPDATE scheduled_transaction_splits") &&
          q.includes("investment_security_id = NULL"),
      );
      const schedFkCleared = sql.findIndex(
        (q) =>
          typeof q === "string" &&
          q.includes(
            "UPDATE scheduled_transactions SET investment_security_id = NULL",
          ),
      );
      const securitiesDeleted = sql.findIndex(
        (q) => typeof q === "string" && q.includes("DELETE FROM securities"),
      );

      expect(splitsFkCleared).toBeGreaterThan(-1);
      expect(schedFkCleared).toBeGreaterThan(-1);
      expect(securitiesDeleted).toBeGreaterThan(-1);
      expect(splitsFkCleared).toBeLessThan(securitiesDeleted);
      expect(schedFkCleared).toBeLessThan(securitiesDeleted);
    });

    it("defers scheduled-split investment_security_id until after securities insert", async () => {
      mockUserRepo.findOne.mockResolvedValue(mockUser);
      (bcrypt.compare as jest.Mock).mockResolvedValue(true);

      const securityId = randomUUID();
      const schedId = randomUUID();
      const splitId = randomUUID();
      const accountId = randomUUID();
      const backupWithInvSplit = {
        ...validBackupData,
        securities: [
          { id: securityId, user_id: userId, symbol: "VEA", name: "Vanguard" },
        ],
        scheduled_transactions: [
          {
            id: schedId,
            user_id: userId,
            account_id: accountId,
            investment_security_id: securityId,
          },
        ],
        scheduled_transaction_splits: [
          {
            id: splitId,
            scheduled_transaction_id: schedId,
            amount: -5,
            investment_security_id: securityId,
          },
        ],
      };

      await service.restoreData(
        userId,
        makeInput({ password: "test", data: backupWithInvSplit }),
      );

      const insertCalls = mockQueryRunner.query.mock.calls.filter(
        (c: unknown[]) =>
          typeof c[0] === "string" && c[0].includes("INSERT INTO"),
      );
      const splitInsert = insertCalls.find(
        (c: unknown[]) =>
          typeof c[0] === "string" &&
          c[0].includes('"scheduled_transaction_splits"'),
      );
      expect(splitInsert).toBeDefined();
      // The forward FK to securities(id) must be stripped from the INSERT.
      expect(splitInsert![0]).not.toContain("investment_security_id");

      // Primary keys are remapped to fresh UUIDs on restore, so read back the
      // ids the inserts actually used to verify the deferred UPDATE keeps the
      // security -> split relationship intact.
      const securityInsert = insertCalls.find(
        (c: unknown[]) =>
          typeof c[0] === "string" && c[0].includes('"securities"'),
      );
      const newSecurityId = insertColumnMap(securityInsert!).id;
      const newSplitId = insertColumnMap(splitInsert!).id;
      expect(newSecurityId).not.toBe(securityId);
      expect(newSplitId).not.toBe(splitId);

      // ...and restored via a Phase-3 UPDATE keyed by the (remapped) split id.
      const update = mockQueryRunner.query.mock.calls.find(
        (c: unknown[]) =>
          typeof c[0] === "string" &&
          c[0].includes('UPDATE "scheduled_transaction_splits"') &&
          c[0].includes('"investment_security_id"'),
      );
      expect(update).toBeDefined();
      expect(update![1]).toEqual([newSecurityId, newSplitId]);
    });

    it("should defer circular FK columns and update them after all inserts", async () => {
      mockUserRepo.findOne.mockResolvedValue(mockUser);
      (bcrypt.compare as jest.Mock).mockResolvedValue(true);

      const catParentId = randomUUID();
      const catChildId = randomUUID();
      const acc1Id = randomUUID();
      const acc2Id = randomUUID();
      const schedId = randomUUID();
      const txn1Id = randomUUID();
      const txn2Id = randomUUID();
      const backupWithFks = {
        ...validBackupData,
        categories: [
          {
            id: catParentId,
            user_id: userId,
            name: "Parent",
            parent_id: null,
          },
          {
            id: catChildId,
            user_id: userId,
            name: "Child",
            parent_id: catParentId,
          },
        ],
        accounts: [
          {
            id: acc1Id,
            user_id: userId,
            name: "Checking",
            linked_account_id: acc2Id,
            scheduled_transaction_id: schedId,
          },
          {
            id: acc2Id,
            user_id: userId,
            name: "Savings",
            linked_account_id: acc1Id,
          },
        ],
        scheduled_transactions: [
          { id: schedId, user_id: userId, account_id: acc1Id },
        ],
        transactions: [
          {
            id: txn1Id,
            user_id: userId,
            account_id: acc1Id,
            linked_transaction_id: txn2Id,
          },
          {
            id: txn2Id,
            user_id: userId,
            account_id: acc2Id,
            linked_transaction_id: txn1Id,
          },
        ],
      };

      await service.restoreData(
        userId,
        makeInput({ password: "test", data: backupWithFks }),
      );

      // Verify INSERTs do NOT contain deferred FK columns
      const insertCalls = mockQueryRunner.query.mock.calls.filter(
        (call: unknown[]) =>
          typeof call[0] === "string" && call[0].includes("INSERT INTO"),
      );
      const categoryInserts = insertCalls.filter(
        (call: unknown[]) =>
          typeof call[0] === "string" && call[0].includes('"categories"'),
      );
      for (const call of categoryInserts) {
        expect(call[0]).not.toContain("parent_id");
      }

      // Verify UPDATEs restore the deferred FK columns
      const updateCalls = mockQueryRunner.query.mock.calls.filter(
        (call: unknown[]) =>
          typeof call[0] === "string" && call[0].includes("UPDATE"),
      );
      const parentIdUpdate = updateCalls.find(
        (call: unknown[]) =>
          typeof call[0] === "string" &&
          call[0].includes('"categories"') &&
          call[0].includes('"parent_id"'),
      );
      expect(parentIdUpdate).toBeDefined();
      // Ids are remapped to fresh UUIDs, so the deferred parent_id UPDATE must
      // key off the remapped ids the inserts used -- never the backup ids.
      const catRows = categoryInserts.map(insertColumnMap);
      const parent = catRows.find((r) => r.name === "Parent");
      const child = catRows.find((r) => r.name === "Child");
      expect(parent!.id).not.toBe(catParentId);
      expect(child!.id).not.toBe(catChildId);
      expect(parentIdUpdate![1]).toEqual([parent!.id, child!.id]);

      const linkedAccountUpdate = updateCalls.find(
        (call: unknown[]) =>
          typeof call[0] === "string" &&
          call[0].includes('"accounts"') &&
          call[0].includes('"linked_account_id"'),
      );
      expect(linkedAccountUpdate).toBeDefined();
    });

    it("restores institutions before accounts and defers institution_id", async () => {
      mockUserRepo.findOne.mockResolvedValue(mockUser);
      (bcrypt.compare as jest.Mock).mockResolvedValue(true);

      const institutionId = randomUUID();
      const accountId = randomUUID();
      const backup = {
        ...validBackupData,
        institutions: [
          {
            id: institutionId,
            user_id: userId,
            name: "TD Canada Trust",
            website: "https://www.td.com",
            country: "CA",
            logo_data: null,
            has_logo: false,
          },
        ],
        accounts: [
          {
            id: accountId,
            user_id: userId,
            name: "Checking",
            institution_id: institutionId,
          },
        ],
      };

      await service.restoreData(
        userId,
        makeInput({ password: "test", data: backup }),
      );

      const insertCalls = mockQueryRunner.query.mock.calls.filter(
        (c: unknown[]) =>
          typeof c[0] === "string" && c[0].includes("INSERT INTO"),
      );

      // Institutions must be inserted before the accounts that reference them.
      const instIdx = insertCalls.findIndex((c: unknown[]) =>
        (c[0] as string).includes('"institutions"'),
      );
      const acctIdx = insertCalls.findIndex((c: unknown[]) =>
        (c[0] as string).includes('"accounts"'),
      );
      expect(instIdx).toBeGreaterThanOrEqual(0);
      expect(acctIdx).toBeGreaterThan(instIdx);

      // institution_id is a deferred FK column, stripped from the account INSERT.
      const accountInsert = insertCalls[acctIdx];
      expect(accountInsert[0]).not.toContain("institution_id");

      // ...and re-applied in Phase 3 via a guarded UPDATE keyed on remapped ids.
      const instRow = insertColumnMap(insertCalls[instIdx]);
      const acctRow = insertColumnMap(accountInsert);
      expect(instRow.id).not.toBe(institutionId);
      expect(acctRow.id).not.toBe(accountId);

      const institutionUpdate = mockQueryRunner.query.mock.calls.find(
        (c: unknown[]) =>
          typeof c[0] === "string" &&
          c[0].includes('UPDATE "accounts"') &&
          c[0].includes('"institution_id"'),
      );
      expect(institutionUpdate).toBeDefined();
      // The guard only sets the FK when the referenced institution exists.
      expect(institutionUpdate![0]).toContain(
        'EXISTS (SELECT 1 FROM "institutions"',
      );
      expect(institutionUpdate![1]).toEqual([instRow.id, acctRow.id]);
    });

    it("restores a legacy backup whose accounts reference institutions not in the backup", async () => {
      // Backups taken before institutions were added to the export still carry
      // accounts.institution_id. With no matching institution row, a naive
      // restore violates fk_accounts_institution. The deferral + EXISTS guard
      // must drop the dangling reference instead of failing the restore.
      mockUserRepo.findOne.mockResolvedValue(mockUser);
      (bcrypt.compare as jest.Mock).mockResolvedValue(true);

      const accountId = randomUUID();
      const danglingInstitutionId = randomUUID();
      const legacyBackup = {
        ...validBackupData,
        // No institutions key at all (legacy shape).
        institutions: undefined,
        accounts: [
          {
            id: accountId,
            user_id: userId,
            name: "Checking",
            institution_id: danglingInstitutionId,
          },
        ],
      };

      await expect(
        service.restoreData(
          userId,
          makeInput({ password: "test", data: legacyBackup as any }),
        ),
      ).resolves.toBeDefined();

      const accountInsert = mockQueryRunner.query.mock.calls.find(
        (c: unknown[]) =>
          typeof c[0] === "string" &&
          c[0].includes("INSERT INTO") &&
          c[0].includes('"accounts"'),
      );
      // institution_id must not be inserted directly.
      expect(accountInsert![0]).not.toContain("institution_id");

      // The Phase-3 UPDATE is still guarded; with no institution it sets nothing.
      const institutionUpdate = mockQueryRunner.query.mock.calls.find(
        (c: unknown[]) =>
          typeof c[0] === "string" &&
          c[0].includes('UPDATE "accounts"') &&
          c[0].includes('"institution_id"'),
      );
      expect(institutionUpdate).toBeDefined();
      expect(institutionUpdate![0]).toContain(
        'EXISTS (SELECT 1 FROM "institutions"',
      );
      // The dangling original id is never reused (no remap target existed).
      expect(institutionUpdate![1]).toEqual([
        danglingInstitutionId,
        insertColumnMap(accountInsert!).id,
      ]);
    });

    it("base64-decodes institution logo_data (bytea) on restore", async () => {
      mockUserRepo.findOne.mockResolvedValue(mockUser);
      (bcrypt.compare as jest.Mock).mockResolvedValue(true);

      const institutionId = randomUUID();
      const logoBase64 = Buffer.from("fake-png-bytes").toString("base64");
      const backup = {
        ...validBackupData,
        institutions: [
          {
            id: institutionId,
            user_id: userId,
            name: "RBC",
            website: "https://www.rbc.com",
            logo_data: logoBase64,
            logo_content_type: "image/png",
            has_logo: true,
          },
        ],
      };

      await service.restoreData(
        userId,
        makeInput({ password: "test", data: backup }),
      );

      const institutionInsert = mockQueryRunner.query.mock.calls.find(
        (c: unknown[]) =>
          typeof c[0] === "string" &&
          c[0].includes("INSERT INTO") &&
          c[0].includes('"institutions"'),
      );
      expect(institutionInsert).toBeDefined();
      // The bytea placeholder is wrapped in decode(..., 'base64').
      expect(institutionInsert![0]).toContain("decode(");
      expect(institutionInsert![0]).toContain("'base64'");
      // The base64 string is passed through unchanged as the bound parameter.
      expect(institutionInsert![1]).toContain(logoBase64);
    });

    it("exports institutions with base64-encoded logo_data", async () => {
      const mockInstitutions = [
        { id: "inst-1", name: "TD", user_id: userId, logo_data: "YWJj" },
      ];
      const issuedSql: string[] = [];
      mockDataSource.query.mockImplementation((sql: string) => {
        issuedSql.push(sql);
        if (sql.includes("FROM institutions")) {
          return Promise.resolve(mockInstitutions);
        }
        return Promise.resolve([]);
      });

      const buf = await service.exportToBuffer(userId);
      const json = JSON.parse(gunzipSync(buf).toString("utf-8"));

      expect(json.institutions).toEqual(mockInstitutions);
      expect(
        issuedSql.some((s) => s.includes("encode(logo_data, 'base64')")),
      ).toBe(true);
    });

    it("deletes existing institutions during restore wipe", async () => {
      mockUserRepo.findOne.mockResolvedValue(mockUser);
      (bcrypt.compare as jest.Mock).mockResolvedValue(true);

      await service.restoreData(userId, makeInput({ password: "test" }));

      const deletedInstitutions = mockQueryRunner.query.mock.calls.some(
        (c: unknown[]) =>
          typeof c[0] === "string" && c[0].includes("DELETE FROM institutions"),
      );
      expect(deletedInstitutions).toBe(true);
    });

    it("remaps backup primary keys so a restore never reuses another user's row ids", async () => {
      // Reproduces the multi-user restore bug: UserB restoring UserA's backup
      // must NOT write using UserA's original row ids (which would collide with
      // or mutate UserA's existing rows). Every id must be remapped to a fresh
      // UUID, and all references -- FK columns and ids nested in JSONB -- must
      // be rewritten to match.
      mockUserRepo.findOne.mockResolvedValue(mockUser);
      (bcrypt.compare as jest.Mock).mockResolvedValue(true);

      const tagId = randomUUID();
      const catId = randomUUID();
      const acctId = randomUUID();
      const txnId = randomUUID();
      const schedId = randomUUID();
      const backup = {
        ...validBackupData,
        tags: [{ id: tagId, user_id: "other-user", name: "Bills" }],
        categories: [
          { id: catId, user_id: "other-user", name: "Food", parent_id: null },
        ],
        accounts: [{ id: acctId, user_id: "other-user", name: "Checking" }],
        transactions: [
          {
            id: txnId,
            user_id: "other-user",
            account_id: acctId,
            category_id: catId,
          },
        ],
        transaction_tags: [{ transaction_id: txnId, tag_id: tagId }],
        scheduled_transactions: [
          {
            id: schedId,
            user_id: "other-user",
            account_id: acctId,
            tag_ids: [tagId],
          },
        ],
      };

      await service.restoreData(
        userId,
        makeInput({ password: "test", data: backup }),
      );

      const backupIds = [catId, acctId, txnId, tagId, schedId];
      const writeCalls = mockQueryRunner.query.mock.calls.filter(
        (c: unknown[]) =>
          typeof c[0] === "string" &&
          (c[0].includes("INSERT INTO") || c[0].startsWith('UPDATE "')),
      );

      // No INSERT/UPDATE may reference any original backup id, even nested in a
      // serialised JSONB value.
      for (const call of writeCalls) {
        const params = (call[1] as unknown[]) ?? [];
        const flat = params.flatMap((p) => (Array.isArray(p) ? p : [p]));
        for (const id of backupIds) {
          expect(flat).not.toContain(id);
        }
        for (const p of params) {
          if (typeof p === "string") {
            for (const id of backupIds) {
              expect(p.includes(id)).toBe(false);
            }
          }
        }
      }

      // References stay internally consistent across the remap.
      const inserts = writeCalls.filter((c: unknown[]) =>
        (c[0] as string).includes("INSERT INTO"),
      );
      const findInsert = (table: string) =>
        insertColumnMap(
          inserts.find((c: unknown[]) =>
            (c[0] as string).includes(`"${table}"`),
          )!,
        );

      const acctRow = findInsert("accounts");
      const txnRow = findInsert("transactions");
      expect(acctRow.id).not.toBe(acctId);
      expect(txnRow.account_id).toBe(acctRow.id);

      const tagRow = findInsert("tags");
      const txnTagRow = findInsert("transaction_tags");
      expect(txnTagRow.tag_id).toBe(tagRow.id);
      expect(txnTagRow.transaction_id).toBe(txnRow.id);

      // The id nested in the scheduled transaction's JSONB tag_ids is remapped.
      const schedRow = findInsert("scheduled_transactions");
      expect(schedRow.tag_ids).toContain(tagRow.id as string);
    });

    it("strips sequence-backed id columns so PG auto-assigns fresh values on restore", async () => {
      // security_prices.id is BIGSERIAL. If we passed the backup's bigint id
      // through, it would either be remapped to a UUID (the original bug --
      // "invalid input syntax for type bigint") or collide on the shared
      // sequence with another user's row and be silently skipped by
      // ON CONFLICT DO NOTHING. Stripping the column lets PG assign a fresh
      // value, mirroring how UUID primary keys get remapped to fresh UUIDs.
      mockUserRepo.findOne.mockResolvedValue(mockUser);
      (bcrypt.compare as jest.Mock).mockResolvedValue(true);

      const securityId = randomUUID();
      mockQueryRunner.query.mockImplementation(
        (sql: string, params?: unknown[]) => {
          if (
            typeof sql === "string" &&
            sql.includes("information_schema.columns") &&
            Array.isArray(params) &&
            params[0] === "security_prices"
          ) {
            return Promise.resolve([
              {
                column_name: "id",
                data_type: "bigint",
                column_default: "nextval('security_prices_id_seq'::regclass)",
              },
              {
                column_name: "security_id",
                data_type: "uuid",
                column_default: null,
              },
              {
                column_name: "price_date",
                data_type: "date",
                column_default: null,
              },
              {
                column_name: "close_price",
                data_type: "numeric",
                column_default: null,
              },
            ]);
          }
          return mockQueryHandler(sql, params);
        },
      );

      const backup = {
        ...validBackupData,
        securities: [
          {
            id: securityId,
            user_id: userId,
            symbol: "VEA",
            name: "Vanguard",
          },
        ],
        security_prices: [
          {
            id: "5",
            security_id: securityId,
            price_date: "2024-06-01",
            close_price: 100.5,
          },
          {
            id: "6",
            security_id: securityId,
            price_date: "2024-06-02",
            close_price: 101.25,
          },
        ],
      };

      await service.restoreData(
        userId,
        makeInput({ password: "test", data: backup }),
      );

      const priceInserts = mockQueryRunner.query.mock.calls.filter(
        (c: unknown[]) =>
          typeof c[0] === "string" &&
          c[0].includes('INSERT INTO "security_prices"'),
      );
      expect(priceInserts.length).toBe(2);
      for (const call of priceInserts) {
        // id column is stripped entirely so PG assigns from the sequence.
        // Without this, the original bug remapped the bigint id to a UUID
        // and sent it into the bigint column.
        expect(call[0]).not.toContain('"id"');
        // The UUID FK to securities is still remapped to the new security id.
        const row = insertColumnMap(call);
        expect(row.security_id).not.toBe(securityId);
      }
    });

    it("does not remap non-UUID string values that happen to match a bigint id", async () => {
      // The original buildBackupIdRemap matched any string id, so a bigint
      // like "5" would land in the remap and deepRemapIds would rewrite every
      // string "5" in the backup -- including unrelated bigint values -- to
      // a UUID. The UUID-only filter prevents that.
      mockUserRepo.findOne.mockResolvedValue(mockUser);
      (bcrypt.compare as jest.Mock).mockResolvedValue(true);

      const acctId = randomUUID();
      const backup = {
        ...validBackupData,
        // A bigserial-style id and a non-id field with the same string value.
        // Neither should be rewritten as a UUID.
        security_prices: [
          { id: "5", security_id: acctId, price_date: "2024-06-01" },
        ],
        accounts: [
          {
            id: acctId,
            user_id: userId,
            name: "Checking",
            account_number: "5",
          },
        ],
      };

      await service.restoreData(
        userId,
        makeInput({ password: "test", data: backup }),
      );

      const acctInsert = mockQueryRunner.query.mock.calls.find(
        (c: unknown[]) =>
          typeof c[0] === "string" && c[0].includes('INSERT INTO "accounts"'),
      );
      expect(acctInsert).toBeDefined();
      const row = insertColumnMap(acctInsert!);
      // The bigint-shaped string is preserved as-is; only UUID-format ids
      // get remapped.
      expect(row.account_number).toBe("5");
    });

    /**
     * Invariant: a restore must not make a user's own GEM history look like it
     * belongs to a configuration they never had.
     * Canonical adversarial input: identifiers rewritten underneath derived
     * data (testing contract, ownership).
     * Minimal mutation: drop the `rehashGemSignalFingerprints` call.
     * Test that fails under it: the first below -- the signal keeps a hash of
     * the pre-restore security ids and the report treats it as stale.
     */
    describe("GEM signal fingerprints", () => {
      const securityId = randomUUID();
      const strategyId = randomUUID();

      /** The hash the strategy's configuration had before the restore. */
      const fingerprintFor = (secId: string) =>
        gemConfigFingerprint(
          { cadence: "MONTHLY", lookbackMonths: 12 } as never,
          [{ role: "US_EQUITY", securityId: secId }] as never,
        );

      const backupWith = (signalFingerprint: string) => ({
        ...validBackupData,
        securities: [{ id: securityId, user_id: userId, symbol: "SPY" }],
        gem_strategies: [
          {
            id: strategyId,
            user_id: userId,
            name: "GEM",
            cadence: "MONTHLY",
            lookback_months: 12,
          },
        ],
        gem_strategy_assets: [
          {
            id: randomUUID(),
            user_id: userId,
            strategy_id: strategyId,
            role: "US_EQUITY",
            security_id: securityId,
          },
        ],
        gem_strategy_signals: [
          {
            id: randomUUID(),
            user_id: userId,
            strategy_id: strategyId,
            evaluated_on: "2025-07-31",
            config_fingerprint: signalFingerprint,
            algorithm_version: 2,
          },
        ],
      });

      const restoredSignal = async (data: Record<string, unknown>) => {
        mockUserRepo.findOne.mockResolvedValue(mockUser);
        (bcrypt.compare as jest.Mock).mockResolvedValue(true);
        await service.restoreData(
          userId,
          makeInput({ password: "test", data }),
        );
        const insert = mockQueryRunner.query.mock.calls.find(
          (c: unknown[]) =>
            typeof c[0] === "string" &&
            c[0].includes('INSERT INTO "gem_strategy_signals"'),
        );
        expect(insert).toBeDefined();
        return insertColumnMap(insert!);
      };

      it("re-hashes a current signal onto the remapped security ids", async () => {
        const row = await restoredSignal(
          backupWith(fingerprintFor(securityId)),
        );

        // The security got a new UUID, so the hash of the *same* configuration
        // is a different string -- and it must be that string, or the first
        // report after the restore recomputes or hides the user's own history.
        expect(row.config_fingerprint).not.toBe(fingerprintFor(securityId));
        expect(typeof row.config_fingerprint).toBe("string");
        expect((row.config_fingerprint as string).length).toBe(64);
      });

      it("leaves a signal that was already stale alone", async () => {
        // It answered a different configuration before the backup and still
        // does. Re-stamping it would promote retired history into the current
        // run, with its `executed` flags.
        const stale = "0".repeat(64);
        const row = await restoredSignal(backupWith(stale));

        expect(row.config_fingerprint).toBe(stale);
      });
    });

    it("should ensure referenced currencies exist before restoring data", async () => {
      mockUserRepo.findOne.mockResolvedValue(mockUser);
      (bcrypt.compare as jest.Mock).mockResolvedValue(true);
      // First call to SELECT code FROM currencies returns empty (missing)
      mockQueryRunner.query.mockImplementation(
        (sql: string, _params?: unknown[]) => {
          if (
            typeof sql === "string" &&
            sql.includes("SELECT code FROM currencies")
          ) {
            return Promise.resolve([]);
          }
          return Promise.resolve([]);
        },
      );

      const backupWithCurrencies = {
        ...validBackupData,
        currencies: [
          {
            code: "MYR",
            name: "Malaysian Ringgit",
            symbol: "RM",
            decimal_places: 2,
            is_active: true,
            created_by_user_id: "other-user",
          },
        ],
        user_currency_preferences: [
          { user_id: userId, currency_code: "MYR", is_active: false },
        ],
        accounts: [
          {
            id: "acc-1",
            user_id: userId,
            name: "MYR Account",
            currency_code: "MYR",
          },
        ],
      };

      await service.restoreData(
        userId,
        makeInput({ password: "test", data: backupWithCurrencies }),
      );

      // Verify currencies INSERT was called with user-created currency
      const insertCalls = mockQueryRunner.query.mock.calls.filter(
        (call: unknown[]) =>
          typeof call[0] === "string" &&
          call[0].includes('INSERT INTO "currencies"'),
      );
      expect(insertCalls.length).toBeGreaterThan(0);

      // Verify the created_by_user_id was overridden to current user
      const currencyInsert = insertCalls[0];
      expect(currencyInsert[1]).toContain(userId);
    });

    it("auto-creates a missing referenced currency with its real symbol, not the code", async () => {
      mockUserRepo.findOne.mockResolvedValue(mockUser);
      (bcrypt.compare as jest.Mock).mockResolvedValue(true);
      // USD is missing from the target instance (no bulk seed) and is not part
      // of a user backup, so it lands in the auto-create path.
      mockQueryRunner.query.mockImplementation((sql: string) => {
        if (
          typeof sql === "string" &&
          sql.includes("SELECT code FROM currencies")
        ) {
          return Promise.resolve([]);
        }
        return Promise.resolve([]);
      });

      const backupWithSystemCurrency = {
        ...validBackupData,
        currencies: [],
        accounts: [
          {
            id: "acc-1",
            user_id: userId,
            name: "USD Account",
            currency_code: "USD",
          },
        ],
      };

      await service.restoreData(
        userId,
        makeInput({ password: "test", data: backupWithSystemCurrency }),
      );

      const autoCreate = mockQueryRunner.query.mock.calls.find(
        (call: unknown[]) =>
          typeof call[0] === "string" &&
          call[0].includes('INSERT INTO "currencies"') &&
          Array.isArray(call[1]) &&
          call[1][0] === "USD",
      );
      expect(autoCreate).toBeDefined();
      // params: [code, name, symbol, decimalPlaces, userId]
      expect(autoCreate![1]).toEqual(["USD", "US Dollar", "$", 2, userId]);
    });

    it("should stringify JSONB values (arrays/objects) for PostgreSQL parameters", async () => {
      mockUserRepo.findOne.mockResolvedValue(mockUser);
      (bcrypt.compare as jest.Mock).mockResolvedValue(true);

      const sectorWeightings = [
        { sector: "Technology", weight: 0.25 },
        { sector: "Healthcare", weight: 0.15 },
      ];
      const backupWithJsonb = {
        ...validBackupData,
        securities: [
          {
            id: "sec-1",
            user_id: userId,
            symbol: "VEA",
            name: "Vanguard FTSE",
            security_type: "ETF",
            currency_code: "USD",
            is_active: true,
            sector_weightings: sectorWeightings,
          },
        ],
        scheduled_transactions: [
          {
            id: "sched-1",
            user_id: userId,
            account_id: "acc-1",
            tag_ids: ["tag-1", "tag-2"],
          },
        ],
      };

      await service.restoreData(
        userId,
        makeInput({
          password: "test",
          data: backupWithJsonb,
        }),
      );

      // Find the securities INSERT call
      const insertCalls = mockQueryRunner.query.mock.calls.filter(
        (call: unknown[]) =>
          typeof call[0] === "string" && call[0].includes("INSERT INTO"),
      );
      const securitiesInsert = insertCalls.find(
        (call: unknown[]) =>
          typeof call[0] === "string" && call[0].includes('"securities"'),
      );
      expect(securitiesInsert).toBeDefined();
      // The sector_weightings value should be a JSON string, not a raw array
      const params = securitiesInsert![1] as unknown[];
      const jsonParam = params.find(
        (p) => typeof p === "string" && p.includes("Technology"),
      );
      expect(jsonParam).toBe(JSON.stringify(sectorWeightings));
    });

    it("should preserve created_at and updated_at timestamps from backup", async () => {
      mockUserRepo.findOne.mockResolvedValue(mockUser);
      (bcrypt.compare as jest.Mock).mockResolvedValue(true);

      const backupWithTimestamps = {
        ...validBackupData,
        categories: [
          {
            id: "cat-1",
            user_id: userId,
            name: "Food",
            created_at: "2024-06-15T10:30:00.000Z",
          },
        ],
        transactions: [
          {
            id: "txn-1",
            user_id: userId,
            account_id: "acc-1",
            amount: 100,
            created_at: "2024-07-01T08:00:00.000Z",
            updated_at: "2024-07-02T09:00:00.000Z",
          },
        ],
      };

      await service.restoreData(
        userId,
        makeInput({ password: "test", data: backupWithTimestamps }),
      );

      const insertCalls = mockQueryRunner.query.mock.calls.filter(
        (call: unknown[]) =>
          typeof call[0] === "string" && call[0].includes("INSERT INTO"),
      );

      // Verify categories INSERT includes created_at
      const categoryInsert = insertCalls.find(
        (call: unknown[]) =>
          typeof call[0] === "string" && call[0].includes('"categories"'),
      );
      expect(categoryInsert).toBeDefined();
      expect(categoryInsert![0]).toContain('"created_at"');
      expect(categoryInsert![1]).toContain("2024-06-15T10:30:00.000Z");

      // Verify transactions INSERT includes both created_at and updated_at
      const txnInsert = insertCalls.find(
        (call: unknown[]) =>
          typeof call[0] === "string" && call[0].includes('"transactions"'),
      );
      expect(txnInsert).toBeDefined();
      expect(txnInsert![0]).toContain('"created_at"');
      expect(txnInsert![0]).toContain('"updated_at"');
      expect(txnInsert![1]).toContain("2024-07-01T08:00:00.000Z");
      expect(txnInsert![1]).toContain("2024-07-02T09:00:00.000Z");
    });

    it("runs the restore transaction under preserveTimestamps and issues no trigger DDL", async () => {
      mockUserRepo.findOne.mockResolvedValue(mockUser);
      (bcrypt.compare as jest.Mock).mockResolvedValue(true);

      const backupWithFks = {
        ...validBackupData,
        accounts: [
          {
            id: "acc-1",
            user_id: userId,
            name: "Checking",
            linked_account_id: "acc-2",
            updated_at: "2024-06-01T00:00:00.000Z",
          },
          {
            id: "acc-2",
            user_id: userId,
            name: "Savings",
            linked_account_id: "acc-1",
            updated_at: "2024-06-02T00:00:00.000Z",
          },
        ],
      };

      // Capture the ambient preserveTimestamps flag at each transaction open --
      // that flag is what the real withScopedDb turns into the
      // app.preserve_timestamps GUC the updated_at trigger honours.
      const flagsSeen: (boolean | undefined)[] = [];
      const originalTransaction =
        mockDataSource.transaction.getMockImplementation()!;
      mockDataSource.transaction.mockImplementation((...args: unknown[]) => {
        flagsSeen.push(getRequestContext()?.preserveTimestamps);
        return originalTransaction(...(args as [never]));
      });

      await service.restoreData(
        userId,
        makeInput({ password: "test", data: backupWithFks }),
      );

      // The user lookup runs under the caller's plain context; the restore
      // transaction itself carries the flag.
      expect(flagsSeen[0]).toBeUndefined();
      expect(flagsSeen[flagsSeen.length - 1]).toBe(true);

      const allCalls = mockQueryRunner.query.mock.calls.map(
        (call: unknown[]) => call[0] as string,
      );

      // The deferred-FK UPDATE still runs -- with no trigger DDL around it.
      // The old DISABLE/ENABLE pair required table ownership, which the
      // runtime role does not have under RLS enforcement.
      const updateIdx = allCalls.findIndex(
        (sql) =>
          sql.includes("UPDATE") &&
          sql.includes('"accounts"') &&
          sql.includes('"linked_account_id"'),
      );
      expect(updateIdx).toBeGreaterThan(-1);
      expect(
        allCalls.some(
          (sql) =>
            sql.includes("DISABLE TRIGGER") || sql.includes("ENABLE TRIGGER"),
        ),
      ).toBe(false);
    });

    it("keeps trigger DDL out of the restore path (source guard)", () => {
      // Regression guard for task C5: the mechanism for preserving restored
      // timestamps is the app.preserve_timestamps GUC, never ALTER TABLE
      // trigger DDL -- any reappearance is a bug wherever it is.
      const source = fs.readFileSync(
        path.join(__dirname, "backup.service.ts"),
        "utf8",
      );
      expect(source).not.toMatch(/DISABLE TRIGGER/);
      expect(source).not.toMatch(/ENABLE TRIGGER/);
    });

    it("accepts the session-confirmed sentinel for OIDC users (soft re-auth)", async () => {
      // OIDC restore mirrors account deletion: the live JWT session is the
      // re-authentication, so any present confirmation token is accepted -- the
      // frontend sends a non-JWT sentinel it cannot cryptographically sign.
      const oidcModule = {
        ...mockUser,
        authProvider: "oidc",
        passwordHash: null,
        oidcSubject: "sub-1",
      };
      mockUserRepo.findOne.mockResolvedValue(oidcModule);

      const result = await service.restoreData(
        userId,
        makeInput({ oidcIdToken: oidcArtifact() }),
      );

      expect(result.message).toBe("Backup restored successfully");
    });

    // P2-005. Restore is the most destructive action in the product: it deletes
    // everything the user has and writes the file's contents in its place. Each
    // of these used to be accepted, because the check was only whether the field
    // was non-empty.
    it.each([
      ["the sentinel the client used to send", "oidc-session-confirmed"],
      ["any non-empty string", "x"],
      ["an unsigned JWT-shaped value", "a.b.c"],
    ])("refuses %s as re-authentication for restore", async (_label, token) => {
      mockUserRepo.findOne.mockResolvedValue({
        ...mockUser,
        authProvider: "oidc",
        passwordHash: null,
        oidcSubject: "sub-1",
      });

      await expect(
        service.restoreData(userId, makeInput({ oidcIdToken: token })),
      ).rejects.toThrow(UnauthorizedException);
    });

    it("refuses an artifact minted to delete data rather than restore", async () => {
      mockUserRepo.findOne.mockResolvedValue({
        ...mockUser,
        authProvider: "oidc",
        passwordHash: null,
        oidcSubject: "sub-1",
      });

      await expect(
        service.restoreData(
          userId,
          makeInput({ oidcIdToken: oidcArtifact("delete-data") }),
        ),
      ).rejects.toThrow(UnauthorizedException);
    });

    it("refuses an artifact minted for a different user", async () => {
      mockUserRepo.findOne.mockResolvedValue({
        ...mockUser,
        authProvider: "oidc",
        passwordHash: null,
        oidcSubject: "sub-1",
      });

      await expect(
        service.restoreData(
          userId,
          makeInput({
            oidcIdToken: oidcArtifact("restore-backup", "another-user"),
          }),
        ),
      ).rejects.toThrow(UnauthorizedException);
    });

    it("spends the artifact, so a replayed restore is refused", async () => {
      mockUserRepo.findOne.mockResolvedValue({
        ...mockUser,
        authProvider: "oidc",
        passwordHash: null,
        oidcSubject: "sub-1",
      });
      const artifact = oidcArtifact();

      await service.restoreData(userId, makeInput({ oidcIdToken: artifact }));
      await expect(
        service.restoreData(userId, makeInput({ oidcIdToken: artifact })),
      ).rejects.toThrow(UnauthorizedException);
    });

    it("does not spend the re-authentication when the file is unusable", async () => {
      // The artifact is single-use and the round trip that mints it loses the
      // file selection, so a wrong backup password or a non-Monize file must not
      // cost one. Nothing is written either way.
      mockUserRepo.findOne.mockResolvedValue({
        ...mockUser,
        authProvider: "oidc",
        passwordHash: null,
        oidcSubject: "sub-1",
      });
      const artifact = oidcArtifact();

      await expect(
        service.restoreData(userId, {
          compressedData: Buffer.from("not gzip at all"),
          oidcIdToken: artifact,
        }),
      ).rejects.toThrow(BadRequestException);

      // Still good: the user fixes the file and retries without another round trip.
      await expect(
        service.restoreData(userId, makeInput({ oidcIdToken: artifact })),
      ).resolves.toMatchObject({ message: "Backup restored successfully" });
    });

    it("refuses a local account with no password to check", async () => {
      // This branch fell off the end of the else-if chain and required no proof.
      mockUserRepo.findOne.mockResolvedValue({
        ...mockUser,
        authProvider: "local",
        passwordHash: null,
      });

      await expect(service.restoreData(userId, makeInput({}))).rejects.toThrow(
        UnauthorizedException,
      );
    });

    it("rejects backup files that decompress to a non-object", async () => {
      mockUserRepo.findOne.mockResolvedValue(mockUser);
      (bcrypt.compare as jest.Mock).mockResolvedValue(true);
      // Gzip a literal null, which is valid JSON but not an object.
      const nullPayload = compressBackupData(
        null as unknown as Record<string, unknown>,
      );
      await expect(
        service.restoreData(userId, {
          compressedData: nullPayload,
          password: "test",
        }),
      ).rejects.toThrow(/must be an object/);
    });

    it("executes the currency INSERT path when a user-created currency is in the backup", async () => {
      mockUserRepo.findOne.mockResolvedValue(mockUser);
      (bcrypt.compare as jest.Mock).mockResolvedValue(true);
      // Make the information_schema query for currencies return the column list
      // so columns aren't all stripped. Make the SELECT-existing query empty so
      // the INSERT is reached.
      mockQueryRunner.query.mockImplementation(
        (sql: string, params?: unknown[]) => {
          if (
            typeof sql === "string" &&
            sql.includes("information_schema.columns")
          ) {
            // ensureCurrenciesExist embeds the table name literally; insertRows
            // passes it via $1.
            const isCurrencies =
              sql.includes("'currencies'") ||
              (Array.isArray(params) && params[0] === "currencies");
            const cols = isCurrencies
              ? schemaColumns.currencies
              : (params && schemaColumns[params[0] as string]) || [];
            return Promise.resolve(
              cols.map((col: string) => ({
                column_name: col,
                data_type: "text",
              })),
            );
          }
          return Promise.resolve([]);
        },
      );

      const dataWithCurrency = {
        ...validBackupData,
        currencies: [
          {
            code: "XYZ",
            name: "Test Currency",
            symbol: "X",
            decimal_places: 2,
            is_active: true,
            created_by_user_id: "someone",
          },
        ],
        // ensureCurrenciesExist short-circuits unless at least one row
        // somewhere references a currency code, so add a reference.
        user_currency_preferences: [
          { user_id: userId, currency_code: "XYZ", is_active: true },
        ],
      };
      await service.restoreData(
        userId,
        makeInput({ password: "test", data: dataWithCurrency }),
      );

      const currencyInsertCalls = mockQueryRunner.query.mock.calls.filter(
        (c: unknown[]) =>
          typeof c[0] === "string" && c[0].includes('INSERT INTO "currencies"'),
      );
      expect(currencyInsertCalls.length).toBeGreaterThan(0);
    });

    it("passes native PG array values straight through (not JSON-stringified) for ARRAY columns", async () => {
      mockUserRepo.findOne.mockResolvedValue(mockUser);
      (bcrypt.compare as jest.Mock).mockResolvedValue(true);
      mockQueryRunner.query.mockImplementation(
        (sql: string, params?: unknown[]) => {
          if (
            typeof sql === "string" &&
            sql.includes("information_schema.columns")
          ) {
            if (
              Array.isArray(params) &&
              params[0] === "monte_carlo_scenarios"
            ) {
              return Promise.resolve([
                { column_name: "id", data_type: "uuid" },
                { column_name: "user_id", data_type: "uuid" },
                { column_name: "name", data_type: "text" },
                { column_name: "account_ids", data_type: "ARRAY" },
              ]);
            }
            return Promise.resolve([]);
          }
          return Promise.resolve([]);
        },
      );

      const dataWithMc = {
        ...validBackupData,
        monte_carlo_scenarios: [
          {
            id: "mc-1",
            user_id: userId,
            name: "S1",
            account_ids: ["acc-a", "acc-b"],
          },
        ],
      };
      await service.restoreData(
        userId,
        makeInput({ password: "test", data: dataWithMc }),
      );

      const insertCall = mockQueryRunner.query.mock.calls.find(
        (c: unknown[]) =>
          typeof c[0] === "string" &&
          c[0].includes('INSERT INTO "monte_carlo_scenarios"'),
      );
      expect(insertCall).toBeDefined();
      const values = insertCall![1] as unknown[];
      const accountIdsValue = values.find(
        (v) => Array.isArray(v) && (v as string[]).includes("acc-a"),
      );
      // The value is a JS array (not a JSON string), so the pg driver
      // serialises it as PG array syntax.
      expect(accountIdsValue).toEqual(["acc-a", "acc-b"]);
    });

    it("should accept OIDC re-auth for OIDC users", async () => {
      mockUserRepo.findOne.mockResolvedValue({
        ...mockUser,
        authProvider: "oidc",
        passwordHash: null,
        oidcSubject: "oidc-sub-123",
      });

      const result = await service.restoreData(
        userId,
        makeInput({
          oidcIdToken: oidcArtifact(),
        }),
      );

      expect(result.message).toBe("Backup restored successfully");
    });

    describe("encrypted backups", () => {
      function encryptedBlob(data: Record<string, unknown>, password: string) {
        return encryptBackup(compressBackupData(data), password);
      }

      it("decrypts using the auth password when nothing more specific is provided", async () => {
        mockUserRepo.findOne.mockResolvedValue(mockUser);
        (bcrypt.compare as jest.Mock).mockResolvedValue(true);
        const result = await service.restoreData(userId, {
          compressedData: encryptedBlob(validBackupData, "user-password"),
          password: "user-password",
        });
        expect(result.message).toBe("Backup restored successfully");
      });

      it("prefers the explicit backupPassword over the auth password", async () => {
        mockUserRepo.findOne.mockResolvedValue(mockUser);
        (bcrypt.compare as jest.Mock).mockResolvedValue(true);
        const result = await service.restoreData(userId, {
          compressedData: encryptedBlob(validBackupData, "old-backup-password"),
          password: "new-login-password",
          backupPassword: "old-backup-password",
        });
        expect(result.message).toBe("Backup restored successfully");
      });

      it("falls back to the stored backup password (for OIDC users without auth password)", async () => {
        mockUserRepo.findOne.mockResolvedValue({
          ...mockUser,
          authProvider: "oidc",
          passwordHash: null,
          oidcSubject: "sub-1",
          backupEncryptionEnabled: true,
          backupPasswordEnc: "enc:stored-bk-pw",
        });
        const result = await service.restoreData(userId, {
          compressedData: encryptedBlob(validBackupData, "stored-bk-pw"),
          oidcIdToken: oidcArtifact(),
        });
        expect(result.message).toBe("Backup restored successfully");
      });

      it("throws a BACKUP_PASSWORD_REQUIRED error when no candidate decrypts", async () => {
        mockUserRepo.findOne.mockResolvedValue(mockUser);
        (bcrypt.compare as jest.Mock).mockResolvedValue(true);
        await expect(
          service.restoreData(userId, {
            compressedData: encryptedBlob(validBackupData, "real-pw"),
            password: "different-pw",
          }),
        ).rejects.toMatchObject({
          response: expect.objectContaining({
            code: "BACKUP_PASSWORD_REQUIRED",
          }),
        });
      });
    });
  });
});
