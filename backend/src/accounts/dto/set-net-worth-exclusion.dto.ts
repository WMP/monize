import { IsBoolean } from "class-validator";

/**
 * A grantee's per-account "exclude this joint account from MY net worth"
 * toggle. Own-context only; owners use the account's own excludeFromNetWorth.
 */
export class SetNetWorthExclusionDto {
  @IsBoolean()
  excluded: boolean;
}
