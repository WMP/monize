import {
  isContentBlocks,
  contentToPlainText,
  unsupportedAttachmentNote,
} from "./content-blocks.util";
import { AiContentBlock } from "./ai-provider.interface";

describe("content-blocks.util", () => {
  describe("isContentBlocks", () => {
    it("returns false for a string", () => {
      expect(isContentBlocks("hello")).toBe(false);
    });

    it("returns true for an array of blocks", () => {
      expect(isContentBlocks([{ type: "text", text: "hi" }])).toBe(true);
    });
  });

  describe("contentToPlainText", () => {
    it("passes a string through unchanged", () => {
      expect(contentToPlainText("just text")).toBe("just text");
    });

    it("joins text blocks and drops binary blocks", () => {
      const blocks: AiContentBlock[] = [
        { type: "document", mediaType: "application/pdf", data: "JVBER" },
        { type: "text", text: "first" },
        { type: "image", mediaType: "image/png", data: "iVBOR" },
        { type: "text", text: "second" },
      ];
      expect(contentToPlainText(blocks)).toBe("first\n\nsecond");
    });

    it("returns an empty string when there are no text blocks", () => {
      const blocks: AiContentBlock[] = [
        { type: "image", mediaType: "image/png", data: "iVBOR" },
      ];
      expect(contentToPlainText(blocks)).toBe("");
    });
  });

  describe("unsupportedAttachmentNote", () => {
    it("names the file and provider", () => {
      const note = unsupportedAttachmentNote("PDF", "receipt.pdf", "openai");
      expect(note).toContain("receipt.pdf");
      expect(note).toContain("openai");
      expect(note).toContain("cannot read PDF");
    });

    it("omits the filename clause when no filename is given", () => {
      const note = unsupportedAttachmentNote("PDF", undefined, "ollama");
      expect(note).not.toContain('named "');
      expect(note).toContain("ollama");
    });
  });
});
