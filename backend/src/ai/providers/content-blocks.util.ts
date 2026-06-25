import { AiContentBlock } from "./ai-provider.interface";

/**
 * Note injected into a user turn when an attachment type cannot be sent to the
 * selected provider natively (e.g. a PDF on OpenAI/Ollama, which have no
 * portable document-input path). The model sees this in place of the binary so
 * it can tell the user what happened instead of silently ignoring the file.
 */
export function unsupportedAttachmentNote(
  kind: string,
  filename: string | undefined,
  provider: string,
): string {
  const name = filename ? ` named "${filename}"` : "";
  return (
    `[A ${kind} file${name} was attached, but the current AI provider ` +
    `(${provider}) cannot read ${kind} files. Ask the user to paste the ` +
    `relevant text, or to switch to a provider that supports ${kind} input ` +
    `(Anthropic supports PDFs).]`
  );
}

/** Type guard: the user content is an array of multimodal blocks. */
export function isContentBlocks(
  content: string | AiContentBlock[],
): content is AiContentBlock[] {
  return Array.isArray(content);
}

/**
 * Flatten user content to plain text. Used by the non-tool completion/stream
 * paths (insights, forecast) which never carry attachments, and as the
 * fallback when a provider can't render binary blocks: text blocks are
 * concatenated and binary blocks are dropped (the caller adds a note where it
 * matters).
 */
export function contentToPlainText(content: string | AiContentBlock[]): string {
  if (!isContentBlocks(content)) {
    return content;
  }
  return content
    .filter(
      (block): block is Extract<AiContentBlock, { type: "text" }> =>
        block.type === "text",
    )
    .map((block) => block.text)
    .join("\n\n");
}
