import { IsUUID } from "class-validator";

export class SwitchContextDto {
  /**
   * The owner account to act as, or the delegate's own id to return to self.
   */
  @IsUUID()
  targetUserId: string;
}
