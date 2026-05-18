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

@Entity("refresh_tokens")
export class RefreshToken {
  @PrimaryGeneratedColumn("uuid")
  id: string;

  @Column({ name: "user_id", type: "uuid" })
  userId: string;

  @Column({ name: "token_hash", type: "varchar", length: 64 })
  @Exclude()
  tokenHash: string;

  @Column({ name: "family_id", type: "uuid" })
  familyId: string;

  @Column({ name: "is_revoked", type: "boolean", default: false })
  isRevoked: boolean;

  @Column({ name: "expires_at", type: "timestamp" })
  expiresAt: Date;

  @Column({
    name: "replaced_by_hash",
    type: "varchar",
    length: 64,
    nullable: true,
  })
  replacedByHash: string | null;

  @Column({ name: "remember_me", type: "boolean", default: false })
  rememberMe: boolean;

  // Delegate "acting as owner" context. Carried across rotation so a 15-minute
  // access-token expiry does not silently drop the context. NULL for normal
  // (acting-as-self) sessions. `userId` above always stays the real
  // authenticated (delegate) user.
  @Column({ name: "acting_as_user_id", type: "uuid", nullable: true })
  actingAsUserId: string | null;

  @Column({ name: "delegation_id", type: "uuid", nullable: true })
  delegationId: string | null;

  @CreateDateColumn({ name: "created_at" })
  createdAt: Date;

  @UpdateDateColumn({ name: "updated_at" })
  updatedAt: Date;

  @ManyToOne(() => User)
  @JoinColumn({ name: "user_id" })
  user: User;
}
