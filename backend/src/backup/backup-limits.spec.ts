import {
  DEFAULT_EXPORT_BUFFER_LIMIT_BYTES,
  DEFAULT_RESTORE_EXPANDED_LIMIT_BYTES,
  parseByteSize,
  resolveByteLimit,
} from "./backup-limits";

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
      expect(
        resolveByteLimit("256mb", DEFAULT_RESTORE_EXPANDED_LIMIT_BYTES),
      ).toBe(256 * 1024 * 1024);
    });

    it("falls back and reports when it does not", () => {
      const onInvalid = jest.fn();
      expect(
        resolveByteLimit(
          "enormous",
          DEFAULT_EXPORT_BUFFER_LIMIT_BYTES,
          onInvalid,
        ),
      ).toBe(DEFAULT_EXPORT_BUFFER_LIMIT_BYTES);
      expect(onInvalid).toHaveBeenCalledTimes(1);
      expect(onInvalid.mock.calls[0][0]).toContain("enormous");
    });

    it("falls back silently when nothing is configured", () => {
      const onInvalid = jest.fn();
      expect(
        resolveByteLimit(
          undefined,
          DEFAULT_RESTORE_EXPANDED_LIMIT_BYTES,
          onInvalid,
        ),
      ).toBe(DEFAULT_RESTORE_EXPANDED_LIMIT_BYTES);
      expect(resolveByteLimit("", 123, onInvalid)).toBe(123);
      // An unset variable is not a misconfiguration; warning on it trains people
      // to ignore the warning that matters.
      expect(onInvalid).not.toHaveBeenCalled();
    });
  });
});
