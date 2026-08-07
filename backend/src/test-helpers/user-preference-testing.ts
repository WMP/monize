import { UserPreference } from "../users/entities/user-preference.entity";

/**
 * A `user_preferences` repository double that behaves like the row it stands for.
 *
 * The writers this backs no longer read an entity and `save` it whole -- they
 * insert-if-absent and then `UPDATE ... SET <only these columns>`, because saving
 * the whole entity reverts whatever another request changed in between. A mock
 * that only records `save` calls cannot tell those two apart, so it would keep
 * passing after the very regression the change exists to prevent.
 *
 * This one models the semantics instead: `ON CONFLICT DO NOTHING` leaves an
 * existing row alone, a `set()` patch merges into it, and `findOne` returns the
 * result. A spec asserts on the row the user ends up with, and `patches()` is
 * there for the assertion that actually matters -- that a write touched *only*
 * the columns it meant to.
 */
export interface UserPreferenceRepoMock {
  /** Pass as the mock repository for `UserPreference`. */
  repo: Record<string, jest.Mock>;
  /** The stored row, or null when it has never been materialized. */
  row: () => UserPreference | null;
  /** Seed the stored row. `null` means "this user has no preferences row yet". */
  seed: (row: Partial<UserPreference> | null) => void;
  /** Every `set()` patch an UPDATE applied, in order. */
  patches: () => Array<Partial<UserPreference>>;
  /** Values an insert attempted, whether or not it won the conflict. */
  insertAttempts: () => Array<Partial<UserPreference>>;
}

export function createUserPreferenceRepoMock(
  initial: Partial<UserPreference> | null = null,
): UserPreferenceRepoMock {
  let stored: UserPreference | null = initial
    ? (Object.assign(new UserPreference(), initial) as UserPreference)
    : null;
  const patches: Array<Partial<UserPreference>> = [];
  const insertAttempts: Array<Partial<UserPreference>> = [];

  function builder() {
    let mode: "insert" | "update" | null = null;
    let values: Partial<UserPreference> = {};
    const self: Record<string, jest.Mock> = {
      insert: jest.fn(() => {
        mode = "insert";
        return self;
      }),
      update: jest.fn(() => {
        mode = "update";
        return self;
      }),
      values: jest.fn((v: Partial<UserPreference>) => {
        values = v;
        return self;
      }),
      set: jest.fn((v: Partial<UserPreference>) => {
        values = v;
        return self;
      }),
      // `orIgnore()` is TypeORM's `ON CONFLICT DO NOTHING`. It changes nothing
      // here because the insert already respects an existing row -- which is the
      // behaviour it buys in the database.
      orIgnore: jest.fn(() => self),
      where: jest.fn(() => self),
      andWhere: jest.fn(() => self),
      execute: jest.fn(async () => {
        if (mode === "insert") {
          insertAttempts.push(values);
          if (!stored) {
            stored = Object.assign(new UserPreference(), values);
          }
          return { identifiers: [], generatedMaps: [], raw: [] };
        }
        patches.push(values);
        if (stored) {
          Object.assign(stored, values);
          return { affected: 1, generatedMaps: [], raw: [] };
        }
        return { affected: 0, generatedMaps: [], raw: [] };
      }),
    };
    return self;
  }

  const repo: Record<string, jest.Mock> = {
    findOne: jest.fn(async () => stored),
    find: jest.fn(async () => (stored ? [stored] : [])),
    create: jest.fn((data: Partial<UserPreference>) =>
      Object.assign(new UserPreference(), data),
    ),
    save: jest.fn(async (entity: UserPreference) => {
      stored = Object.assign(new UserPreference(), stored ?? {}, entity);
      return stored;
    }),
    delete: jest.fn(async () => {
      stored = null;
      return { affected: 1, raw: [] };
    }),
    createQueryBuilder: jest.fn(() => builder()),
  };

  return {
    repo,
    row: () => stored,
    seed: (value) => {
      stored = value
        ? (Object.assign(new UserPreference(), value) as UserPreference)
        : null;
      patches.length = 0;
      insertAttempts.length = 0;
    },
    patches: () => patches,
    insertAttempts: () => insertAttempts,
  };
}
