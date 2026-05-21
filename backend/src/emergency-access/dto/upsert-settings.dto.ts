import {
  IsBoolean,
  IsInt,
  IsOptional,
  IsString,
  Max,
  MaxLength,
  Min,
  Validate,
  ValidationArguments,
  ValidatorConstraint,
  ValidatorConstraintInterface,
} from "class-validator";
import { SanitizeHtml } from "../../common/decorators/sanitize-html.decorator";

@ValidatorConstraint({ name: "ReminderLtGrant", async: false })
class ReminderLtGrantConstraint implements ValidatorConstraintInterface {
  validate(_: unknown, args: ValidationArguments): boolean {
    const dto = args.object as UpsertSettingsDto;
    return dto.reminderAfterDays < dto.grantAfterDays;
  }
  defaultMessage(): string {
    return "reminderAfterDays must be less than grantAfterDays";
  }
}

export class UpsertSettingsDto {
  @IsBoolean()
  enabled: boolean;

  @IsInt()
  @Min(2)
  @Max(365)
  grantAfterDays: number;

  @IsInt()
  @Min(1)
  @Max(364)
  @Validate(ReminderLtGrantConstraint)
  reminderAfterDays: number;

  @IsOptional()
  @IsString()
  @MaxLength(4000)
  @SanitizeHtml()
  message?: string | null;
}
