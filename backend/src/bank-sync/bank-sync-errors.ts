import {
  BadGatewayException,
  BadRequestException,
  ConflictException,
  HttpException,
  HttpStatus,
  ServiceUnavailableException,
} from "@nestjs/common";
import { describeFetchFailure } from "../common/http/fetch-failure.util";
import { tr } from "../i18n/translate";
import { BANK_SYNC_STORED_MESSAGE_MAX_LENGTH } from "./bank-sync.constants";
import {
  BankSyncProviderError,
  isBankSyncProviderError,
} from "./providers/bank-sync-provider.errors";

/**
 * Where a failed provider call becomes something a caller can act on: an HTTP
 * exception whose message is translated, a bounded line to store on the row,
 * and a log line. Every kind is mapped here so a service never decides a status
 * code ad hoc (docs/specs/bank-sync.md section 7 step 7).
 */

/** The HTTP exception a provider failure is answered with. */
export function mapBankSyncProviderError(
  error: BankSyncProviderError,
): HttpException {
  switch (error.kind) {
    case "unauthorized":
      return new BadRequestException(
        tr(
          "errors.bankSync.credentialsRejected",
          "The bank sync provider rejected your application credentials. Check the application id and the private key.",
        ),
      );
    case "session_expired":
      return new ConflictException(
        tr(
          "errors.bankSync.consentExpired",
          "Your consent at the bank has expired or was withdrawn. Renew the connection to keep syncing.",
        ),
      );
    case "rate_limited":
      return new HttpException(
        tr(
          "errors.bankSync.rateLimited",
          "The bank or the provider limited how often this account can be read. Banks allow only a few unattended reads a day; try again later.",
        ),
        HttpStatus.TOO_MANY_REQUESTS,
      );
    case "bad_request":
      return new BadRequestException(
        tr(
          "errors.bankSync.providerRejected",
          `The bank sync provider rejected the request: ${error.message}`,
          { detail: error.message },
        ),
      );
    case "unavailable":
      return new ServiceUnavailableException(
        tr(
          "errors.bankSync.providerUnavailable",
          "The bank sync provider did not answer. Nothing was changed; try again later.",
        ),
      );
    case "invalid_response":
      return new BadGatewayException(
        tr(
          "errors.bankSync.providerInvalidResponse",
          "The bank sync provider sent an answer this version of Monize does not understand.",
        ),
      );
  }
}

/**
 * The error a caller should throw for a failure caught in a sync step: a
 * provider failure is mapped, anything else (an HTTP exception a service threw,
 * or an unexpected error the global filter will report as a 500) passes
 * through unchanged.
 */
export function toBankSyncException(error: unknown): unknown {
  return isBankSyncProviderError(error)
    ? mapBankSyncProviderError(error)
    : error;
}

const UNEXPECTED_FAILURE_TEXT =
  "The sync failed unexpectedly. The server log has the details.";

/**
 * The one line stored on a row (`last_sync_error`, `last_error`) for a failure.
 *
 * Only text this code controls or that the provider layer promises is safe to
 * store (`BankSyncProviderError` is built from a status and a bounded provider
 * code, never a credential or a response body); an unexpected error's message
 * is not, so it is replaced by a fixed sentence and the detail goes to the log.
 */
export function storedFailureMessage(error: unknown): string {
  let text: string;
  if (isBankSyncProviderError(error)) {
    text = error.message;
  } else if (error instanceof HttpException) {
    const body = error.getResponse();
    text =
      typeof body === "string"
        ? body
        : typeof (body as { message?: unknown }).message === "string"
          ? (body as { message: string }).message
          : error.message;
  } else {
    text = UNEXPECTED_FAILURE_TEXT;
  }
  return text.slice(0, BANK_SYNC_STORED_MESSAGE_MAX_LENGTH);
}

/** A bounded, secret-free line for the log. */
export function describeSyncFailure(error: unknown): string {
  if (isBankSyncProviderError(error)) {
    return `${error.kind}${error.status === null ? "" : ` (HTTP ${error.status})`}: ${error.message}`;
  }
  if (error instanceof HttpException) {
    return `${error.getStatus()}: ${storedFailureMessage(error)}`;
  }
  return describeFetchFailure(error);
}
