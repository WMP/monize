import { z } from "zod";

/** The longest reply read at all: a model that answers with a book is refused. */
const MAX_REPLY_CHARS = 200_000;

/**
 * The JSON object in a model's reply, or undefined. Tolerates a fenced
 * ```json block and prose around one object (first `{` to last `}`); never
 * throws, and reads nothing past `MAX_REPLY_CHARS`.
 */
export function extractJsonObject(content: unknown): unknown {
  if (typeof content !== "string" || content.length > MAX_REPLY_CHARS) {
    return undefined;
  }
  const fenced = /```(?:json)?\s*([\s\S]*?)```/i.exec(content);
  const candidates = [
    fenced?.[1] ?? null,
    content,
    content.slice(content.indexOf("{"), content.lastIndexOf("}") + 1),
  ];
  for (const candidate of candidates) {
    if (candidate === null || candidate.trim() === "") continue;
    try {
      const parsed: unknown = JSON.parse(candidate);
      if (typeof parsed === "object" && parsed !== null) return parsed;
    } catch {
      // try the next reading
    }
  }
  return undefined;
}

export const REVIEW_MAX_SPLITS = 50;
export const REVIEW_MAX_MEMO = 200;
export const REVIEW_MAX_DESCRIPTION = 750;
const MAX_CATEGORY_NAME = 200;

/** A model leaves a key out as often as it sends null: both mean "not given". */
const optional = <T extends z.ZodTypeAny>(schema: T) =>
  schema.nullish().transform((value) => value ?? undefined);

/**
 * What a review may answer (bounded): split lines, or one category, and a
 * description. Unknown keys are refused, so an answer that tries to carry an
 * amount, a date or an account for the transaction is not an answer.
 */
export const receiptReviewSchema = z
  .object({
    splits: optional(
      z
        .array(
          z
            .object({
              categoryName: z.string().trim().min(1).max(MAX_CATEGORY_NAME),
              amount: z.number().finite(),
              memo: optional(z.string().trim().max(REVIEW_MAX_MEMO)),
            })
            .strict(),
        )
        .max(REVIEW_MAX_SPLITS),
    ),
    categoryName: optional(z.string().trim().min(1).max(MAX_CATEGORY_NAME)),
    description: optional(z.string().trim().max(REVIEW_MAX_DESCRIPTION)),
  })
  .strict();

export type ReceiptReviewAnswer = z.infer<typeof receiptReviewSchema>;
