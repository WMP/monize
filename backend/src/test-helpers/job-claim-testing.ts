import { JobClaimService } from "../common/jobs/job-claim.service";
import { UserMaintenanceService } from "../common/jobs/user-maintenance.service";

/**
 * A `JobClaimService` double that always wins the claim.
 *
 * Typed as `jest.Mocked<JobClaimService>` rather than
 * `Record<string, jest.Mock>` on purpose: this is one of our own services, so
 * `tsc` should reject a return shape the real method cannot produce. An untyped
 * double here would let a spec assert against fiction -- see the mock rule in
 * `backend/CLAUDE.md`.
 *
 * Winning by default keeps the existing behaviour of every cron spec written
 * before the claim existed. A spec that wants the *loser* path -- the one that
 * proves a second replica sends nothing -- sets `claimOnce`/`claimLease` to
 * resolve false, which is the assertion worth writing.
 */
export type JobClaimMock = jest.Mocked<
  Pick<JobClaimService, "claimOnce" | "claimLease" | "release">
>;

export function createJobClaimMock(): JobClaimMock {
  return {
    claimOnce: jest.fn().mockResolvedValue(true),
    claimLease: jest.fn().mockResolvedValue(true),
    release: jest.fn().mockResolvedValue(undefined),
  };
}

/** Provider entry for `Test.createTestingModule({ providers: [...] })`. */
export function jobClaimProvider(mock: JobClaimMock = createJobClaimMock()): {
  provide: typeof JobClaimService;
  useValue: JobClaimMock;
} {
  return { provide: JobClaimService, useValue: mock };
}

/**
 * A `UserMaintenanceService` double for the surfaces that consult it.
 *
 * Defaults to "not under maintenance" and to running the body, so a spec written
 * before the lease existed behaves as it did. The interesting assertions are the
 * refusals -- set `isUnderMaintenance` to resolve true, or make
 * `withMaintenanceLease` reject, and check that the destructive operation wrote
 * nothing.
 */
export type UserMaintenanceMock = jest.Mocked<
  Pick<UserMaintenanceService, "isUnderMaintenance" | "withMaintenanceLease">
>;

export function createUserMaintenanceMock(): UserMaintenanceMock {
  return {
    isUnderMaintenance: jest.fn().mockResolvedValue(false),
    withMaintenanceLease: jest.fn(
      async (_userId: string, _operation: string, fn: () => Promise<unknown>) =>
        fn(),
    ) as UserMaintenanceMock["withMaintenanceLease"],
  };
}

/** Provider entry for `Test.createTestingModule({ providers: [...] })`. */
export function userMaintenanceProvider(
  mock: UserMaintenanceMock = createUserMaintenanceMock(),
): {
  provide: typeof UserMaintenanceService;
  useValue: UserMaintenanceMock;
} {
  return { provide: UserMaintenanceService, useValue: mock };
}
