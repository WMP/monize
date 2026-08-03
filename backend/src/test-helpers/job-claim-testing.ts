import { JobClaimService } from "../common/jobs/job-claim.service";

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
