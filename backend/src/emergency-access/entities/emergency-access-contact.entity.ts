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
   * When this contact's link was actually sent -- the delivery record, kept
   * apart from the claim that coordinates the send.
   *
   * A claim answers "may I do this now" and cannot also answer "has this been
   * done", because the second question has to outlive the process that asked
   * the first. NULL on a granted owner's contact therefore means a link is
   * still owed, and that is how the daily check finds a grant a killed replica
   * never delivered -- without re-issuing a token for a contact who already
   * holds a working link (audit FV4-004).
   */
  @Column({ name: "claim_notified_at", type: "timestamp", nullable: true })
  claimNotifiedAt: Date | null;

  @CreateDateColumn({ name: "created_at" })
  createdAt: Date;

  @UpdateDateColumn({ name: "updated_at" })
  updatedAt: Date;

  @ManyToOne(() => User, { onDelete: "CASCADE" })
  @JoinColumn({ name: "owner_user_id" })
  owner: User;
}
