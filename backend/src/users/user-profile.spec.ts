import { readdirSync, readFileSync, statSync } from "fs";
import { join } from "path";
import {
  PROFILE_FIELDS,
  SELF_ONLY_PROFILE_FIELDS,
  toDelegatedUserProfile,
  toUserProfile,
} from "./user-profile";
import {
  excludedUserFields,
  fullyPopulatedUser,
  nonProfileUserFields,
} from "./user-profile.test-util";

describe("user profile serialization", () => {
  describe("toUserProfile", () => {
    it("emits exactly the allowlist plus hasPassword", () => {
      const profile = toUserProfile(fullyPopulatedUser());

      expect(Object.keys(profile).sort()).toEqual(
        [...PROFILE_FIELDS, "hasPassword"].sort(),
      );
    });

    it("drops every @Exclude() column on the entity", () => {
      const profile = toUserProfile(fullyPopulatedUser()) as Record<
        string,
        unknown
      >;
      const excluded = excludedUserFields();

      // Guards the guard: an entity that lost its decorators would make the
      // loop below vacuous and this suite would pass while leaking everything.
      expect(excluded.length).toBeGreaterThanOrEqual(11);
      for (const field of excluded) {
        expect(profile).not.toHaveProperty(field);
      }
    });

    it("drops every column the allowlist does not name", () => {
      const profile = toUserProfile(fullyPopulatedUser()) as Record<
        string,
        unknown
      >;
      for (const field of nonProfileUserFields()) {
        expect(profile).not.toHaveProperty(field);
      }
    });

    it("serializes no value that came from a secret column", () => {
      // The fixture marks every secret with a LEAK- prefix, so this catches a
      // secret copied into a differently named field as well as one passed
      // through -- neither of which a key-name assertion sees.
      const serialized = JSON.stringify(toUserProfile(fullyPopulatedUser()));
      expect(serialized).not.toContain("LEAK-");
    });

    it("reports hasPassword without the hash", () => {
      expect(toUserProfile(fullyPopulatedUser())).toMatchObject({
        hasPassword: true,
      });
      expect(
        toUserProfile(fullyPopulatedUser({ passwordHash: null })),
      ).toMatchObject({ hasPassword: false });
    });

    it("leaves a column absent when the caller selected a narrower row", () => {
      const profile = toUserProfile({ id: "u1", email: "a@b.c" }) as Record<
        string,
        unknown
      >;

      expect(profile).toEqual({
        id: "u1",
        email: "a@b.c",
        hasPassword: false,
      });
      expect(profile).not.toHaveProperty("role");
    });
  });

  describe("toDelegatedUserProfile", () => {
    it("keeps identification and drops the owner's credential state", () => {
      const delegated = toDelegatedUserProfile(fullyPopulatedUser()) as Record<
        string,
        unknown
      >;

      expect(delegated).toMatchObject({
        id: "owner-1",
        email: "owner@example.com",
        firstName: "Olivia",
      });
      for (const field of SELF_ONLY_PROFILE_FIELDS) {
        expect(delegated).not.toHaveProperty(field);
      }
    });

    it("drops every @Exclude() column as well", () => {
      const delegated = toDelegatedUserProfile(fullyPopulatedUser()) as Record<
        string,
        unknown
      >;
      for (const field of nonProfileUserFields()) {
        expect(delegated).not.toHaveProperty(field);
      }
      expect(JSON.stringify(delegated)).not.toContain("LEAK-");
    });
  });
});

/**
 * The mechanical half of P2-003. The defect was not that one list was short --
 * it was that five call sites each wrote their own list, so the shortest one
 * decided what leaked. A test that only checks `toUserProfile` cannot see the
 * sixth site somebody adds next month, so scan the source instead.
 */
describe("ad-hoc user sanitizers", () => {
  const SRC = join(__dirname, "..");

  /** The shape of the removed sanitizers: destructure the hash away, spread the rest. */
  const AD_HOC_SANITIZER =
    /passwordHash\s*,[\s\S]{0,600}?\.\.\.\s*\w+\s*\}\s*=/;

  const walk = (dir: string): string[] =>
    readdirSync(dir).flatMap((entry) => {
      const full = join(dir, entry);
      if (statSync(full).isDirectory()) {
        return entry === "node_modules" ? [] : walk(full);
      }
      return full.endsWith(".ts") && !full.endsWith(".spec.ts") ? [full] : [];
    });

  it("exist nowhere outside user-profile.ts", () => {
    const offenders = walk(SRC).filter((file) => {
      if (file.endsWith(join("users", "user-profile.ts"))) return false;
      return AD_HOC_SANITIZER.test(readFileSync(file, "utf8"));
    });

    expect(offenders.map((f) => f.slice(SRC.length + 1))).toEqual([]);
  });
});
