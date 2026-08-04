import {
  deriveDefaultLimitBytes,
  detectProcessMemoryLimitBytes,
  parseByteSize,
  resolveByteLimit,
  resolveRestoreUploadLimitBytes,
  warnIfLimitExceedsMemory,
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
    it("stays under the container's memory limit by default", () => {
      const limit = resolveRestoreUploadLimitBytes(undefined, 400 * MIB);
      expect(limit).toBeLessThan(400 * MIB);
      // Half rather than a quarter: a compressed upload is one buffer, not the
      // several a buffered export holds at peak.
      expect(limit).toBe(200 * MIB);
    });

    it("is more generous than the buffered-export ceiling", () => {
      expect(
        resolveRestoreUploadLimitBytes(undefined, 400 * MIB),
      ).toBeGreaterThan(deriveDefaultLimitBytes(400 * MIB));
    });

    it("honours an explicit operator value", () => {
      expect(resolveRestoreUploadLimitBytes("64mb", 400 * MIB)).toBe(64 * MIB);
    });

    it("falls back when the container limit is unknown", () => {
      expect(resolveRestoreUploadLimitBytes(undefined, null)).toBe(256 * MIB);
    });

    it("never derives a value below the floor", () => {
      expect(resolveRestoreUploadLimitBytes(undefined, 64 * MIB)).toBe(
        64 * MIB,
      );
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
  });
});
