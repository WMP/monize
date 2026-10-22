import { PartialType } from "@nestjs/swagger";

import {
  PayloadRule,
  WarrantyFieldsDto,
  expirySourceCount,
  priceAndCurrencyAgree,
} from "./create-warranty.dto";

/**
 * `PATCH /warranties/:id`. Every field is optional, and at most one of
 * `expiresOn`, `term` or `isLifetime: true` may be given: none keeps the
 * stored expiry, two would be a guess. A price and its currency still travel
 * together in the payload; the rules that need the stored row as well (an
 * expiry on or after a purchase date the payload may not carry, a dated
 * warranty with a date) are the service's, against the row.
 */
@PayloadRule(
  "expirySource",
  (dto) => expirySourceCount(dto) <= 1,
  "Give at most one of expiresOn, term or isLifetime: true",
)
@PayloadRule(
  "priceCurrency",
  (dto) =>
    (dto.purchasePrice === undefined && dto.currencyCode === undefined) ||
    priceAndCurrencyAgree(dto),
  "purchasePrice and currencyCode are set together or not at all",
)
export class UpdateWarrantyDto extends PartialType(WarrantyFieldsDto) {}
