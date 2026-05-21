import {
  Entity,
  Column,
  PrimaryColumn,
  CreateDateColumn,
  UpdateDateColumn,
  OneToOne,
  JoinColumn,
} from "typeorm";
import { User } from "../../users/entities/user.entity";

@Entity("emergency_access_settings")
export class EmergencyAccessSettings {
  @PrimaryColumn("uuid", { name: "owner_user_id" })
  ownerUserId: string;

  @Column({ type: "boolean", default: false })
  enabled: boolean;

  @Column({ name: "grant_after_days", type: "int", default: 14 })
  grantAfterDays: number;

  @Column({ name: "reminder_after_days", type: "int", default: 7 })
  reminderAfterDays: number;

  @Column({ name: "message_ciphertext", type: "text", nullable: true })
  messageCiphertext: string | null;

  @Column({ name: "last_reminder_sent_at", type: "timestamp", nullable: true })
  lastReminderSentAt: Date | null;

  @Column({ name: "granted_at", type: "timestamp", nullable: true })
  grantedAt: Date | null;

  @CreateDateColumn({ name: "created_at" })
  createdAt: Date;

  @UpdateDateColumn({ name: "updated_at" })
  updatedAt: Date;

  @OneToOne(() => User, { onDelete: "CASCADE" })
  @JoinColumn({ name: "owner_user_id" })
  owner: User;
}
