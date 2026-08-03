import fs from "fs";

const mockQuery = jest.fn();
const mockConnect = jest.fn();
const mockEnd = jest.fn();
const mockOn = jest.fn();

jest.mock("pg", () => ({
  Client: jest.fn().mockImplementation(() => ({
    connect: mockConnect,
    query: mockQuery,
    end: mockEnd,
    on: mockOn,
  })),
}));

jest.mock("./common/db/app-role", () => ({
  provisionAppRole: jest.fn().mockResolvedValue(undefined),
}));

const mockExit = jest
  .spyOn(process, "exit")
  .mockImplementation((() => {}) as never);

import { initDatabase } from "./db-init";

/**
 * `db-init` is a check-then-act: it asks whether a `users` table exists and
 * applies `schema.sql` when the answer is no. On a cluster with two backend
 * replicas both containers run it at once, both get "no", and the loser dies on
 * `duplicate_table` -- reported to an operator as a crash-looping pod rather
 * than as the race it is. These specs pin the ordering that closes it.
 */
describe("db-init initDatabase()", () => {
  let existsSyncSpy: jest.SpyInstance;
  let readFileSyncSpy: jest.SpyInstance;
  let consoleSpy: jest.SpyInstance;
  let consoleErrorSpy: jest.SpyInstance;
  let consoleWarnSpy: jest.SpyInstance;

  const grant = { rows: [{ acquired: true }] };
  const tablesExist = { rows: [{ exists: true }] };
  const tablesMissing = { rows: [{ exists: false }] };

  beforeEach(() => {
    jest.clearAllMocks();
    process.env.DATABASE_USER = "u";
    process.env.DATABASE_PASSWORD = "p";
    process.env.DATABASE_NAME = "d";
    mockConnect.mockResolvedValue(undefined);
    mockEnd.mockResolvedValue(undefined);
    mockQuery.mockResolvedValue(grant);
    consoleSpy = jest.spyOn(console, "log").mockImplementation();
    consoleErrorSpy = jest.spyOn(console, "error").mockImplementation();
    consoleWarnSpy = jest.spyOn(console, "warn").mockImplementation();
    existsSyncSpy = jest.spyOn(fs, "existsSync").mockReturnValue(true);
    readFileSyncSpy = jest
      .spyOn(fs, "readFileSync")
      .mockReturnValue("CREATE TABLE users ();");
  });

  afterEach(() => {
    existsSyncSpy.mockRestore();
    readFileSyncSpy.mockRestore();
    consoleSpy.mockRestore();
    consoleErrorSpy.mockRestore();
    consoleWarnSpy.mockRestore();
  });

  const sqls = () => mockQuery.mock.calls.map((c) => String(c[0]));

  it("takes the bootstrap lock before probing for the users table", async () => {
    mockQuery
      .mockResolvedValueOnce(grant) // bootstrap lock
      .mockResolvedValueOnce(tablesMissing) // table probe
      .mockResolvedValue(undefined);

    await initDatabase();

    const lockAt = sqls().findIndex((s) => s.includes("pg_try_advisory_lock"));
    const probeAt = sqls().findIndex((s) => s.includes("information_schema"));
    expect(lockAt).toBeGreaterThanOrEqual(0);
    expect(probeAt).toBeGreaterThan(lockAt);
  });

  it("applies the schema and then releases the lock", async () => {
    mockQuery
      .mockResolvedValueOnce(grant)
      .mockResolvedValueOnce(tablesMissing)
      .mockResolvedValue(undefined);

    await initDatabase();

    const schemaAt = sqls().findIndex((s) => s.includes("CREATE TABLE users"));
    const unlockAt = sqls().findIndex((s) => s.includes("pg_advisory_unlock"));
    expect(schemaAt).toBeGreaterThanOrEqual(0);
    expect(unlockAt).toBeGreaterThan(schemaAt);
    expect(mockExit).not.toHaveBeenCalled();
  });

  it("releases the lock on the already-initialized path too", async () => {
    // The early return is the common case on every restart; leaking the lock
    // there would stall the next replica for the whole timeout.
    mockQuery
      .mockResolvedValueOnce(grant)
      .mockResolvedValueOnce(tablesExist)
      .mockResolvedValue(undefined);

    await initDatabase();

    expect(sqls().some((s) => s.includes("CREATE TABLE users"))).toBe(false);
    expect(sqls().some((s) => s.includes("pg_advisory_unlock"))).toBe(true);
  });

  it("does not apply the schema when the lock cannot be taken", async () => {
    mockQuery.mockResolvedValue({ rows: [{ acquired: false }] });

    await initDatabase({ lock: { timeoutMs: 5, pollMs: 1 } });

    expect(sqls().some((s) => s.includes("information_schema"))).toBe(false);
    expect(sqls().some((s) => s.includes("CREATE TABLE users"))).toBe(false);
    expect(mockExit).toHaveBeenCalledWith(1);
  });

  it("always closes the connection", async () => {
    mockConnect.mockRejectedValue(new Error("ECONNREFUSED"));

    await initDatabase();

    expect(mockEnd).toHaveBeenCalled();
  });
});
