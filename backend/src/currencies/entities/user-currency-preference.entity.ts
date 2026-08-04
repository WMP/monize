import {
  Entity,
  Column,
  PrimaryColumn,
  CreateDateColumn,
  ManyToOne,
  JoinColumn,
} from "typeorm";
import { Currency } from "./currency.entity";

@Entity("user_currency_preferences")
export class UserCurrencyPreference {
  @PrimaryColumn("uuid", { name: "user_id" })
  userId: string;

  @PrimaryColumn({ type: "varchar", length: 3, name: "currency_code" })
  currencyCode: string;

  @Column({ type: "boolean", name: "is_active", default: true })
  isActive: boolean;

  @CreateDateColumn({ name: "created_at" })
  createdAt: Date;

  /**
   * `onDelete` is declared here because `database/schema.sql` declares it, and an
   * entity that omits it makes the integration harness -- which builds its schema
   * from entity metadata -- disagree with production on this exact constraint.
   *
   * It is the constraint P2-009 turned dangerous: deleting a shared `currencies`
   * row cascades another tenant's preference away, silently. A harness whose FK
   * was NO ACTION instead could only ever have shown a foreign-key error, so the
   * cross-tenant data loss was not reproducible in a test.
   */
  @ManyToOne(() => Currency, { onDelete: "CASCADE" })
  @JoinColumn({ name: "currency_code", referencedColumnName: "code" })
  currency: Currency;
}
