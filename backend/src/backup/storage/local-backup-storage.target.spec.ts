import { mkdtempSync, rmSync, writeFileSync } from "fs";
import { promises as fs } from "fs";
import { tmpdir } from "os";
import { join } from "path";
import { ConfigService } from "@nestjs/config";

import { LocalBackupStorageTarget } from "./local-backup-storage.target";
import { BackupStoreLocation } from "./backup-storage.interface";

/**
 * The `local` storage target's own contract: the parts of it the service suite
 * reaches only through a backup run.
 *
 * Everything here runs against a real `mkdtemp`, never a mocked `fs`. What is
 * claimed is what the directory looks like after an operation -- which artifact
 * survived a failed publish, which directory a delete went to -- and a mocked
 * filesystem can only report the call that was made, not the state that was
 * left (`docs/guard-tests.md`, and VER-001 in `docs/verification-contract.md`).
 *
 * The retention arithmetic, the tier promotions and the containment refusals are
 * `auto-backup.service.spec.ts`'s; they are properties of the service that hold
 * on every target, and proving them here again would tie them to this one.
 */
describe("LocalBackupStorageTarget", () => {
  const USER_ID = "22222222-2222-4222-8222-222222222222";
  const ARTIFACT = "monize-backup-daily-2026-09-14.json.gz";

  let root: string;
  let target: LocalBackupStorageTarget;
  let location: BackupStoreLocation;

  const config = (root: string): ConfigService =>
    ({
      get: (key: string) =>
        key === "BACKUP_CONTAINER_DIR" || key === "BACKUP_ALLOWED_ROOTS"
          ? root
          : undefined,
    }) as never;

  beforeEach(async () => {
    root = mkdtempSync(join(tmpdir(), "monize-local-target-"));
    target = new LocalBackupStorageTarget(config(root));
    location = await target.resolveLocation(USER_ID, null, { create: true });
  });

  afterEach(() => {
    rmSync(root, { recursive: true, force: true });
  });

  describe("the namespace", () => {
    it("shards the user's directory under the base, as attachment bytes are", () => {
      expect(location.display).toBe(join(root, "22", "22", USER_ID));
      expect(location.target).toBe("local");
    });

    it("creates nothing on the read path", async () => {
      const other = mkdtempSync(join(tmpdir(), "monize-local-target-read-"));
      try {
        const readOnly = new LocalBackupStorageTarget(config(other));
        const read = await readOnly.resolveLocation(USER_ID, null, {
          create: false,
        });

        await expect(fs.stat(read.display)).rejects.toMatchObject({
          code: "ENOENT",
        });
      } finally {
        rmSync(other, { recursive: true, force: true });
      }
    });

    it("refuses a handle another target produced", async () => {
      const foreign: BackupStoreLocation = { target: "s3", display: "s3://b/" };

      await expect(target.list(foreign)).rejects.toThrow(/not "local"/);
    });
  });

  describe("publishing (INV-BACKUP-006)", () => {
    it("leaves the previous artifact complete when a publish fails", async () => {
      await target.publish(location, ARTIFACT, Buffer.from("the good bytes"));
      // A write that cannot finish: the directory is gone by the time the
      // temporary file is opened, so the rename can never happen.
      const gone = await target.resolveLocation(
        "33333333-3333-4333-8333-333333333333",
        null,
        { create: false },
      );

      await expect(
        target.publish(gone, ARTIFACT, Buffer.from("never published")),
      ).rejects.toThrow();

      const opened = await target.open(location, ARTIFACT);
      expect(opened).not.toBeNull();
      expect(await read(opened!.stream)).toBe("the good bytes");
    });

    it("leaves no artifact under the final name when the publish throws", async () => {
      const gone = await target.resolveLocation(
        "33333333-3333-4333-8333-333333333333",
        null,
        { create: false },
      );

      await expect(
        target.publish(gone, ARTIFACT, Buffer.from("never published")),
      ).rejects.toThrow();

      expect(await target.open(gone, ARTIFACT)).toBeNull();
    });
  });

  describe("listing", () => {
    it("reports the artifacts it holds, with the size and mtime on disk", async () => {
      await target.publish(location, ARTIFACT, Buffer.from("12345"));

      const [entry] = await target.list(location);

      expect(entry).toMatchObject({
        name: ARTIFACT,
        sizeBytes: 5,
        legacy: false,
      });
      // A real mtime from the filesystem. `toBeInstanceOf(Date)` would compare
      // the test realm's constructor against the one `fs.Stats` was built with.
      expect(entry.modifiedAt.getTime()).toBeGreaterThan(0);
    });

    it("never reports the leftovers of an interrupted write", async () => {
      writeFileSync(
        join(location.display, `.monize-backup-tmp-1-2-3-${ARTIFACT}`),
        "half",
      );

      expect(await target.list(location)).toEqual([]);
    });

    it("marks the pre-namespacing flat base as legacy, and the user's own as not", async () => {
      // What a version before per-user folders wrote: no owner in the name.
      writeFileSync(
        join(root, "monize-backup-daily-2026-09-01.json.gz"),
        "old",
      );
      await target.publish(location, ARTIFACT, Buffer.from("mine"));

      const entries = await target.list(location);

      expect(
        entries
          .map((e) => [e.name, e.legacy])
          .sort((a, b) => (a[0] as string).localeCompare(b[0] as string)),
      ).toEqual([
        ["monize-backup-daily-2026-09-01.json.gz", true],
        [ARTIFACT, false],
      ]);
    });

    it("is empty rather than an error when the user has nothing yet", async () => {
      const fresh = await target.resolveLocation(
        "33333333-3333-4333-8333-333333333333",
        null,
        { create: false },
      );

      expect(await target.list(fresh)).toEqual([]);
    });
  });

  describe("opening", () => {
    it("answers null for a name the store does not hold", async () => {
      expect(await target.open(location, ARTIFACT)).toBeNull();
    });

    it("never serves a legacy artifact, which belongs to nobody", async () => {
      writeFileSync(join(root, ARTIFACT), "somebody else's ledger");

      expect(await target.open(location, ARTIFACT)).toBeNull();
    });
  });

  describe("removing", () => {
    it("deletes from the directory the entry was listed in", async () => {
      const legacyName = "monize-backup-daily-2026-09-01.json.gz";
      writeFileSync(join(root, legacyName), "old");
      await target.publish(location, ARTIFACT, Buffer.from("mine"));
      const entries = await target.list(location);

      await target.remove(
        location,
        entries.find((e) => e.legacy)!,
      );

      // The legacy copy went; the user's own is untouched. Routing by anything
      // other than the entry's own `legacy` flag would have deleted whichever
      // directory the caller guessed.
      await expect(fs.stat(join(root, legacyName))).rejects.toMatchObject({
        code: "ENOENT",
      });
      const survivor = await target.open(location, ARTIFACT);
      expect(survivor).not.toBeNull();
      // Read to the end rather than abandoned: a caller that opens an artifact
      // owes it a close, and a stream left open when this directory is torn down
      // reports the disappearance as an unhandled error on whatever is running
      // by then. Draining it also proves the surviving bytes are the right ones.
      expect(await read(survivor!.stream)).toBe("mine");
    });
  });

  describe("the capability report", () => {
    it("counts only the artifacts this user's namespace holds", async () => {
      writeFileSync(
        join(root, "monize-backup-daily-2026-09-01.json.gz"),
        "old",
      );
      await target.publish(location, ARTIFACT, Buffer.from("mine"));

      await expect(target.describeStore(USER_ID, null)).resolves.toMatchObject({
        available: true,
        location: root,
        locationSelectable: true,
        // Not 2: a legacy artifact is not this user's recovery point, so
        // counting it would answer "your store already holds one" falsely.
        artifactCount: 1,
      });
    });

    it("reports a store it cannot write to, with the reason", async () => {
      const missing = new LocalBackupStorageTarget(
        config(join(root, "not-mounted")),
      );

      const capability = await missing.describeStore(
        USER_ID,
        join(root, "also-not-mounted"),
      );

      expect(capability.available).toBe(false);
      expect(capability.reason).toBeTruthy();
      // An unavailable store cannot be counted, and a 0 would read as "empty".
      expect(capability.artifactCount).toBeUndefined();
    });
  });
});

/** The whole of a stream, as a string. */
async function read(stream: NodeJS.ReadableStream): Promise<string> {
  const chunks: Buffer[] = [];
  for await (const chunk of stream) {
    chunks.push(Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk));
  }
  return Buffer.concat(chunks).toString();
}
