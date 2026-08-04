import { Column, Entity, PrimaryColumn } from "typeorm";

/**
 * One row per **spent** OIDC step-up proof.
 *
 * The row's existence is the whole record: nothing reads it back, and the insert
 * is the claim. A process-local `Map` only enforces single use inside one Node
 * process, so on a deployment with several backend replicas two destructive
 * requests carrying the same proof could be routed to different replicas and both
 * be told yes. `INSERT ... ON CONFLICT DO NOTHING` on the primary key is atomic
 * across every replica: exactly one wins.
 *
 * Transient auth bookkeeping with a five-minute lifetime, not user content --
 * excluded from backups beside `refresh_tokens` and `oauth_payloads`.
 */
@Entity("oidc_step_up_claims")
export class OidcStepUpClaim {
  /** The proof's `jti`. Primary key, which is what makes the claim atomic. */
  @PrimaryColumn({ type: "text" })
  jti: string;

  @Column({ name: "user_id", type: "uuid" })
  userId: string;

  @Column({ type: "text" })
  purpose: string;

  @Column({
    name: "claimed_at",
    type: "timestamptz",
    default: () => "now()",
  })
  claimedAt: Date;

  /**
   * The proof's own `exp`; past it, the row is dead weight. The next claim's
   * INSERT sweeps expired rows, but that DELETE runs under the caller's scoped
   * context, so at `RLS_MODE=on` it clears only the current user's expired rows
   * -- a user who never steps up again leaves theirs behind for a system-context
   * retention job to reap. Single use never depends on the sweep; the primary
   * key does. Indexed by `idx_oidc_step_up_claims_expires` in `schema.sql` --
   * the DDL is managed there, not by `synchronize`, so no `@Index()` here would
   * create it.
   */
  @Column({ name: "expires_at", type: "timestamptz" })
  expiresAt: Date;
}
