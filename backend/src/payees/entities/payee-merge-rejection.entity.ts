import {
  Entity,
  PrimaryGeneratedColumn,
  Column,
  ManyToOne,
  JoinColumn,
  CreateDateColumn,
  Unique,
  Index,
} from "typeorm";
import { ApiProperty } from "@nestjs/swagger";
import { Payee } from "./payee.entity";
import { User } from "../../users/entities/user.entity";

/**
 * Records a user's decision that two payees are NOT duplicates, so the AI
 * Payee Organizer never re-suggests merging them.
 *
 * The pair is stored canonically (unordered): the lexicographically smaller
 * UUID is payeeIdLow, the larger is payeeIdHigh, so {A,B} and {B,A} map to a
 * single row enforced by the unique constraint.
 */
@Entity("payee_merge_rejections")
@Unique(["userId", "payeeIdLow", "payeeIdHigh"])
@Index(["userId"])
export class PayeeMergeRejection {
  @ApiProperty({ example: "c5f5d5f0-1234-4567-890a-123456789abc" })
  @PrimaryGeneratedColumn("uuid")
  id: string;

  @ApiProperty({ example: "user-uuid" })
  @Column({ type: "uuid", name: "user_id" })
  userId: string;

  @ManyToOne(() => User, { onDelete: "CASCADE" })
  @JoinColumn({ name: "user_id" })
  user?: User;

  @ApiProperty({
    example: "payee-uuid-low",
    description: "Lexicographically smaller payee UUID of the rejected pair",
  })
  @Column({ type: "uuid", name: "payee_id_low" })
  payeeIdLow: string;

  @ManyToOne(() => Payee, { onDelete: "CASCADE" })
  @JoinColumn({ name: "payee_id_low" })
  payeeLow?: Payee;

  @ApiProperty({
    example: "payee-uuid-high",
    description: "Lexicographically larger payee UUID of the rejected pair",
  })
  @Column({ type: "uuid", name: "payee_id_high" })
  payeeIdHigh: string;

  @ManyToOne(() => Payee, { onDelete: "CASCADE" })
  @JoinColumn({ name: "payee_id_high" })
  payeeHigh?: Payee;

  @ApiProperty()
  @CreateDateColumn({ name: "created_at", type: "timestamptz" })
  createdAt: Date;
}
