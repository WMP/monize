import {
  Entity,
  Column,
  PrimaryGeneratedColumn,
  CreateDateColumn,
  UpdateDateColumn,
  ManyToOne,
  JoinColumn,
} from "typeorm";
import { Exclude } from "class-transformer";
import { User } from "../../users/entities/user.entity";

@Entity("emergency_access_contacts")
export class EmergencyAccessContact {
  @PrimaryGeneratedColumn("uuid")
  id: string;

  @Column({ name: "owner_user_id", type: "uuid" })
  ownerUserId: string;

  @Column({ name: "first_name", type: "varchar", length: 100 })
  firstName: string;

  @Column({ type: "varchar", length: 255 })
  email: string;

  @Column({ name: "claim_token_hash", type: "varchar", nullable: true })
  @Exclude()
  claimTokenHash: string | null;

  @Column({ name: "claim_token_expires_at", type: "timestamp", nullable: true })
  claimTokenExpiresAt: Date | null;

  @Column({ name: "claim_token_used_at", type: "timestamp", nullable: true })
  claimTokenUsedAt: Date | null;

  @Column({ name: "claim_voided_reason", type: "varchar", nullable: true })
  claimVoidedReason: string | null;

  /**
   * When the notice for {@link notifiedGrantGeneration} was actually sent -- the
   * delivery record, kept apart from the claim that coordinates the send.
   *
   * A claim answers "may I do this now" and cannot also answer "has this been
   * done", because the second question has to outlive the process that asked
   * the first. That is how the daily check finds a grant a killed replica never
   * delivered -- without re-issuing a token for a contact who already holds a
   * working link (audit FV4-004).
   *
   * A timestamp for operators, **not a predicate**. It used to be both, and
   * because nothing ever set it back to NULL that made emergency access fire at
   * most once per contact row for the row's lifetime (audit RRV4-004). "Is a link
   * still owed" is now the generation comparison below; the two columns are written
   * by one statement (`markContactNotified`) and read by one query
   * (`contactsAwaitingNotice`), which is what keeps them from drifting apart.
   */
  @Column({ name: "claim_notified_at", type: "timestamp", nullable: true })
  claimNotifiedAt: Date | null;

  /**
   * The grant cycle whose notice this contact received; NULL for never notified.
   *
   * Owed a link whenever this differs from the owner's
   * `EmergencyAccessSettings.grantGeneration`. Every path that re-arms monitoring
   * -- the owner returning, a disable/re-enable, a manual reset -- leaves this
   * column alone and the next grant advances the owner's generation past it, so a
   * re-armed grant owes every contact again without any of those paths having to
   * say so.
   */
  @Column({
    name: "notified_grant_generation",
    type: "int",
    nullable: true,
  })
  notifiedGrantGeneration: number | null;

  /**
   * The undelivered credential -- the raw claim token, AES-256-GCM encrypted.
   *
   * SMTP acceptance and a database write cannot commit together, so a process
   * killed between them leaves a contact who may already be holding a working
   * link while the row still says the notice is owed. Minting a fresh token on
   * that retry would overwrite the hash and kill the delivered link, and if the
   * retry's own send then failed the contact would be left with a link that does
   * not work -- during a recovery, indistinguishable from one the owner revoked
   * (audit RV4-004).
   *
   * So the token is issued once and reused until delivery is acknowledged: written
   * with the hash before the first send, re-read by a retry, and cleared in the
   * same statement that records delivery. It never outlives the delivery it exists
   * for, and it is `@Exclude()`d for the same reason the hash is.
   */
  @Column({ name: "claim_token_ciphertext", type: "text", nullable: true })
  @Exclude()
  claimTokenCiphertext: string | null;

  @CreateDateColumn({ name: "created_at" })
  createdAt: Date;

  @UpdateDateColumn({ name: "updated_at" })
  updatedAt: Date;

  @ManyToOne(() => User, { onDelete: "CASCADE" })
  @JoinColumn({ name: "owner_user_id" })
  owner: User;
}
