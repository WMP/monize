import {
  Entity,
  Column,
  PrimaryColumn,
  ManyToOne,
  JoinColumn,
  Check,
} from "typeorm";
import { ActionHistory } from "../../action-history/entities/action-history.entity";

export const ACCRUAL_HISTORY_CHUNK_BYTES = 64 * 1024;
export type AccrualHistorySide = "before" | "after";

@Entity("accrual_history_chunks")
@Check("ck_accrual_history_chunk_side", "side IN ('before', 'after')")
@Check("ck_accrual_history_chunk_index", "part_index >= 0")
@Check(
  "ck_accrual_history_chunk_size",
  `octet_length(payload) BETWEEN 1 AND ${ACCRUAL_HISTORY_CHUNK_BYTES}`,
)
export class AccrualHistoryChunk {
  @PrimaryColumn({ name: "action_id", type: "uuid" }) actionId: string;
  @Column({ name: "user_id", type: "uuid" }) userId: string;
  @PrimaryColumn({ type: "varchar", length: 6 }) side: AccrualHistorySide;
  @PrimaryColumn({ name: "part_index", type: "integer" }) partIndex: number;
  @Column({ type: "bytea" }) payload: Buffer;
  @ManyToOne(() => ActionHistory, { onDelete: "CASCADE" })
  @JoinColumn([
    { name: "action_id", referencedColumnName: "id" },
    { name: "user_id", referencedColumnName: "userId" },
  ])
  action?: ActionHistory;
}
