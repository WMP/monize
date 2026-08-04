import { Test, TestingModule } from "@nestjs/testing";
import { TypeOrmModule } from "@nestjs/typeorm";
import { ConfigModule, ConfigService } from "@nestjs/config";
import { DataSource } from "typeorm";
import { mkdtempSync, readdirSync, readFileSync, rmSync } from "fs";
import { join } from "path";
import { tmpdir } from "os";
import { createHash } from "crypto";
import { AutoBackupService } from "@/backup/auto-backup.service";
import { BackupService } from "@/backup/backup.service";
import { BackupEncryptionService } from "@/backup/backup-encryption.service";
import { DemoModeService } from "@/common/demo-mode.service";
import { AutoBackupSettings } from "@/backup/entities/auto-backup-settings.entity";
import { User } from "@/users/entities/user.entity";
import { createTestUserDirect } from "../helpers/integration-setup";
import { withUserContext } from "@/common/db/with-context";

/**
 * Automatic-backup file layout against a **real filesystem**.
 *
 * The unit suite mocks `fs.promises`, which is enough to assert the path a call
 * was made with and nothing at all about what ends up on disk. Two of the
 * defects this covers are only visible there:
 *
 * - **Per-owner isolation.** The default backup folder is one deployment-wide
 *   directory and the filename used to be `monize-backup-daily-<date>.<ext>`, so
 *   two users backing up on the same day chose the same key: the second
 *   overwrote the first, and retention deleted across the boundary.
 * - **Occurrence uniqueness.** `every6hours` and `every12hours` produce several
 *   occurrences a day. With a date-only name all of them were the same file, the
 *   last replaced the rest, and the settings row still reported each run a
 *   success.
 *
 * A mocked `writeFile` cannot show either, because in both cases the *calls* are
 * distinct and it is the resulting directory that is wrong. So this suite counts
 * real files and hashes their contents.
 */
describe("Automatic backup file layout (integration)", () => {
  let module: TestingModule;
  let service: AutoBackupService;
  let dataSource: DataSource;
  let backupRoot: string;

  beforeAll(async () => {
    backupRoot = mkdtempSync(join(tmpdir(), "monize-auto-backup-"));

    module = await Test.createTestingModule({
      imports: [
        ConfigModule.forRoot({ isGlobal: true }),
        TypeOrmModule.forRoot({
          type: "postgres",
          host: process.env.DATABASE_HOST || "localhost",
          port: parseInt(process.env.DATABASE_PORT || "5432"),
          username: process.env.DATABASE_USER || "monize_user",
          password: process.env.DATABASE_PASSWORD || "monize_password",
          database: process.env.DATABASE_NAME || "monize_test",
          entities: [__dirname + "/../../src/**/*.entity{.ts,.js}"],
          synchronize: true,
          dropSchema: true,
        }),
        TypeOrmModule.forFeature([User, AutoBackupSettings]),
      ],
      providers: [
        AutoBackupService,
        {
          // Encryption is a separate service on the merged tree. These tests are
          // about the file layout, so the password resolution is stubbed to "no
          // password" -- the encrypted path has its own coverage.
          provide: BackupEncryptionService,
          useValue: {
            resolveBackupPassword: async () => ({ status: "none" as const }),
          } as unknown as jest.Mocked<BackupEncryptionService>,
        },
        {
          provide: DemoModeService,
          useValue: {
            isDemo: false,
          } as unknown as jest.Mocked<DemoModeService>,
        },
        {
          provide: BackupService,
          // The payload's contents are the backup service's business and are
          // covered by backup-restore.integration.spec.ts. What matters here is
          // that distinct occurrences produce distinct files, so the buffer only
          // has to be distinguishable per call.
          useValue: {
            exportToBuffer: jest
              .fn()
              .mockImplementation((userId: string) =>
                Promise.resolve(
                  Buffer.from(`payload:${userId}:${callCounter++}`),
                ),
              ),
            resolveStoredBackupPassword: () => null,
          },
        },
        {
          provide: ConfigService,
          useValue: {
            get: (key: string) =>
              key === "BACKUP_CONTAINER_DIR" ? backupRoot : undefined,
          },
        },
      ],
    }).compile();

    service = module.get(AutoBackupService);
    dataSource = module.get(DataSource);
  });

  let callCounter = 0;

  afterAll(async () => {
    await module.close();
    rmSync(backupRoot, { recursive: true, force: true });
  });

  beforeEach(async () => {
    await dataSource.query(
      `TRUNCATE auto_backup_settings, user_preferences, users CASCADE`,
    );
    for (const entry of readdirSync(backupRoot)) {
      rmSync(join(backupRoot, entry), { recursive: true, force: true });
    }
  });

  /**
   * The user's own backup directory, relative to the root.
   *
   * Backups are sharded two levels deep by the owner's id
   * (`common/shard-path.util.ts`) so a deployment with many users does not put
   * tens of thousands of directories in one parent. The tests care about which
   * owner a file belongs to, not about the shape of the shard, so they compare
   * against this rather than hard-coding the layout.
   */
  const ownerDir = (userId: string) =>
    `${userId.slice(0, 2)}/${userId.slice(2, 4)}/${userId}`;

  /** Every backup file under `dir`, recursively, as `<relative path>`. */
  function backupFiles(dir = backupRoot, prefix = ""): string[] {
    const out: string[] = [];
    for (const entry of readdirSync(dir, { withFileTypes: true })) {
      const rel = prefix ? `${prefix}/${entry.name}` : entry.name;
      if (entry.isDirectory())
        out.push(...backupFiles(join(dir, entry.name), rel));
      else out.push(rel);
    }
    return out.sort();
  }

  const sha = (relativePath: string) =>
    createHash("sha256")
      .update(readFileSync(join(backupRoot, relativePath)))
      .digest("hex");

  async function seedUser(email: string): Promise<string> {
    const user = await createTestUserDirect(dataSource, { email });
    return user.id;
  }

  it("gives each owner its own directory for the same-day backup", async () => {
    const userA = await seedUser(`a-${Date.now()}@example.com`);
    const userB = await seedUser(`b-${Date.now()}@example.com`);

    await withUserContext(userA, () => service.runManualBackup(userA));
    await withUserContext(userB, () => service.runManualBackup(userB));

    const files = backupFiles();
    expect(files).toHaveLength(2);
    expect(files.some((f) => f.startsWith(`${ownerDir(userA)}/`))).toBe(true);
    expect(files.some((f) => f.startsWith(`${ownerDir(userB)}/`))).toBe(true);

    // The decisive assertion, and the one a mocked writeFile cannot make: two
    // real files with different contents both survived.
    const [first, second] = files;
    expect(sha(first)).not.toBe(sha(second));
  });

  it("does not let one owner's retention touch another's files", async () => {
    // Retention of 1 for user A, with user B holding a backup of its own on the
    // same date. Before per-owner directories they shared one listing, so A's
    // sweep could delete B's recovery point.
    const userA = await seedUser(`ra-${Date.now()}@example.com`);
    const userB = await seedUser(`rb-${Date.now()}@example.com`);

    await withUserContext(userB, () => service.runManualBackup(userB));
    const bFilesBefore = backupFiles().filter((f) =>
      f.startsWith(`${ownerDir(userB)}/`),
    );
    expect(bFilesBefore).toHaveLength(1);
    const bHashBefore = sha(bFilesBefore[0]);

    await dataSource.query(
      `UPDATE auto_backup_settings SET retention_daily = 1 WHERE user_id = $1`,
      [userA],
    );
    await withUserContext(userA, () => service.runManualBackup(userA));
    await withUserContext(userA, () => service.runManualBackup(userA));

    const bFilesAfter = backupFiles().filter((f) =>
      f.startsWith(`${ownerDir(userB)}/`),
    );
    expect(bFilesAfter).toEqual(bFilesBefore);
    expect(sha(bFilesAfter[0])).toBe(bHashBefore);
  });

  it("keeps four sub-daily occurrences as four distinct files", async () => {
    const userId = await seedUser(`sub-${Date.now()}@example.com`);
    await dataSource.query(
      `UPDATE auto_backup_settings
          SET frequency = 'every6hours', timezone = 'UTC', retention_daily = 10
        WHERE user_id = $1`,
      [userId],
    );

    const instants = [
      "2026-04-14T02:00:00Z",
      "2026-04-14T08:00:00Z",
      "2026-04-14T14:00:00Z",
      "2026-04-14T20:00:00Z",
    ];
    for (const instant of instants) {
      jest.useFakeTimers({
        now: new Date(instant),
        // Real timers for everything else: the export awaits I/O and a database
        // round trip, both of which a fully faked clock would stall.
        doNotFake: [
          "nextTick",
          "setImmediate",
          "setTimeout",
          "setInterval",
          "queueMicrotask",
        ],
      });
      try {
        await withUserContext(userId, () => service.runManualBackup(userId));
      } finally {
        jest.useRealTimers();
      }
    }

    // The 14th is one of the WEEKLY_DAYS, so a weekly tier copy is written too --
    // correct behaviour, and not what this test is about.
    const files = backupFiles().filter(
      (f) => f.startsWith(`${ownerDir(userId)}/`) && f.includes("-daily-"),
    );
    expect(files).toHaveLength(4);
    expect(new Set(files.map(sha)).size).toBe(4);
    // Same date, distinguished only by the local time.
    for (const file of files) {
      expect(file).toMatch(
        /monize-backup-daily-2026-04-14-\d{6}\.(json\.gz|mzbe)$/,
      );
    }
    expect(files.some((f) => f.includes("-020000."))).toBe(true);
    expect(files.some((f) => f.includes("-200000."))).toBe(true);
  });

  it("keeps two same-second backups as two files, not one", async () => {
    // RFR7-002. The filename carries the local time to the second, which is not
    // uniqueness: two replicas firing the same hourly occurrence, or a
    // double-submitted manual backup, computed the same temporary path *and* the
    // same final path. Both wrote the shared temporary file and both renamed it,
    // so two accepted backups left one file whose contents belonged to whichever
    // write landed last -- and one of the two runs reported success for a
    // recovery point that no longer existed.
    //
    // Only a real filesystem shows it. With `fs.promises` mocked the two calls
    // are distinct and both "succeed"; it is the resulting directory that is
    // wrong.
    const userId = await seedUser(`same-second-${Date.now()}@example.com`);

    // One frozen instant for both runs, so they cannot be told apart by time.
    jest.useFakeTimers({
      now: new Date("2026-04-15T09:00:00Z"),
      doNotFake: [
        "nextTick",
        "setImmediate",
        "setTimeout",
        "setInterval",
        "queueMicrotask",
      ],
    });
    let outcomes: PromiseSettledResult<unknown>[];
    try {
      outcomes = await Promise.allSettled([
        withUserContext(userId, () => service.runManualBackup(userId)),
        withUserContext(userId, () => service.runManualBackup(userId)),
      ]);
    } finally {
      jest.useRealTimers();
    }

    // Both were accepted, so both must have left a recovery point.
    expect(outcomes.filter((o) => o.status === "fulfilled")).toHaveLength(2);

    const files = backupFiles().filter(
      (f) => f.startsWith(`${ownerDir(userId)}/`) && f.includes("-daily-"),
    );
    expect(files).toHaveLength(2);
    // Distinct names and distinct contents: neither overwrote the other, and
    // neither is a half-written file wearing a valid name.
    expect(new Set(files).size).toBe(2);
    expect(new Set(files.map(sha)).size).toBe(2);
    // Both still look like daily backups, or retention would never sweep them.
    for (const file of files) {
      expect(file).toMatch(
        /monize-backup-daily-2026-04-15-\d{6}(?:-\d+)?\.(json\.gz|mzbe)$/,
      );
    }
    // And no shared temporary inode survived either attempt.
    expect(backupFiles().some((f) => f.includes("partial"))).toBe(false);
  });

  it("leaves no partial file behind after a successful write", async () => {
    // The write goes to a dot-prefixed temporary name and is renamed into place.
    // Anything matching that shape still on disk afterwards would be a partial
    // backup, and it must not look like a recovery point either way.
    const userId = await seedUser(`atomic-${Date.now()}@example.com`);

    await withUserContext(userId, () => service.runManualBackup(userId));

    const files = backupFiles();
    expect(files).toHaveLength(1);
    expect(files[0]).not.toContain("partial");
    expect(files[0].split("/").pop()).toMatch(
      /^monize-backup-daily-\d{4}-\d{2}-\d{2}-\d{6}\.(json\.gz|mzbe)$/,
    );
  });
});
