import {
  BadRequestException,
  NotFoundException,
  PayloadTooLargeException,
} from "@nestjs/common";
import { DataSource } from "typeorm";

import { resolveUserDefaultCurrency } from "../common/default-currency.util";
import { Currency } from "../currencies/entities/currency.entity";
import { createScopedDbMocks } from "../test-helpers/scoped-db-testing";
import { CreateWarrantyDto } from "./dto/create-warranty.dto";
import { WarrantyView } from "./dto/warranty-response.dto";
import { WarrantiesService } from "./warranties.service";
import {
  WARRANTY_IMPORT_MAX_BYTES,
  WARRANTY_IMPORT_MAX_ROWS,
  WarrantyImportService,
} from "./warranty-import.service";

jest.mock("../common/db/scoped-db", () =>
  jest.requireActual("../test-helpers/scoped-db-testing").scopedDbMockModule(),
);
jest.mock("../common/default-currency.util", () => ({
  resolveUserDefaultCurrency: jest.fn(),
}));

const USER = "11111111-1111-4111-8111-111111111111";

const HEADER =
  "ProductName,PurchaseDate,WarrantyDurationYears,WarrantyDurationMonths,WarrantyDurationDays,ExpirationDate,IsLifetime,PurchasePrice,SerialNumber,ProductURL,Vendor,Tags,Notes,Currency,ModelNumber,WarrantyType";
const VALID_ROWS = [
  'Laptop,2026-01-31,1,6,0,,false,1499.99,"SN-1,SN-2",,Best Buy,work,,CAD,X1,Manufacturer',
  "Fridge,2025-05-01,0,0,0,2030-05-01,false,,,,Home Depot,,,,,extended",
  'Camera,2026-02-10,2,,,,no,899.5,"[""AB,12""]",,,,,XYZ,,store',
];
const INVALID_ROW = "Toaster,2026-03-01,0,0,0,,false,25,,,,,,USD,,";
const ALL_VALID = [HEADER, ...VALID_ROWS].join("\n");
const WITH_INVALID = [HEADER, ...VALID_ROWS, INVALID_ROW].join("\n");

/** What `WarrantiesService.create` answers, as the real method types it. */
function view(id: string, dto: CreateWarrantyDto): WarrantyView {
  return {
    id,
    name: dto.name,
    vendorName: dto.vendorName ?? null,
    payeeId: null,
    modelNumber: dto.modelNumber ?? null,
    serialNumbers: dto.serialNumbers ?? [],
    warrantyKind: dto.warrantyKind ?? "manufacturer",
    purchaseDate: dto.purchaseDate,
    expiresOn: dto.expiresOn ?? null,
    isLifetime: dto.isLifetime ?? false,
    purchasePrice: dto.purchasePrice ?? null,
    currencyCode: dto.currencyCode ?? null,
    productUrl: dto.productUrl ?? null,
    notes: dto.notes ?? null,
    today: "2026-10-21",
    status: "active",
    daysLeft: 100,
    documentCount: 0,
    openClaimCount: 0,
    linkedTransaction: null,
    archivedAt: null,
    createdAt: "2026-10-21T12:00:00.000Z",
    updatedAt: "2026-10-21T12:00:00.000Z",
  };
}

describe("WarrantyImportService", () => {
  let service: WarrantyImportService;
  let mocks: ReturnType<typeof createScopedDbMocks>;
  let create: jest.Mock<
    Promise<WarrantyView>,
    Parameters<WarrantiesService["create"]>
  >;
  let currencyRepo: { find: jest.Mock };

  beforeEach(() => {
    currencyRepo = {
      find: jest
        .fn()
        .mockResolvedValue([{ code: "CAD" }, { code: "USD" }, { code: "EUR" }]),
    };
    mocks = createScopedDbMocks([[Currency, currencyRepo]]);
    let n = 0;
    create = jest.fn(async (_userId: string, dto: CreateWarrantyDto) =>
      view(`w-${++n}`, dto),
    );
    (resolveUserDefaultCurrency as jest.Mock).mockResolvedValue("CAD");
    service = new WarrantyImportService(
      mocks.dataSource as unknown as DataSource,
      { create } as unknown as WarrantiesService,
    );
  });

  describe("dry run", () => {
    it("reports every row and writes nothing", async () => {
      const result = await service.run(USER, WITH_INVALID, { dryRun: true });

      expect(result.dryRun).toBe(true);
      expect(result.created).toBe(0);
      expect(result.skippedColumns).toEqual(["Tags"]);
      expect(result.rows.map((r) => [r.line, r.outcome])).toEqual([
        [2, "valid"],
        [3, "valid"],
        [4, "valid"],
        [5, "invalid"],
      ]);
      expect(result.rows[2].warnings).toEqual([
        'Currency "XYZ" is not known; CAD was used',
      ]);
      expect(create).not.toHaveBeenCalled();
      expect(resolveUserDefaultCurrency).toHaveBeenCalledWith(
        mocks.dataSource,
        USER,
      );
    });
  });

  describe("commit", () => {
    it("creates every row through WarrantiesService.create inside one transaction", async () => {
      const result = await service.run(USER, ALL_VALID, { dryRun: false });

      expect(mocks.dataSource.transaction).toHaveBeenCalledTimes(1);
      expect(create).toHaveBeenCalledTimes(3);
      expect(create.mock.calls.map(([userId]) => userId)).toEqual([
        USER,
        USER,
        USER,
      ]);
      expect(result).toMatchObject({ dryRun: false, created: 3 });
      expect(result.rows.map((r) => [r.outcome, r.warrantyId])).toEqual([
        ["created", "w-1"],
        ["created", "w-2"],
        ["created", "w-3"],
      ]);
    });

    it("writes exactly what the dry run previewed (WTY-006)", async () => {
      const preview = await service.run(USER, ALL_VALID, { dryRun: true });
      const commit = await service.run(USER, ALL_VALID, { dryRun: false });

      expect(create.mock.calls.map(([, dto]) => dto)).toEqual(
        preview.rows.map((r) => r.warranty),
      );
      expect(
        commit.rows.map(({ outcome: _o, warrantyId: _id, ...rest }) => rest),
      ).toEqual(preview.rows.map(({ outcome: _o, ...rest }) => rest));
    });

    it("refuses the whole file when a row is invalid, before any write", async () => {
      await expect(
        service.run(USER, WITH_INVALID, { dryRun: false }),
      ).rejects.toThrow(
        new BadRequestException(
          "1 rows are invalid, so nothing was imported; fix them or skip them",
        ),
      );
      expect(create).not.toHaveBeenCalled();
    });

    it("imports the valid rows and reports the invalid ones with skipInvalid", async () => {
      const result = await service.run(USER, WITH_INVALID, {
        dryRun: false,
        skipInvalid: true,
      });

      expect(create).toHaveBeenCalledTimes(3);
      expect(result.created).toBe(3);
      expect(result.rows[3]).toMatchObject({
        line: 5,
        outcome: "invalid",
        warranty: null,
        errors: [
          "Fill ExpirationDate, a WarrantyDuration column or IsLifetime",
        ],
      });
    });

    it("lets a refusal from the create path reject the whole import", async () => {
      create.mockImplementationOnce(async (_u, dto) => view("w-1", dto));
      create.mockRejectedValueOnce(
        new NotFoundException('Currency "CAD" not found'),
      );

      await expect(
        service.run(USER, ALL_VALID, { dryRun: false }),
      ).rejects.toBeInstanceOf(NotFoundException);
      expect(create).toHaveBeenCalledTimes(2);
      expect(mocks.dataSource.transaction).toHaveBeenCalledTimes(1);
    });
  });

  describe("limits and shape", () => {
    it("refuses a file over 1 MiB before opening a transaction", async () => {
      const big = `${HEADER}\n${"x".repeat(WARRANTY_IMPORT_MAX_BYTES)}`;
      await expect(
        service.run(USER, big, { dryRun: true }),
      ).rejects.toBeInstanceOf(PayloadTooLargeException);
      expect(mocks.dataSource.transaction).not.toHaveBeenCalled();
    });

    it("accepts 1000 data rows and refuses 1001", async () => {
      const rows = (count: number) =>
        [
          HEADER,
          ...Array.from(
            { length: count },
            (_, i) => `Item ${i},2026-01-01,,,,,true,,,,,,,,,`,
          ),
        ].join("\n");

      const ok = await service.run(USER, rows(WARRANTY_IMPORT_MAX_ROWS), {
        dryRun: true,
      });
      expect(ok.rows).toHaveLength(1000);

      await expect(
        service.run(USER, rows(WARRANTY_IMPORT_MAX_ROWS + 1), {
          dryRun: true,
        }),
      ).rejects.toThrow(
        new BadRequestException(
          "The import file has 1001 rows; at most 1000 are allowed",
        ),
      );
    });

    it("refuses an empty file and a header with no data row", async () => {
      for (const content of ["", "   \n", `${HEADER}\n`]) {
        await expect(
          service.run(USER, content, { dryRun: true }),
        ).rejects.toThrow(
          new BadRequestException(
            "The file must have a header row and at least one data row",
          ),
        );
      }
    });

    it("refuses a file whose header lacks a required column", async () => {
      await expect(
        service.run(USER, "Name,PurchaseDate\nLaptop,2026-01-01\n", {
          dryRun: true,
        }),
      ).rejects.toThrow(
        new BadRequestException(
          "The file's header row has no ProductName column",
        ),
      );
    });

    it("reads a file saved with a byte-order mark", async () => {
      const result = await service.run(USER, `\uFEFF${ALL_VALID}`, {
        dryRun: true,
      });
      expect(result.skippedColumns).toEqual(["Tags"]);
      expect(result.rows.every((r) => r.outcome === "valid")).toBe(true);
    });
  });
});
