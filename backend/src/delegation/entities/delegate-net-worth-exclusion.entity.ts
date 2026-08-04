import {
  Entity,
  Column,
  PrimaryGeneratedColumn,
  CreateDateColumn,
  Unique,
} from "typeorm";

/**
 * A grantee's "exclude this joint account from MY net worth" marker
 * (migration 133). Row presence = excluded; the default (no row) includes a
 * joint account in the grantee's net worth.
 *
 * Keyed by the grantee's own user id -- like DelegateAccountFavourite -- so
 * the owner's accounts.exclude_from_net_worth stays owner-scoped and neither
 * side's preference ever affects the other's view.
 */
@Entity("delegate_net_worth_exclusions")
@Unique(["delegateUserId", "accountId"])
export class DelegateNetWorthExclusion {
  @PrimaryGeneratedColumn("uuid")
  id: string;

  @Column({ name: "delegate_user_id", type: "uuid" })
  delegateUserId: string;

  @Column({ name: "account_id", type: "uuid" })
  accountId: string;

  @CreateDateColumn({ name: "created_at" })
  createdAt: Date;
}
