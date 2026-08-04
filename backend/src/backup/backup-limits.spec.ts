import {
  MEMORY_SHARE_PER_RESTORE_UPLOAD,
  PEAK_MULTIPLE,
  UPLOAD_WARNING_SHARE,
  deriveDefaultLimitBytes,
  detectProcessMemoryLimitBytes,
  parseByteSize,
  resolveByteLimit,
  resolveRestoreUploadLimitBytes,
  warnIfLimitExceedsMemory,
  warnIfRestoreUploadLimitIsCramped,
} from "./backup-limits";

const MIB = 1024 * 1024;

describe("backup size limits", () => {
  describe("parseByteSize", () => {
    it("reads the units the deployment docs use", () => {
      expect(parseByteSize("1024")).toBe(1024);
      expect(parseByteSize("512kb")).toBe(512 * 1024);
      expect(parseByteSize("400mb")).toBe(400 * 1024 * 1024);
      expect(parseByteSize("2gb")).toBe(2 * 1024 * 1024 * 1024);
    });

    it("is case- and space-insensitive", () => {
      expect(parseByteSize(" 512MB ")).toBe(512 * 1024 * 1024);
      expect(parseByteSize("1.5gb")).toBe(1.5 * 1024 * 1024 * 1024);
    });

    it("returns null for anything it cannot read", () => {
      // Not zero and not Infinity: either would be a ceiling that is not there.
      // A caller that cannot read the value must fall back to its default.
      for (const bad of ["", "  ", "mb", "-5mb", "0", "0mb", "512tb", "abc"]) {
        expect(parseByteSize(bad)).toBeNull();
      }
      expect(parseByteSize(undefined)).toBeNull();
    });
  });

  describe("resolveByteLimit", () => {
    it("uses the configured value when it parses", () => {
      expect(resolveByteLimit("256mb", 999 * MIB)).toBe(256 * 1024 * 1024);
    });

    it("falls back and reports when it does not", () => {
      const onInvalid = jest.fn();
      expect(resolveByteLimit("enormous", 128 * MIB, onInvalid)).toBe(
        128 * MIB,
      );
      expect(onInvalid).toHaveBeenCalledTimes(1);
      expect(onInvalid.mock.calls[0][0]).toContain("enormous");
    });

    it("falls back silently when nothing is configured", () => {
      const onInvalid = jest.fn();
      expect(resolveByteLimit(undefined, 128 * MIB, onInvalid)).toBe(128 * MIB);
      expect(resolveByteLimit("", 123, onInvalid)).toBe(123);
      // An unset variable is not a misconfiguration; warning on it trains people
      // to ignore the warning that matters.
      expect(onInvalid).not.toHaveBeenCalled();
    });
  });

  /**
   * The defaults used to be fixed numbers -- 512 MiB of export JSON, 1 GiB of
   * expanded restore -- while the chart's default backend memory limit is
   * 400 MiB. Neither could ever fire: the pod was OOM-killed first, which is the
   * outcome the ceilings existed to prevent. A ceiling has to be smaller than the
   * thing it protects, and only the container knows how big that is.
   */
  describe("deriveDefaultLimitBytes", () => {
    it("stays well under the container's memory limit", () => {
      // The case that was broken: the chart's default backend.
      const derived = deriveDefaultLimitBytes(400 * MIB);
      expect(derived).toBeLessThan(400 * MIB);
      // And not merely under it -- a buffered export holds several copies of the
      // payload at peak, on top of the ~140 MiB the process needs anyway.
      expect(derived).toBeLessThanOrEqual(Math.floor(400 * MIB * 0.25));
    });

    it("scales with a larger container instead of staying pinned", () => {
      expect(deriveDefaultLimitBytes(2048 * MIB)).toBeGreaterThan(
        deriveDefaultLimitBytes(400 * MIB),
      );
    });

    it("does not derive a limit too small to be usable", () => {
      // A 128 MiB dev container would otherwise derive 32 MiB and refuse
      // ordinary datasets; below the floor the operator should be choosing.
      expect(deriveDefaultLimitBytes(128 * MIB)).toBe(64 * MIB);
    });

    it("caps the derived value however large the container", () => {
      // Past a point the ceiling stops being a guard against a hostile payload.
      expect(deriveDefaultLimitBytes(64 * 1024 * MIB)).toBe(1024 * MIB);
    });

    it("falls back to a modest default when the limit is unknown", () => {
      // Bare metal, a dev machine, an unconstrained container: nothing is known,
      // and a ceiling that only fires on an enormous payload still beats none.
      expect(deriveDefaultLimitBytes(null)).toBe(256 * MIB);
    });
  });

  describe("detectProcessMemoryLimitBytes", () => {
    it("returns a positive number or null, never a sentinel", () => {
      // cgroup v2 writes the literal "max" and v1 a rounded 2^63 when
      // unconstrained. Deriving a ceiling from 8 exbibytes is the same as having
      // none, so both must read as unknown.
      const limit = detectProcessMemoryLimitBytes();
      if (limit !== null) {
        expect(limit).toBeGreaterThan(0);
        expect(limit).toBeLessThan(Number.MAX_SAFE_INTEGER);
      }
    });
  });

  /**
   * `express.raw` buffers the whole body before the controller, the guards, the
   * authentication lookup and every service ceiling, so this is the earliest and
   * therefore the only limit that can protect the process from an oversized
   * upload. It defaulted to the string "500mb" against a 400 MiB pod.
   */
  describe("resolveRestoreUploadLimitBytes", () => {
    /**
     * The wire bytes are not the cost (F3R5-002).
     *
     * This was half the container on the reasoning that a compressed upload is one
     * buffer. The request that uploads it then holds the envelope, the decipher
     * output, the concatenated plaintext, the decompressed payload, the string and
     * the parsed graph -- so half of a 400 MiB container to the wire is
     * PEAK_MULTIPLE times that at peak, and a single legal request could not fit
     * the pod it was sized for.
     */
    it("leaves room for the peak, not just the wire bytes", () => {
      const container = 400 * MIB;
      const limit = resolveRestoreUploadLimitBytes(undefined, container);

      // The *peak* is what has to fit the share the container allots.
      expect(limit * PEAK_MULTIPLE).toBeLessThanOrEqual(
        Math.floor(container * MEMORY_SHARE_PER_RESTORE_UPLOAD),
      );
      // And the old figure would not have: 200 MiB of wire is 600 MiB at peak on
      // a 400 MiB pod.
      expect(limit).toBeLessThan(200 * MIB);
    });

    it("still allows a usable upload on the chart's default backend", () => {
      // A ceiling small enough to refuse ordinary backups is an outage, not a
      // protection. On a 400 MiB pod the safe value is ~66 MiB, which is roomy.
      expect(
        resolveRestoreUploadLimitBytes(undefined, 400 * MIB),
      ).toBeGreaterThanOrEqual(64 * MIB);
    });

    it("scales with the container rather than being fixed", () => {
      const small = resolveRestoreUploadLimitBytes(undefined, 512 * MIB);
      const large = resolveRestoreUploadLimitBytes(undefined, 4096 * MIB);
      expect(large).toBeGreaterThan(small);
    });

    it("honours an explicit operator value", () => {
      expect(resolveRestoreUploadLimitBytes("64mb", 400 * MIB)).toBe(64 * MIB);
    });

    it("falls back when the container limit is unknown", () => {
      expect(resolveRestoreUploadLimitBytes(undefined, null)).toBe(256 * MIB);
    });

    /**
     * F3R6-005: a usability floor must never win over the safety maximum. The old
     * derivation applied `max(64 MiB, safe)`, so on a 128 MiB pod it returned
     * 64 MiB whose modeled peak (192 MiB) exceeded the whole container.
     */
    it.each([64, 128, 192, 256, 400, 512])(
      "keeps the modeled peak inside the container's share at %i MiB",
      (containerMib) => {
        const container = containerMib * MIB;
        const limit = resolveRestoreUploadLimitBytes(undefined, container);
        // The invariant the floor used to break.
        expect(limit * PEAK_MULTIPLE).toBeLessThanOrEqual(
          Math.floor(container * MEMORY_SHARE_PER_RESTORE_UPLOAD),
        );
        // And never zero: some restore, however small, must be possible.
        expect(limit).toBeGreaterThan(0);
      },
    );

    it("derives a smaller, still-safe limit on a cramped container", () => {
      // 128 MiB: safe = 128 * 0.5 / 3 = 21 MiB, not the old floored 64 MiB.
      const limit = resolveRestoreUploadLimitBytes(undefined, 128 * MIB);
      expect(limit).toBeLessThan(64 * MIB);
      expect(limit * PEAK_MULTIPLE).toBeLessThanOrEqual(64 * MIB);
    });
  });

  describe("warnIfRestoreUploadLimitIsCramped", () => {
    it("warns when the derived limit is below the usable threshold", () => {
      const onWarn = jest.fn();
      const limit = resolveRestoreUploadLimitBytes(undefined, 128 * MIB);
      warnIfRestoreUploadLimitIsCramped(limit, undefined, onWarn);
      expect(onWarn).toHaveBeenCalledTimes(1);
      expect(String(onWarn.mock.calls[0][0])).toMatch(/refused|memory/i);
    });

    it("stays quiet on a roomy container", () => {
      const onWarn = jest.fn();
      const limit = resolveRestoreUploadLimitBytes(undefined, 400 * MIB);
      warnIfRestoreUploadLimitIsCramped(limit, undefined, onWarn);
      expect(onWarn).not.toHaveBeenCalled();
    });

    it("stays quiet when the operator set the value themselves", () => {
      // A cramped limit the operator chose is their decision, not a surprise.
      const onWarn = jest.fn();
      warnIfRestoreUploadLimitIsCramped(8 * MIB, "8mb", onWarn);
      expect(onWarn).not.toHaveBeenCalled();
    });
  });

  describe("warnIfLimitExceedsMemory", () => {
    it("warns when a configured ceiling cannot protect the process", () => {
      const onWarn = jest.fn();
      warnIfLimitExceedsMemory(
        "BACKUP_EXPORT_BUFFER_LIMIT",
        2048 * MIB,
        onWarn,
        400 * MIB,
      );
      expect(onWarn).toHaveBeenCalledTimes(1);
      const message = onWarn.mock.calls[0][0] as string;
      // Names the variable, both numbers, and what will actually happen -- an
      // operator should not have to infer "OOM-killed" from "check your config".
      expect(message).toContain("BACKUP_EXPORT_BUFFER_LIMIT");
      expect(message).toContain("2048MiB");
      expect(message).toContain("400MiB");
      expect(message).toMatch(/OOM-killed/);
    });

    it("stays quiet for a limit the container can absorb", () => {
      const onWarn = jest.fn();
      warnIfLimitExceedsMemory("X", 64 * MIB, onWarn, 400 * MIB);
      expect(onWarn).not.toHaveBeenCalled();
    });

    it("stays quiet when there is no memory limit to compare against", () => {
      const onWarn = jest.fn();
      warnIfLimitExceedsMemory("X", 8192 * MIB, onWarn, null);
      expect(onWarn).not.toHaveBeenCalled();
    });

    /**
     * The upload limit is derived from half the container, and this check
     * defaulted to a quarter -- so wiring it up as-is would have warned on every
     * deployment about a number the code itself chose. That is why the check was
     * missing from `main.ts` rather than merely unwired, and why the threshold is
     * a parameter: a limit is compared against the share its own default came
     * from.
     */
    it("does not warn about a limit it derived itself", () => {
      const onWarn = jest.fn();
      const container = 400 * MIB;
      warnIfLimitExceedsMemory(
        "BACKUP_RESTORE_LIMIT",
        resolveRestoreUploadLimitBytes(undefined, container),
        onWarn,
        container,
        UPLOAD_WARNING_SHARE,
      );
      expect(onWarn).not.toHaveBeenCalled();
    });

    it("still warns about an upload override the container cannot absorb", () => {
      const onWarn = jest.fn();
      warnIfLimitExceedsMemory(
        "BACKUP_RESTORE_LIMIT",
        2048 * MIB,
        onWarn,
        400 * MIB,
        UPLOAD_WARNING_SHARE,
      );
      expect(onWarn).toHaveBeenCalledTimes(1);
      const message = onWarn.mock.calls[0][0] as string;
      expect(message).toContain("BACKUP_RESTORE_LIMIT");
      // The figure suggested is in the units the operator sets -- wire bytes --
      // and equals the derived default. Suggesting the peak share instead would
      // tell them a number that OOM-kills the pod.
      expect(message).toContain(
        `${Math.round(resolveRestoreUploadLimitBytes(undefined, 400 * MIB) / MIB)}MiB`,
      );
    });
  });
});
