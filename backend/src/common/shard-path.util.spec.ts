import { isShardableId, shardedSegments } from "./shard-path.util";

describe("shard-path.util", () => {
  const uuid = "0a1b2c3d-4e5f-6071-8293-a4b5c6d7e8f9";

  describe("isShardableId", () => {
    it("accepts a UUID", () => {
      expect(isShardableId(uuid)).toBe(true);
    });

    it("rejects ids carrying a separator, a dot or a NUL", () => {
      expect(isShardableId("../etc/passwd")).toBe(false);
      expect(isShardableId("a/b")).toBe(false);
      expect(isShardableId("..")).toBe(false);
      expect(isShardableId("file.json")).toBe(false);
      expect(isShardableId("abcd\0efgh")).toBe(false);
    });

    it("rejects ids too short to fill both shard levels", () => {
      expect(isShardableId("abc")).toBe(false);
      expect(isShardableId("abcd")).toBe(true);
    });

    it("rejects non-strings and blanks", () => {
      expect(isShardableId(null)).toBe(false);
      expect(isShardableId(undefined)).toBe(false);
      expect(isShardableId("")).toBe(false);
      expect(isShardableId(42 as unknown as string)).toBe(false);
    });
  });

  describe("shardedSegments", () => {
    it("fans out on the first four characters", () => {
      expect(shardedSegments(uuid)).toEqual(["0a", "1b", uuid]);
    });

    it("spreads two ids that differ in their first characters", () => {
      const [a] = shardedSegments("ff112233-4455-6677-8899-aabbccddeeff");
      const [b] = shardedSegments(uuid);
      expect(a).not.toBe(b);
    });

    it("throws rather than emitting a traversable segment", () => {
      expect(() => shardedSegments("../../etc")).toThrow(/safe id alphabet/);
    });
  });
});
