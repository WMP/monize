import { IsBoolean, IsOptional } from "class-validator";

/**
 * 2C: owner toggles a delegate's per-delegation manage capabilities for
 * shared reference data. Omitted fields are left unchanged.
 */
export class SetCapabilitiesDto {
  @IsOptional()
  @IsBoolean()
  canManagePayees?: boolean;

  @IsOptional()
  @IsBoolean()
  canManageCategories?: boolean;

  @IsOptional()
  @IsBoolean()
  canManageTags?: boolean;
}
