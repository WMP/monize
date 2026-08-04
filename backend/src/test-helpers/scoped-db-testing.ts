import { EntityManager, EntityTarget } from "typeorm";

/**
 * Unit-test harness for services refactored onto `withScopedDb` (RLS tasks R1-R7).
 *
 * Real `withScopedDb` refuses to run without an ambient request/user/system
 * context and opens a real transaction; unit tests need neither. Specs mock
 * the module so `withScopedDb(ds, fn)` simply delegates to the (mock)
 * `dataSource.transaction(fn)`:
 *
 *   jest.mock("../common/db/scoped-db", () =>
 *     jest.requireActual("../test-helpers/scoped-db-testing").scopedDbMockModule(),
 *   );
 *
 * and build the manager/dataSource pair with `createScopedDbMocks`, routing
 * `manager.getRepository(Entity)` to the same per-entity mock repositories the
 * specs already assert against. The context-throw and GUC-emission behavior of
 * the real withScopedDb stays covered by its own spec (scoped-db.spec.ts).
 */

/** Mock EntityManager: every method a jest.fn, plus entity-routed getRepository. */
export type ManagerMock = Record<string, jest.Mock>;

/** Mock DataSource whose transaction() runs the callback with the ManagerMock. */
export interface DataSourceMock {
  transaction: jest.Mock;
  query: jest.Mock;
  manager: ManagerMock;
}

/**
 * Module factory for `jest.mock` of `src/common/db/scoped-db`. The replacement
 * `withScopedDb` skips the ambient-context check and runs the callback through the
 * caller-provided (mock) `dataSource.transaction`, so specs can both drive the
 * callback (via `createScopedDbMocks`) and assert transactional grouping (via
 * `dataSource.transaction.mock.calls`).
 *
 * An explicit isolation level is forwarded in TypeORM's own argument order
 * (`transaction(isolation, fn)`), so a spec can still assert that a caller asked
 * for SERIALIZABLE -- registration's first-user-admin race depends on it, and
 * swallowing the argument here would make that assertion unwritable.
 */
export function scopedDbMockModule() {
  return {
    withScopedDb: jest.fn(
      (
        dataSource: {
          transaction: (
            ...args:
              | [(m: unknown) => unknown]
              | [string, (m: unknown) => unknown]
          ) => unknown;
        },
        fn: (m: unknown) => unknown,
        isolation?: string,
      ) =>
        isolation
          ? dataSource.transaction(isolation, fn)
          : dataSource.transaction(fn),
    ),
  };
}

/**
 * A `manager.query` double that models the one piece of connection state
 * `withElevatedDb` reads back: `app.bypass_rls`.
 *
 * A `jest.fn().mockResolvedValue([])` answers the re-entrancy probe with "not
 * elevated" forever, so every nested elevated window opens and closes its own
 * bracket -- which is the behaviour the real helper deliberately does not have.
 * A spec asserting the bracket shape against that mock is asserting fiction:
 * the inner `finally` it fails to see is exactly the bug that would return the
 * outer window to tenant-filtered reads halfway through.
 */
export function bypassAwareQueryMock(
  initiallyElevated = false,
): jest.Mock<Promise<unknown>, [string]> {
  let bypass = initiallyElevated ? "on" : "";
  return jest.fn(async (sql: string) => {
    if (sql.includes("current_setting('app.bypass_rls'")) {
      return [{ bypass }];
    }
    if (sql.includes("set_config('app.bypass_rls', 'on'")) bypass = "on";
    if (sql.includes("set_config('app.bypass_rls', ''")) bypass = "";
    return [];
  });
}

/**
 * Build the mock manager + dataSource pair for a spec.
 *
 * @param repos entity-class -> mock-repository entries backing
 *   `manager.getRepository`. Entities the service never asks for may be
 *   omitted; asking for an unregistered entity throws with a clear message so
 *   the spec failure names the missing mock instead of dying on `undefined`.
 */
export function createScopedDbMocks(
  repos: Array<[EntityTarget<unknown>, Record<string, jest.Mock>]> = [],
): { manager: ManagerMock; dataSource: DataSourceMock } {
  const repoMap = new Map<EntityTarget<unknown>, Record<string, jest.Mock>>(
    repos,
  );

  const manager: ManagerMock = {
    getRepository: jest.fn((entity: EntityTarget<unknown>) => {
      const repo = repoMap.get(entity);
      if (!repo) {
        const name =
          typeof entity === "function" ? entity.name : String(entity);
        throw new Error(
          `createScopedDbMocks: no mock repository registered for entity "${name}"`,
        );
      }
      return repo;
    }),
    // Direct EntityManager methods, for code converted from queryRunner.manager.
    find: jest.fn(),
    findBy: jest.fn(),
    findOne: jest.fn(),
    findOneOrFail: jest.fn(),
    count: jest.fn(),
    create: jest.fn(),
    merge: jest.fn(),
    save: jest.fn(),
    update: jest.fn(),
    delete: jest.fn(),
    remove: jest.fn(),
    query: jest.fn(),
    createQueryBuilder: jest.fn(),
  };

  const dataSource: DataSourceMock = {
    transaction: jest.fn(
      async (fn: (m: EntityManager) => unknown) =>
        fn(manager as unknown as EntityManager) as Promise<unknown>,
    ),
    query: jest.fn(),
    manager,
  };

  return { manager, dataSource };
}
