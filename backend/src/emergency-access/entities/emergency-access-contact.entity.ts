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

  @CreateDateColumn({ name: "created_at" })
  createdAt: Date;

  @UpdateDateColumn({ name: "updated_at" })
  updatedAt: Date;

  @ManyToOne(() => User, { onDelete: "CASCADE" })
  @JoinColumn({ name: "owner_user_id" })
  owner: User;
}
