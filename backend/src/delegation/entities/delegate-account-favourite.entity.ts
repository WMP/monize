import {
  Entity,
  Column,
  PrimaryGeneratedColumn,
  CreateDateColumn,
  Unique,
} from "typeorm";

/**
 * A delegate's own favourite marker for an account they have access to.
 *
 * Account favourites live on the accounts row (owner-scoped). When a
 * delegate acts as an owner, that shared flag must NOT be reused -- the
 * delegate keeps an independent set of favourites here, keyed by their own
 * user id, so owner and delegate favourites never affect each other.
 */
@Entity("delegate_account_favourites")
@Unique(["delegateUserId", "accountId"])
export class DelegateAccountFavourite {
  @PrimaryGeneratedColumn("uuid")
  id: string;

  @Column({ name: "delegate_user_id", type: "uuid" })
  delegateUserId: string;

  @Column({ name: "account_id", type: "uuid" })
  accountId: string;

  @Column({ name: "sort_order", type: "integer", default: 0 })
  sortOrder: number;

  @CreateDateColumn({ name: "created_at" })
  createdAt: Date;
}
