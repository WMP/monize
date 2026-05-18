import {
  Entity,
  Column,
  PrimaryGeneratedColumn,
  CreateDateColumn,
  UpdateDateColumn,
  ManyToOne,
  OneToMany,
  JoinColumn,
} from "typeorm";
import { User } from "../../users/entities/user.entity";
import { AccountDelegateGrant } from "./account-delegate-grant.entity";

export type DelegationStatus = "pending" | "active" | "revoked";

@Entity("account_delegates")
export class AccountDelegate {
  @PrimaryGeneratedColumn("uuid")
  id: string;

  @Column({ name: "owner_user_id", type: "uuid" })
  ownerUserId: string;

  @Column({ name: "delegate_user_id", type: "uuid" })
  delegateUserId: string;

  @Column({ type: "varchar", length: 20, default: "active" })
  status: DelegationStatus;

  @CreateDateColumn({ name: "created_at" })
  createdAt: Date;

  @UpdateDateColumn({ name: "updated_at" })
  updatedAt: Date;

  @Column({ name: "revoked_at", type: "timestamp", nullable: true })
  revokedAt: Date | null;

  @ManyToOne(() => User)
  @JoinColumn({ name: "owner_user_id" })
  owner: User;

  @ManyToOne(() => User)
  @JoinColumn({ name: "delegate_user_id" })
  delegate: User;

  @OneToMany(() => AccountDelegateGrant, (grant) => grant.delegation)
  grants: AccountDelegateGrant[];
}
