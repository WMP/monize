import { HttpException } from "@nestjs/common";

/**
 * A log-safe account of a failure: the class, and the message only when it is
 * ours (an `HttpException`). Kept apart from the pipeline service so the
 * modules the pipeline depends on can use it without importing it back.
 */
export function describeFailure(error: unknown): string {
  if (error instanceof HttpException) {
    return `${error.constructor.name}: ${error.message}`;
  }
  return error instanceof Error ? error.constructor.name : "unknown error";
}
