import {
  Column,
  CreateDateColumn,
  Entity,
  Index,
  JoinColumn,
  ManyToOne,
  PrimaryGeneratedColumn,
} from "typeorm";
import { User } from "../../../users/entities/user.entity";

/**
 * One durable claim on a piece of per-user work that must happen at most once.
 *
 * `ScheduleModule.forRoot()` lives in the API process, so **every backend
 * replica fires every cron** (`docs/cron-jobs.md`). A guard held in process
 * memory -- a `Set` of user ids, a boolean -- is therefore not a guard at all:
 * each replica has its own. Nor is "query for a row like the one I am about to
 * write": that is a check-then-act, and both replicas pass it.
 *
 * This table is the coordination point those jobs were missing. The unique key
 * `(claim_type, user_id, claim_key)` makes the claim itself the atomic
 * operation, so exactly one replica may send the email, call the AI provider or
 * issue the token, and the loser learns it lost from the database rather than
 * from its own memory.
 */
@Entity("job_claims")
@Index(["claimType", "userId", "claimKey"], { unique: true })
export class JobClaim {
  @PrimaryGeneratedColumn("uuid")
  id: string;

  /** Which job this claim belongs to, e.g. `bill_reminder`. */
  @Column({ type: "varchar", name: "claim_type", length: 64 })
  claimType: string;

  @Column({ type: "uuid", name: "user_id" })
  userId: string;

  @ManyToOne(() => User, { onDelete: "CASCADE" })
  @JoinColumn({ name: "user_id" })
  user?: User;

  /**
   * What within that job is being claimed -- a local delivery date, a window
   * hash, a generation bucket. Two claims with the same key are the same work.
   */
  @Column({ type: "varchar", name: "claim_key", length: 200 })
  claimKey: string;

  @CreateDateColumn({ name: "claimed_at" })
  claimedAt: Date;

  /**
   * When a lease claim stops protecting the work. `null` means the claim is
   * permanent: a "once per user per day" delivery, which nothing may retake.
   * A lease whose holder died is retaken once this passes.
   */
  @Column({ type: "timestamp", name: "expires_at", nullable: true })
  expiresAt: Date | null;
}
