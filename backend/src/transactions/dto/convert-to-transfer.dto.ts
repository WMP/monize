import { OmitType } from "@nestjs/swagger";
import { CreateTransferDto } from "./create-transfer.dto";

/**
 * The transfer an existing transaction becomes (`POST
 * /transactions/:id/convert-to-transfer`): the create's body, less the
 * idempotency key. The row being converted already has an `externalId` or
 * none, set by the create that wrote it, and a conversion must not let a retry
 * of that create miss its row.
 */
export class ConvertToTransferDto extends OmitType(CreateTransferDto, [
  "externalId",
] as const) {}
