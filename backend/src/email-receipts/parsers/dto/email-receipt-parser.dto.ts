import { ApiProperty, ApiPropertyOptional, PartialType } from "@nestjs/swagger";
import { Transform, Type } from "class-transformer";
import {
  ArrayMaxSize,
  ArrayMinSize,
  ArrayUnique,
  IsArray,
  IsInt,
  IsObject,
  IsOptional,
  IsString,
  IsUUID,
  MaxLength,
  Min,
  MinLength,
  ValidateIf,
  ValidateNested,
} from "class-validator";
import { SanitizeHtml } from "../../../common/decorators/sanitize-html.decorator";
import {
  EMAIL_RECEIPT_PARSER_MAX_FROM_DOMAINS,
  EMAIL_RECEIPT_PARSER_MAX_SUBJECT_WORDS,
} from "../../entities/email-receipt-parser.entity";
import {
  IsReceiptDomain,
  normalizeReceiptDomain,
} from "./receipt-domain.validator";

export const PARSER_NAME_MAX_LENGTH = 100;
export const PARSER_SUBJECT_WORD_MAX_LENGTH = 100;

const trimmed = ({ value }: { value: unknown }) =>
  typeof value === "string" ? value.trim() : value;

const eachDomain = ({ value }: { value: unknown }) =>
  Array.isArray(value) ? value.map(normalizeReceiptDomain) : value;

/** Subject words are compared lower-case (design section 6), so they are stored that way. */
const eachSubjectWord = ({ value }: { value: unknown }) =>
  Array.isArray(value)
    ? value.map((word) =>
        typeof word === "string" ? word.trim().toLowerCase() : word,
      )
    : value;

/** A nullable optional id: the form resends every field, blank means none. */
const notBlank = (_object: unknown, value: unknown) =>
  value !== null && value !== undefined && value !== "";

/**
 * A receipt parser (design section 5). The `definition` is validated by
 * `validateReceiptParserDefinition` in the service, which reports every problem
 * as a path and a code; the DTO only bounds its outer shape. Ownership of the
 * payee and of every category id is checked in the write's transaction.
 */
export class CreateEmailReceiptParserDto {
  @ApiProperty({ maxLength: PARSER_NAME_MAX_LENGTH })
  @SanitizeHtml()
  @Transform(trimmed)
  @IsString()
  @MinLength(1)
  @MaxLength(PARSER_NAME_MAX_LENGTH)
  name: string;

  @ApiPropertyOptional({ nullable: true, description: "The merchant's payee." })
  @IsOptional()
  @ValidateIf(notBlank)
  @IsUUID()
  payeeId?: string | null;

  @ApiProperty({
    type: [String],
    description:
      "Sender domains the parser reads (a sub-domain of one also matches). Lower-case, no @.",
    example: ["shop.example.com"],
  })
  @Transform(eachDomain)
  @IsArray()
  @ArrayMinSize(1)
  @ArrayMaxSize(EMAIL_RECEIPT_PARSER_MAX_FROM_DOMAINS)
  @IsReceiptDomain({ each: true })
  fromDomains: string[];

  @ApiPropertyOptional({
    type: [String],
    description:
      "When not empty, the subject must contain at least one of these (case-insensitive).",
  })
  @IsOptional()
  @Transform(eachSubjectWord)
  @IsArray()
  @ArrayMaxSize(EMAIL_RECEIPT_PARSER_MAX_SUBJECT_WORDS)
  @IsString({ each: true })
  @MinLength(1, { each: true })
  @MaxLength(PARSER_SUBJECT_WORD_MAX_LENGTH, { each: true })
  subjectContains?: string[];

  @ApiProperty({
    type: "object",
    additionalProperties: true,
    description: "The version 2 definition (design section 5).",
  })
  @IsObject()
  definition: Record<string, unknown>;
}

/** A change to a parser: the fields to change, and the revision they were made against. */
export class UpdateEmailReceiptParserDto extends PartialType(
  CreateEmailReceiptParserDto,
) {
  @ApiProperty({
    minimum: 1,
    description:
      "The revision this edit was made against; a parser that has moved on is a 409.",
  })
  @Type(() => Number)
  @IsInt()
  @Min(1)
  expectedRevision: number;
}

/** Body of `POST /email-receipt-parsers/:id/approve`. */
export class ApproveEmailReceiptParserDto {
  @ApiPropertyOptional({
    minimum: 1,
    description:
      "When sent, the parser must still be at this revision (the version the person read).",
  })
  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(1)
  expectedRevision?: number;
}

/** Body of `POST /email-receipt-parsers/test`: a draft definition against a stored email. */
export class TestEmailReceiptParserDto {
  @ApiProperty({ type: "object", additionalProperties: true })
  @IsObject()
  definition: Record<string, unknown>;

  @ApiProperty({ description: "The stored email to read." })
  @IsUUID()
  receiptId: string;

  @ApiPropertyOptional({
    nullable: true,
    description:
      "The payee the parser would carry: its default category is the fallback, and the payee is a match signal.",
  })
  @IsOptional()
  @ValidateIf(notBlank)
  @IsUUID()
  payeeId?: string | null;
}

/** Most emails one "draft a parser with AI" request names (the schema's CHECK). */
export const PARSER_DRAFT_MAX_RECEIPTS = 5;

/**
 * Body of `POST /email-receipt-parsers/draft-with-ai`: the stored emails an
 * assistant (or an MCP agent) should write a parser from. They are the user's
 * own and readable (checked in the transaction that queues the request).
 */
export class DraftParserWithAiDto {
  @ApiProperty({
    type: [String],
    minItems: 1,
    maxItems: PARSER_DRAFT_MAX_RECEIPTS,
    description:
      "The stored emails to write the parser from (1 to 5, distinct).",
  })
  @IsArray()
  @ArrayMinSize(1)
  @ArrayMaxSize(PARSER_DRAFT_MAX_RECEIPTS)
  @ArrayUnique()
  @IsUUID("all", { each: true })
  receiptIds: string[];
}

/** An email and the transaction a person says it paid for (the wizard's sample pair). */
export class ReceiptTransactionPairDto {
  @ApiProperty({ description: "The stored email." })
  @IsUUID()
  receiptId: string;

  @ApiProperty({ description: "The transaction this email paid for." })
  @IsUUID()
  transactionId: string;
}

/** Most samples the wizard sends (the assistant tool's own bound). */
export const PARSER_GENERATE_MAX_SAMPLES = 5;
/** Longest note a person adds when asking for a revision. */
export const PARSER_GENERATE_FEEDBACK_MAX_LENGTH = 2000;

/**
 * Body of `POST /email-receipt-parsers/generate-with-ai`: the sender domain,
 * the sample emails with the transactions they paid for, and, to revise a
 * draft, its id and a note. Ownership of every email and transaction and the
 * domain of every email are checked by the service before anything is written.
 */
export class GenerateParserWithAiDto {
  @ApiProperty({ example: "shop.example.com" })
  @Transform(({ value }) => normalizeReceiptDomain(value))
  @IsReceiptDomain()
  domain: string;

  @ApiProperty({
    type: [ReceiptTransactionPairDto],
    minItems: 1,
    maxItems: PARSER_GENERATE_MAX_SAMPLES,
    description:
      "1 to 5 emails of the domain, each with the transaction it paid for; an email at most once.",
  })
  @IsArray()
  @ArrayMinSize(1)
  @ArrayMaxSize(PARSER_GENERATE_MAX_SAMPLES)
  @ArrayUnique((sample: ReceiptTransactionPairDto) => sample?.receiptId)
  @ValidateNested({ each: true })
  @Type(() => ReceiptTransactionPairDto)
  samples: ReceiptTransactionPairDto[];

  @ApiPropertyOptional({
    nullable: true,
    description: "The draft to revise; the assistant updates it in place.",
  })
  @IsOptional()
  @ValidateIf(notBlank)
  @IsUUID()
  parserId?: string | null;

  @ApiPropertyOptional({
    maxLength: PARSER_GENERATE_FEEDBACK_MAX_LENGTH,
    description: "What the person wants changed in the draft.",
  })
  @IsOptional()
  @Transform(trimmed)
  @IsString()
  @MaxLength(PARSER_GENERATE_FEEDBACK_MAX_LENGTH)
  feedback?: string;
}

/** Body of `POST /email-receipt-parsers/:id/preview`. */
export class PreviewEmailReceiptParserDto {
  @ApiProperty({
    type: [String],
    maxItems: PARSER_GENERATE_MAX_SAMPLES,
    description: "The sample emails: listed in `selected`, not in `others`.",
  })
  @IsArray()
  @ArrayMaxSize(PARSER_GENERATE_MAX_SAMPLES)
  @ArrayUnique()
  @IsUUID("all", { each: true })
  selectedReceiptIds: string[];

  @ApiPropertyOptional({
    type: [ReceiptTransactionPairDto],
    maxItems: PARSER_GENERATE_MAX_SAMPLES,
    description:
      "The transaction each selected email paid for; the preview says whether the parse agrees with it.",
  })
  @IsOptional()
  @IsArray()
  @ArrayMaxSize(PARSER_GENERATE_MAX_SAMPLES)
  @ArrayUnique((sample: ReceiptTransactionPairDto) => sample?.receiptId)
  @ValidateNested({ each: true })
  @Type(() => ReceiptTransactionPairDto)
  expected?: ReceiptTransactionPairDto[];
}
