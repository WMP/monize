import { plainToInstance } from "class-transformer";
import { validate } from "class-validator";
import { PostScheduledTransactionDto } from "./post-scheduled-transaction.dto";

/**
 * The DTO is the public posting boundary (review R4-001).
 *
 * `POST /scheduled-transactions/:id/post` is idempotent only because the request
 * names the occurrence it means; a body that omits it used to fall through to a
 * "post whatever is current" fallback, so a network retry paid the next period.
 * The global `ValidationPipe` runs this DTO on every request to that route, so a
 * required `expectedNextDueDate` is what makes the retry a `400` instead of a
 * second payment.
 *
 * These assert on the validator metadata directly -- that is the exact mechanism
 * the HTTP route enforces, and it runs in `test:unit`, which CI actually
 * executes (the root `test/*.e2e-spec.ts` files are not in any CI job).
 */
describe("PostScheduledTransactionDto", () => {
  const errorsFor = (payload: unknown) =>
    validate(plainToInstance(PostScheduledTransactionDto, payload));

  const hasError = (
    errors: Awaited<ReturnType<typeof errorsFor>>,
    property: string,
  ) => errors.some((e) => e.property === property);

  it("rejects a body with no expectedNextDueDate", async () => {
    // The naive-retry shape. Before R4-001 this was accepted and served the
    // fallback; now it must fail validation before reaching the service.
    const errors = await errorsFor({});
    expect(hasError(errors, "expectedNextDueDate")).toBe(true);
  });

  it("rejects an empty-string expectedNextDueDate", async () => {
    const errors = await errorsFor({ expectedNextDueDate: "" });
    expect(hasError(errors, "expectedNextDueDate")).toBe(true);
  });

  it("rejects an expectedNextDueDate that is not a date", async () => {
    const errors = await errorsFor({ expectedNextDueDate: "not-a-date" });
    expect(hasError(errors, "expectedNextDueDate")).toBe(true);
  });

  it("accepts a body that names the occurrence", async () => {
    const errors = await errorsFor({ expectedNextDueDate: "2026-04-15" });
    expect(hasError(errors, "expectedNextDueDate")).toBe(false);
  });

  it("still accepts the optional posting overrides alongside the occurrence", async () => {
    const errors = await errorsFor({
      expectedNextDueDate: "2026-04-15",
      transactionDate: "2026-04-16",
      amount: -1200,
      description: "Rent",
    });
    expect(errors).toHaveLength(0);
  });
});
