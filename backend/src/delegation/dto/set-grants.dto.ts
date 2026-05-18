import { ArrayUnique, IsArray, IsUUID } from "class-validator";

/**
 * Phase 1: the owner grants the delegate READ on this exact set of accounts.
 * The set is authoritative -- accounts not listed have their grant removed.
 */
export class SetGrantsDto {
  @IsArray()
  @ArrayUnique()
  @IsUUID("4", { each: true })
  accountIds: string[];
}
