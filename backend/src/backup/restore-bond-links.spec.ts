import { Logger } from "@nestjs/common";
import type { EntityManager } from "typeorm";
import { BackupData } from "./backup-format";
import { BackupRestoreDatabaseService } from "./backup-restore-database.service";

const PRESENT = "11111111-1111-5111-8111-111111111111";
const ABSENT = "22222222-2222-5222-8222-222222222222";

function setup(catalog: Array<{ id: string; currency_code: string }>) {
  const query = jest.fn().mockResolvedValue(catalog);
  const manager = { query } as unknown as EntityManager;
  const warn = jest.spyOn(Logger.prototype, "warn").mockImplementation();
  return { service: new BackupRestoreDatabaseService(), manager, query, warn };
}

const data = (securities: Record<string, unknown>[]): BackupData =>
  ({ version: 1, exportedAt: "x", securities }) as unknown as BackupData;

describe("BackupRestoreDatabaseService.severUnavailableBondLinks", () => {
  afterEach(() => jest.restoreAllMocks());

  it("keeps a link to an instrument the deployment carries, in the security's currency", async () => {
    const { service, manager, warn } = setup([
      { id: PRESENT, currency_code: "PLN" },
    ]);
    const backup = data([
      { id: "s1", currency_code: "PLN", bond_instrument_id: PRESENT },
    ]);
    await expect(
      service.severUnavailableBondLinks(manager, backup),
    ).resolves.toBe(0);
    expect(backup.securities[0].bond_instrument_id).toBe(PRESENT);
    expect(warn).not.toHaveBeenCalled();
  });

  it("restores a link to an instrument this catalog lacks as NULL, and logs it", async () => {
    const { service, manager, warn } = setup([
      { id: PRESENT, currency_code: "PLN" },
    ]);
    const original = [
      { id: "s1", currency_code: "PLN", bond_instrument_id: ABSENT },
      { id: "s2", currency_code: "PLN", bond_instrument_id: PRESENT },
      { id: "s3", currency_code: "USD", bond_instrument_id: null },
    ];
    const backup = data(original);
    await expect(
      service.severUnavailableBondLinks(manager, backup),
    ).resolves.toBe(1);
    expect(backup.securities.map((r) => r.bond_instrument_id)).toEqual([
      null,
      PRESENT,
      null,
    ]);
    // New rows, not a mutation of the rows the file produced.
    expect(original[0].bond_instrument_id).toBe(ABSENT);
    expect(warn.mock.calls[0][0]).toMatch(/1 security link.*does not carry/);
  });

  it("drops a link whose currency differs from the security's (INV-PRICE-001)", async () => {
    const { service, manager, warn } = setup([
      { id: PRESENT, currency_code: "PLN" },
    ]);
    const backup = data([
      { id: "s1", currency_code: "USD", bond_instrument_id: PRESENT },
    ]);
    await expect(
      service.severUnavailableBondLinks(manager, backup),
    ).resolves.toBe(1);
    expect(backup.securities[0].bond_instrument_id).toBeNull();
    expect(warn.mock.calls[0][0]).toMatch(/another currency/);
  });

  it("asks the catalog nothing when no security is linked", async () => {
    const { service, manager, query } = setup([]);
    await service.severUnavailableBondLinks(
      manager,
      data([{ id: "s1", currency_code: "PLN" }]),
    );
    expect(query).not.toHaveBeenCalled();
  });
});
