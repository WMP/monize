import {
  Column,
  CreateDateColumn,
  Entity,
  JoinColumn,
  ManyToOne,
  PrimaryColumn,
  UpdateDateColumn,
} from "typeorm";
import { User } from "../../../users/entities/user.entity";

/**
 * One user's Google Places configuration for the payee contact lookup.
 *
 * A row exists only once the user has configured something; its absence is
 * "not configured" rather than a set of stored defaults, which is why every
 * reader tolerates `null` and falls back to the constants in
 * `google-places/google-places-cap.ts`.
 *
 * `apiKeyEnc` is ciphertext under `ENCRYPTION_KEY` and is deliberately named
 * for the same column as `ai_provider_configs.api_key_enc`: the backup's key
 * transport is keyed on that name, and without it the row restores onto
 * another instance populated and unreadable.
 */
@Entity("payee_lookup_settings")
export class PayeeLookupSettings {
  @PrimaryColumn({ type: "uuid", name: "user_id" })
  userId: string;

  @ManyToOne(() => User, { onDelete: "CASCADE" })
  @JoinColumn({ name: "user_id" })
  user?: User;

  @Column({ type: "text", name: "api_key_enc", nullable: true })
  apiKeyEnc: string | null;

  @Column({ name: "google_places_enabled", default: true })
  googlePlacesEnabled: boolean;

  @Column({ name: "cap_enabled", default: true })
  capEnabled: boolean;

  /** Requests allowed per Pacific calendar month while `capEnabled`. */
  @Column({ type: "int", name: "monthly_cap", default: 1000 })
  monthlyCap: number;

  @CreateDateColumn({ name: "created_at" })
  createdAt: Date;

  @UpdateDateColumn({ name: "updated_at" })
  updatedAt: Date;
}
