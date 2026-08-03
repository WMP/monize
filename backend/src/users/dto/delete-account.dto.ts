import { IsString, IsOptional, MaxLength } from "class-validator";

export class DeleteAccountDto {
  @IsString()
  @MaxLength(128)
  @IsOptional()
  password?: string;
}
