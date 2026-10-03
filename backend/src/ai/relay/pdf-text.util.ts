import { PDFParse } from "pdf-parse";

/**
 * Extract the text layer from a PDF's bytes.
 *
 * Used by the relay attachment resource so a PDF uploaded in relay mode is
 * served to the agent as plain text rather than a binary blob. Handing the
 * agent's MCP client (e.g. Claude Code) a raw `application/pdf` blob makes it
 * fall back to a local PDF handler, which prompts the user to install/run extra
 * tooling. Returning extracted text sidesteps that entirely -- the agent reads
 * the resource exactly like a CSV.
 *
 * Returns the trimmed text, which is empty for a scanned / image-only PDF that
 * carries no text layer. Throws if the bytes cannot be parsed as a PDF. In both
 * the empty and throwing cases the relay attachment resource falls back to
 * serving the raw PDF bytes as a binary blob (like an image), so the caller
 * should treat empty/throw as "no usable text" rather than a hard failure.
 */
export async function extractPdfText(data: Buffer): Promise<string> {
  // A copy, because pdf.js may detach the buffer it is handed, and the caller
  // still serves these bytes as the binary fallback.
  const parser = new PDFParse({ data: new Uint8Array(data) });
  try {
    // No "-- 1 of 2 --" page markers: the agent reads the text as-is.
    const result = await parser.getText({ pageJoiner: "" });
    return (result.text ?? "").trim();
  } finally {
    await parser.destroy();
  }
}
