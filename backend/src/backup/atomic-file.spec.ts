import { promises as fs, mkdtempSync, rmSync } from "fs";
import { join } from "path";
import { tmpdir } from "os";
import {
  cleanStaleTempFiles,
  copyFileAtomic,
  isTempBackupName,
  writeFileAtomic,
} from "./atomic-file";

/**
 * Real files, deliberately.
 *
 * The property under test is that a final backup filename never refers to a
 * partial file. A mocked `rename` cannot show that -- it can only confirm the
 * code called rename, which was never in doubt. What was in doubt is what the
 * directory looks like after a write that did not finish.
 */
describe("atomic backup file writes", () => {
  let dir: string;

  beforeEach(() => {
    dir = mkdtempSync(join(tmpdir(), "monize-atomic-spec-"));
  });

  afterEach(() => {
    rmSync(dir, { recursive: true, force: true });
  });

  const listing = () => fs.readdir(dir).then((names) => names.sort());

  describe("writeFileAtomic", () => {
    it("leaves the final name holding the complete contents", async () => {
      const target = join(dir, "monize-backup-daily-2026-04-01.json.gz");

      await writeFileAtomic(target, Buffer.from("complete payload"));

      expect(await fs.readFile(target, "utf-8")).toBe("complete payload");
      // No temporary file survives a successful write.
      expect(await listing()).toEqual([
        "monize-backup-daily-2026-04-01.json.gz",
      ]);
    });

    it("does not create the final name when the write fails", async () => {
      const target = join(dir, "monize-backup-daily-2026-04-02.json.gz");
      // A Buffer view whose byteLength is a lie makes the write throw after the
      // temporary file exists -- the shape of an ENOSPC or a short write.
      const broken = Object.create(Buffer.prototype) as Buffer;

      await expect(writeFileAtomic(target, broken)).rejects.toThrow();

      // The old `fs.writeFile(finalPath, ...)` truncated first, so this left a
      // zero-length file with a valid name that sorted newest and that retention
      // counted as a recovery point.
      await expect(fs.stat(target)).rejects.toThrow();
      expect(await listing()).toEqual([]);
    });

    it("leaves the previous artifact intact when the write fails", async () => {
      const target = join(dir, "monize-backup-daily-2026-04-03.json.gz");
      await fs.writeFile(target, "yesterday's good backup");
      const broken = Object.create(Buffer.prototype) as Buffer;

      await expect(writeFileAtomic(target, broken)).rejects.toThrow();

      // This is the part that mattered: a failed backup must not destroy the
      // last one that worked.
      expect(await fs.readFile(target, "utf-8")).toBe(
        "yesterday's good backup",
      );
    });

    it("replaces an existing artifact in one step", async () => {
      const target = join(dir, "monize-backup-daily-2026-04-04.json.gz");
      await fs.writeFile(target, "old");

      await writeFileAtomic(target, Buffer.from("new"));

      expect(await fs.readFile(target, "utf-8")).toBe("new");
      expect(await listing()).toEqual([
        "monize-backup-daily-2026-04-04.json.gz",
      ]);
    });

    it("gives concurrent writers distinct temporary files", async () => {
      const target = join(dir, "monize-backup-daily-2026-04-05.json.gz");

      // Exclusive creation plus a unique suffix: two jobs for the same date must
      // not share a temporary file and interleave their bytes into it.
      await Promise.all([
        writeFileAtomic(target, Buffer.from("aaaa")),
        writeFileAtomic(target, Buffer.from("bbbb")),
      ]);

      const contents = await fs.readFile(target, "utf-8");
      expect(["aaaa", "bbbb"]).toContain(contents);
      expect(await listing()).toEqual([
        "monize-backup-daily-2026-04-05.json.gz",
      ]);
    });
  });

  /**
   * A short write is the one failure a real filesystem will not produce on
   * demand, and it is the one the temp-file dance does not catch by itself:
   * `write(2)` may accept fewer bytes than it was given and report exactly that,
   * with no error. `writeFileAtomic` used to call `handle.write(data)` and drop
   * the result, so a half-written payload was fsynced and renamed onto the final,
   * newest-sorting, retention-counted name -- the truncated artifact the whole
   * module exists to prevent.
   *
   * So `fs.open` is spied here and only the returned handle's `write` is
   * substituted. The directory, the rename and the fsync stay real, because what
   * is being asserted is still what the directory looks like afterwards.
   */
  describe("writeFileAtomic under a short write", () => {
    const target = () => join(dir, "monize-backup-daily-2026-01-01.json.gz");
    const payload = Buffer.from("0123456789ABCDEF", "utf-8");

    /** Wrap the next opened handle so its `write` behaves as `impl` says. */
    const interceptWrite = (
      impl: (
        handle: fs.FileHandle,
        data: Buffer,
        offset: number,
        length: number,
      ) => Promise<{ bytesWritten: number }>,
    ) =>
      jest.spyOn(fs, "open").mockImplementationOnce(async (...args) => {
        const spy = jest.spyOn(fs, "open");
        spy.mockRestore();
        const handle = await fs.open(...(args as Parameters<typeof fs.open>));
        const original = handle.write.bind(handle);
        (handle as { write: unknown }).write = (
          data: Buffer,
          offset = 0,
          length = data.length,
        ) =>
          impl(
            { write: original } as unknown as fs.FileHandle,
            data,
            offset,
            length,
          );
        return handle;
      });

    afterEach(() => {
      jest.restoreAllMocks();
    });

    it("keeps writing until every byte has landed", async () => {
      // Two honest short writes: the first takes half, the second the rest.
      let call = 0;
      interceptWrite(async (h, data, offset, length) => {
        call += 1;
        const take = call === 1 ? Math.floor(length / 2) : length;
        return h.write(data, offset, take);
      });

      await writeFileAtomic(target(), payload);

      expect(await listing()).toEqual([
        "monize-backup-daily-2026-01-01.json.gz",
      ]);
      expect(await fs.readFile(target())).toEqual(payload);
      expect(call).toBeGreaterThan(1);
    });

    it("refuses to publish when the file is shorter than the payload", async () => {
      // A `write` that reports success for bytes it did not write. Only the size
      // the kernel reports can catch this, which is why the stat is there and
      // not just the byte count.
      interceptWrite(async (h, data, offset, length) => {
        await h.write(data, offset, Math.floor(length / 2));
        return { bytesWritten: length };
      });

      await expect(writeFileAtomic(target(), payload)).rejects.toThrow(
        /temporary file is \d+ bytes, expected 16/,
      );
      // Neither a partial final artifact nor a temporary file left behind.
      expect(await listing()).toEqual([]);
    });

    it("gives up rather than spinning when a write accepts nothing", async () => {
      interceptWrite(async () => ({ bytesWritten: 0 }));

      await expect(writeFileAtomic(target(), payload)).rejects.toThrow(
        /Write stalled after 0 of 16 bytes/,
      );
      expect(await listing()).toEqual([]);
    });

    it("leaves the previous artifact in place when a write fails", async () => {
      const previous = Buffer.from("the last good backup", "utf-8");
      await writeFileAtomic(target(), previous);

      interceptWrite(async () => ({ bytesWritten: 0 }));
      await expect(writeFileAtomic(target(), payload)).rejects.toThrow();

      // The whole point of renaming: a failed write cannot destroy what was
      // already there.
      expect(await fs.readFile(target())).toEqual(previous);
      expect(await listing()).toEqual([
        "monize-backup-daily-2026-01-01.json.gz",
      ]);
    });
  });

  describe("copyFileAtomic", () => {
    it("promotes a daily backup to a weekly name", async () => {
      const daily = join(dir, "monize-backup-daily-2026-04-14.json.gz");
      const weekly = join(dir, "monize-backup-weekly-2026-04-14.json.gz");
      await fs.writeFile(daily, "payload");

      await copyFileAtomic(daily, weekly);

      expect(await fs.readFile(weekly, "utf-8")).toBe("payload");
      expect(await fs.readFile(daily, "utf-8")).toBe("payload");
    });

    it("leaves the destination alone when the source is missing", async () => {
      const weekly = join(dir, "monize-backup-weekly-2026-04-21.json.gz");
      await fs.writeFile(weekly, "last week's backup");

      await expect(
        copyFileAtomic(join(dir, "does-not-exist.json.gz"), weekly),
      ).rejects.toThrow();

      // `copyFileSync` truncated the destination first, so a failed promotion
      // destroyed last week's artifact and left a partial one in its place.
      expect(await fs.readFile(weekly, "utf-8")).toBe("last week's backup");
    });
  });

  describe("cleanStaleTempFiles", () => {
    it("removes a temporary file older than the grace period", async () => {
      const stale = join(
        dir,
        ".monize-backup-tmp-999-1-monize-backup-daily-2026-04-01.json.gz",
      );
      await fs.writeFile(stale, "partial");
      const old = Date.now() - 2 * 60 * 60 * 1000;
      await fs.utimes(stale, new Date(old), new Date(old));

      const removed = await cleanStaleTempFiles(dir, Date.now());

      expect(removed).toBe(1);
      expect(await listing()).toEqual([]);
    });

    it("leaves a recent temporary file alone", async () => {
      const fresh = join(
        dir,
        ".monize-backup-tmp-999-2-monize-backup-daily-2026-04-02.json.gz",
      );
      await fs.writeFile(fresh, "in progress");

      const removed = await cleanStaleTempFiles(dir, Date.now());

      // Another replica may be writing it right now; pulling it out from under
      // that write would turn a working backup into a failed one.
      expect(removed).toBe(0);
      expect(await listing()).toHaveLength(1);
    });

    it("never touches a real backup", async () => {
      await fs.writeFile(
        join(dir, "monize-backup-daily-2026-04-03.json.gz"),
        "x",
      );
      const old = Date.now() - 365 * 24 * 60 * 60 * 1000;
      await fs.utimes(
        join(dir, "monize-backup-daily-2026-04-03.json.gz"),
        new Date(old),
        new Date(old),
      );

      expect(await cleanStaleTempFiles(dir, Date.now())).toBe(0);
      expect(await listing()).toEqual([
        "monize-backup-daily-2026-04-03.json.gz",
      ]);
    });

    it("does not fail on a directory it cannot read", async () => {
      // Runs at the start of every backup; failing to tidy up must not stop one
      // being taken.
      await expect(
        cleanStaleTempFiles(join(dir, "nope"), Date.now()),
      ).resolves.toBe(0);
    });
  });

  describe("isTempBackupName", () => {
    it("does not classify a real backup as temporary", () => {
      expect(isTempBackupName("monize-backup-daily-2026-04-01.json.gz")).toBe(
        false,
      );
      expect(isTempBackupName("monize-backup-weekly-2026-04-01.mzbe")).toBe(
        false,
      );
    });

    it("classifies what writeFileAtomic creates", async () => {
      // Derived from the writer rather than hardcoded, so the two cannot drift:
      // a temp prefix that stopped matching would make retention count partial
      // files as backups again.
      const target = join(dir, "monize-backup-daily-2026-04-06.json.gz");
      let observed: string | undefined;
      const real = fs.rename;
      const spy = jest
        .spyOn(fs, "rename")
        .mockImplementation(async (from, to) => {
          observed = String(from).split("/").pop();
          return real(from as string, to as string);
        });
      try {
        await writeFileAtomic(target, Buffer.from("x"));
      } finally {
        spy.mockRestore();
      }

      expect(observed).toBeDefined();
      expect(isTempBackupName(observed!)).toBe(true);
    });
  });
});
