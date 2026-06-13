import {
  Entity,
  Column,
  PrimaryGeneratedColumn,
  CreateDateColumn,
  UpdateDateColumn,
  ManyToOne,
  JoinColumn,
  Index,
} from "typeorm";
import { User } from "../../../users/entities/user.entity";

/**
 * Kinds of suggestion session. The mechanism is generic so other features can
 * reuse it: payee_categorization now, broker_import (#646) later.
 */
export const SUGGESTION_SESSION_KINDS = [
  "payee_categorization",
  "broker_import",
] as const;

export type SuggestionSessionKind = (typeof SUGGESTION_SESSION_KINDS)[number];

export const SUGGESTION_SESSION_STATUSES = [
  "draft",
  "applied",
  "discarded",
] as const;

export type SuggestionSessionStatus =
  (typeof SUGGESTION_SESSION_STATUSES)[number];

/**
 * One stored suggestion item. The shape is union-typed per kind; for
 * payee_categorization each item carries the LLM's raw suggestion only.
 * Display fields (payee/category names, transaction samples) are resolved fresh
 * on GET, never stored, so the review screen always reflects current data.
 */
export interface PayeeCategorizationSuggestionItem {
  payeeId: string;
  suggestedCategoryId: string | null;
  newCategoryName: string | null;
  reason: string | null;
  confidence: number | null;
}

/**
 * Generic DRAFT -> REVIEW -> APPLY session for AI suggestions.
 *
 * Hard rule: an external LLM may only write a DRAFT here. Applying is a human
 * action performed in the UI through a REST endpoint -- the AI/MCP write tool
 * only ever creates or replaces a draft session, never applies it.
 */
@Entity("ai_suggestion_sessions")
@Index(["userId", "kind", "status"])
export class AiSuggestionSession {
  @PrimaryGeneratedColumn("uuid")
  id: string;

  @Index()
  @Column({ type: "uuid", name: "user_id" })
  userId: string;

  @ManyToOne(() => User)
  @JoinColumn({ name: "user_id" })
  user?: User;

  @Column({ type: "varchar", length: 40 })
  kind: SuggestionSessionKind;

  @Column({ type: "varchar", length: 20, default: "draft" })
  status: SuggestionSessionStatus;

  @Column({ type: "varchar", length: 255, nullable: true })
  title: string | null;

  @Column({ type: "jsonb", default: () => "'[]'" })
  items: PayeeCategorizationSuggestionItem[];

  @CreateDateColumn({ name: "created_at" })
  createdAt: Date;

  @UpdateDateColumn({ name: "updated_at" })
  updatedAt: Date;
}
