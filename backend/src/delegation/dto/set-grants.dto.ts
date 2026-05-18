import { Type } from "class-transformer";
import {
  ArrayUnique,
  IsArray,
  IsBoolean,
  IsOptional,
  IsUUID,
  ValidateNested,
} from "class-validator";

/**
 * One account's permission set for a delegate. READ is the minimum: a grant
 * with canRead=false means "no access" and is not stored. CREATE/EDIT/DELETE
 * require READ (enforced server-side).
 */
export class AccountGrantDto {
  @IsUUID("4")
  accountId: string;

  @IsBoolean()
  canRead: boolean;

  @IsOptional()
  @IsBoolean()
  canCreate?: boolean;

  @IsOptional()
  @IsBoolean()
  canEdit?: boolean;

  @IsOptional()
  @IsBoolean()
  canDelete?: boolean;
}

/**
 * Phase 2: the authoritative set of per-account permissions for a delegate.
 * Accounts not present (or present with canRead=false) have all access removed.
 */
export class SetGrantsDto {
  @IsArray()
  @ArrayUnique((g: AccountGrantDto) => g.accountId)
  @ValidateNested({ each: true })
  @Type(() => AccountGrantDto)
  grants: AccountGrantDto[];
}
