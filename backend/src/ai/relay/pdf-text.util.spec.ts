const mockGetText = jest.fn();
const mockDestroy = jest.fn();
const mockPdfParse = jest.fn();
jest.mock("pdf-parse", () => ({
  PDFParse: jest.fn().mockImplementation((options: unknown) => {
    mockPdfParse(options);
    return { getText: mockGetText, destroy: mockDestroy };
  }),
}));
import { extractPdfText } from "./pdf-text.util";

describe("extractPdfText", () => {
  beforeEach(() => {
    mockGetText.mockReset();
    mockDestroy.mockReset().mockResolvedValue(undefined);
    mockPdfParse.mockReset();
  });

  it("returns the trimmed text layer", async () => {
    mockGetText.mockResolvedValue({ text: "  Statement total: $42  \n" });
    await expect(extractPdfText(Buffer.from("%PDF"))).resolves.toBe(
      "Statement total: $42",
    );
  });

  it("returns an empty string for a PDF with no text layer", async () => {
    mockGetText.mockResolvedValue({ text: "" });
    await expect(extractPdfText(Buffer.from("%PDF"))).resolves.toBe("");
  });

  it("propagates a parse failure to the caller", async () => {
    mockGetText.mockRejectedValue(new Error("not a pdf"));
    await expect(extractPdfText(Buffer.from("nope"))).rejects.toThrow(
      "not a pdf",
    );
  });

  it("releases the parser whether or not the parse succeeds", async () => {
    mockGetText.mockResolvedValueOnce({ text: "ok" });
    await extractPdfText(Buffer.from("%PDF"));
    mockGetText.mockRejectedValueOnce(new Error("not a pdf"));
    await extractPdfText(Buffer.from("nope")).catch(() => undefined);
    expect(mockDestroy).toHaveBeenCalledTimes(2);
  });

  // pdf.js may detach the buffer it is handed; the caller serves the original
  // bytes as the binary fallback, so the parser must get a copy.
  it("hands the parser a copy of the bytes, not the caller's buffer", async () => {
    mockGetText.mockResolvedValue({ text: "" });
    const bytes = Buffer.from("%PDF");
    await extractPdfText(bytes);
    const { data } = mockPdfParse.mock.calls[0][0] as { data: Uint8Array };
    expect(data).toEqual(new Uint8Array(bytes));
    expect(data.buffer).not.toBe(bytes.buffer);
  });

  it("asks for the text without page markers", async () => {
    mockGetText.mockResolvedValue({ text: "" });
    await extractPdfText(Buffer.from("%PDF"));
    expect(mockGetText).toHaveBeenCalledWith({ pageJoiner: "" });
  });
});
