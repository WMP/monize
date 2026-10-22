import { Entity, PrimaryColumn, Column, CreateDateColumn } from "typeorm";
import { ApiProperty } from "@nestjs/swagger";
import { Exclude } from "class-transformer";

@Entity("currencies")
export class Currency {
  @ApiProperty({ example: "CAD" })
  @PrimaryColumn({ type: "varchar", length: 3 })
  code: string;

  @ApiProperty({ example: "Canadian Dollar" })
  @Column({ type: "varchar", length: 100 })
  name: string;

  @ApiProperty({ example: "$" })
  @Column({ type: "varchar", length: 10 })
  symbol: string;

  @ApiProperty({ example: 2 })
  @Column({ type: "smallint", name: "decimal_places", default: 2 })
  decimalPlaces: number;

  @ApiProperty({ example: true })
  @Column({ type: "boolean", name: "is_active", default: true })
  isActive: boolean;

  // Another user's id: never part of a response body. Services read it from the
  // instance; the global ClassSerializerInterceptor drops it on the way out.
  @Exclude()
  @Column({ type: "uuid", name: "created_by_user_id", nullable: true })
  createdByUserId: string | null;

  @ApiProperty()
  @CreateDateColumn({ name: "created_at" })
  createdAt: Date;
}
