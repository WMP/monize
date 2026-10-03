import { ApiProperty, ApiPropertyOptional } from "@nestjs/swagger";
import {
  IsString,
  IsNumber,
  IsUUID,
  IsOptional,
  IsBoolean,
  IsDateString,
  IsIn,
  Min,
  Max,
  MaxLength,
} from "class-validator";
import { SanitizeHtml } from "../../common/decorators/sanitize-html.decorator";
import {
  MORTGAGE_TYPES,
  MortgageType,
  PREPAYMENT_MODES,
  PrepaymentMode,
} from "../mortgage-type.util";

export class SetupLoanPaymentsDto {
  @ApiProperty({
    description: "Payment amount per period (positive number)",
    example: 1500,
  })
  @IsNumber({ maxDecimalPlaces: 4 })
  @Min(0.01)
  @Max(999999999999)
  paymentAmount: number;

  @ApiProperty({
    description: "Payment frequency",
    example: "MONTHLY",
  })
  @IsString()
  @IsIn(["WEEKLY", "BIWEEKLY", "SEMIMONTHLY", "MONTHLY", "QUARTERLY", "YEARLY"])
  paymentFrequency: string;

  @ApiProperty({
    description: "Source account ID where payments come from",
  })
  @IsUUID()
  sourceAccountId: string;

  @ApiProperty({
    description: "Next payment due date (YYYY-MM-DD)",
    example: "2026-04-01",
  })
  @IsDateString()
  nextDueDate: string;

  @ApiPropertyOptional({
    description: "Annual interest rate as percentage (e.g., 5.5 for 5.5%)",
    example: 5.5,
  })
  @IsOptional()
  @IsNumber({ maxDecimalPlaces: 4 })
  @Min(0)
  @Max(100)
  interestRate?: number;

  @ApiPropertyOptional({
    description: "Interest expense category ID",
  })
  @IsOptional()
  @IsUUID()
  interestCategoryId?: string;

  @ApiPropertyOptional({
    description: "Payee ID for the scheduled transaction",
  })
  @IsOptional()
  @IsUUID()
  payeeId?: string;

  @ApiPropertyOptional({
    description: "Payee name for the scheduled transaction",
    example: "Bank of America",
  })
  @IsOptional()
  @IsString()
  @MaxLength(255)
  @SanitizeHtml()
  payeeName?: string;

  @ApiPropertyOptional({
    description: "Whether to auto-post the scheduled transaction when due",
    default: false,
  })
  @IsOptional()
  @IsBoolean()
  autoPost?: boolean;

  @ApiPropertyOptional({
    description:
      "For mortgages: the mortgage type, ANNUITY (nominal rate divided by the payments per year), CANADIAN_FIXED (semi-annual compounding), LINEAR (constant principal) or INTEREST_ONLY (no principal until the final payment). For LINEAR and INTEREST_ONLY the server prices the first installment and paymentAmount must equal it plus extraPrincipal. Wins over isCanadianMortgage/isVariableRate; when absent, a flag sent decides it.",
    enum: MORTGAGE_TYPES,
  })
  @IsOptional()
  @IsIn(MORTGAGE_TYPES)
  mortgageType?: MortgageType;

  @ApiPropertyOptional({
    example: "SHORTEN_TERM",
    description:
      "For mortgages, LINEAR mortgages only: what an extra repayment does to the constant principal. SHORTEN_TERM (the default when absent) keeps it and ends the loan earlier; LOWER_INSTALLMENT re-derives it as the remaining debt over the remaining payments. Stored as null for every other type.",
    enum: PREPAYMENT_MODES,
  })
  @IsOptional()
  @IsIn(PREPAYMENT_MODES)
  prepaymentMode?: PrepaymentMode | null;

  @ApiPropertyOptional({
    description:
      "For mortgages, legacy flag superseded by mortgageType: a Canadian mortgage that is not variable-rate is CANADIAN_FIXED (semi-annual compounding)",
    default: false,
  })
  @IsOptional()
  @IsBoolean()
  isCanadianMortgage?: boolean;

  @ApiPropertyOptional({
    description:
      "For mortgages, legacy flag superseded by mortgageType: a Canadian variable-rate mortgage is ANNUITY",
    default: false,
  })
  @IsOptional()
  @IsBoolean()
  isVariableRate?: boolean;

  @ApiPropertyOptional({
    description: "For mortgages: total amortization period in months",
    example: 300,
  })
  @IsOptional()
  @IsNumber()
  @Min(1)
  @Max(600)
  amortizationMonths?: number;

  @ApiPropertyOptional({
    description: "For mortgages: mortgage term length in months",
    example: 60,
  })
  @IsOptional()
  @IsNumber()
  @Min(1)
  @Max(600)
  termMonths?: number;

  @ApiPropertyOptional({
    description:
      "Extra principal amount per payment period. Added to the principal portion of the split.",
    example: 200,
  })
  @IsOptional()
  @IsNumber({ maxDecimalPlaces: 4 })
  @Min(0)
  @Max(999999999999)
  extraPrincipal?: number;

  @ApiPropertyOptional({
    description:
      "Interest amount from detected transaction history. When provided, uses this for the interest split instead of calculating from the amortization formula.",
    example: 1000,
  })
  @IsOptional()
  @IsNumber({ maxDecimalPlaces: 4 })
  @Min(0)
  @Max(999999999999)
  detectedInterestAmount?: number;
}

export class DetectedLoanPaymentResponseDto {
  @ApiProperty()
  paymentAmount: number;

  @ApiProperty()
  paymentFrequency: string;

  @ApiProperty()
  confidence: number;

  @ApiProperty({ nullable: true })
  sourceAccountId: string | null;

  @ApiProperty({ nullable: true })
  sourceAccountName: string | null;

  @ApiProperty({ nullable: true })
  interestCategoryId: string | null;

  @ApiProperty({ nullable: true })
  interestCategoryName: string | null;

  @ApiProperty({ nullable: true })
  principalCategoryId: string | null;

  @ApiProperty({ nullable: true })
  estimatedInterestRate: number | null;

  @ApiProperty()
  suggestedNextDueDate: string;

  @ApiProperty()
  firstPaymentDate: string;

  @ApiProperty()
  lastPaymentDate: string;

  @ApiProperty()
  paymentCount: number;

  @ApiProperty()
  currentBalance: number;

  @ApiProperty()
  isMortgage: boolean;

  @ApiProperty({ description: "Average extra principal per payment period" })
  averageExtraPrincipal: number;

  @ApiProperty({
    description: "Number of extra principal payments detected",
  })
  extraPrincipalCount: number;

  @ApiProperty({
    nullable: true,
    description: "Principal portion from most recent split payment",
  })
  lastPrincipalAmount: number | null;

  @ApiProperty({
    nullable: true,
    description: "Interest portion from most recent split payment",
  })
  lastInterestAmount: number | null;
}

export class SetupLoanPaymentsResponseDto {
  @ApiProperty({ description: "The created scheduled transaction ID" })
  scheduledTransactionId: string;

  @ApiProperty({ description: "The updated account" })
  accountId: string;

  @ApiProperty({ description: "Payment amount set on the account" })
  paymentAmount: number;

  @ApiProperty({
    description:
      "Amount of the first scheduled installment after clamping against the outstanding balance -- equals paymentAmount except on a nearly-paid loan",
  })
  firstInstallmentAmount: number;

  @ApiProperty({ description: "Payment frequency set on the account" })
  paymentFrequency: string;

  @ApiProperty({ description: "Next due date of the scheduled transaction" })
  nextDueDate: string;
}
