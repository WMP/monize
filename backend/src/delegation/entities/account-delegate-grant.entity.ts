import {
  Entity,
  Column,
  PrimaryGeneratedColumn,
  CreateDateColumn,
  ManyToOne,
  JoinColumn,
} from "typeorm";
import { AccountDelegate } from "./account-delegate.entity";

@Entity("account_delegate_grants")
export class AccountDelegateGrant {
  @PrimaryGeneratedColumn("uuid")
  id: string;

  @Column({ name: "delegation_id", type: "uuid" })
  delegationId: string;

  @Column({ name: "account_id", type: "uuid" })
  accountId: string;

  @Column({ name: "can_read", type: "boolean", default: true })
  canRead: boolean;

  // can_create / can_edit / can_delete are part of the Phase 2 design and are
  // not enforced yet. They exist so the grant model does not need to change.
  @Column({ name: "can_create", type: "boolean", default: false })
  canCreate: boolean;

  @Column({ name: "can_edit", type: "boolean", default: false })
  canEdit: boolean;

  @Column({ name: "can_delete", type: "boolean", default: false })
  canDelete: boolean;

  @CreateDateColumn({ name: "created_at" })
  createdAt: Date;

  @ManyToOne(() => AccountDelegate, (delegation) => delegation.grants, {
    onDelete: "CASCADE",
  })
  @JoinColumn({ name: "delegation_id" })
  delegation: AccountDelegate;
}
