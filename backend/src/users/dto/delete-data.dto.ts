import { IsString, IsOptional, IsBoolean, MaxLength } from "class-validator";

export class DeleteDataDto {
  @IsString()
  @MaxLength(128)
  @IsOptional()
  password?: string;

  // Always deleted: transactions, splits, tags, scheduled transactions,
  // investment transactions, holdings, security prices, securities,
  // monthly account balances, budgets

  @IsBoolean()
  @IsOptional()
  deleteAccounts?: boolean;

  @IsBoolean()
  @IsOptional()
  deleteCategories?: boolean;

  @IsBoolean()
  @IsOptional()
  deletePayees?: boolean;

  @IsBoolean()
  @IsOptional()
  deleteExchangeRates?: boolean;
}
