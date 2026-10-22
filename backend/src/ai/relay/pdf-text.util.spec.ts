const mockExtractText = jest.fn();
const mockDestroy = jest.fn();
const mockGetDocumentProxy = jest.fn();
jest.mock("unpdf", () => ({
  getDocumentProxy: (data: unknown) => mockGetDocumentProxy(data),
  extractText: (pdf: unknown, options: unknown) =>
    mockExtractText(pdf, options),
}));
import { extractPdfText } from "./pdf-text.util";

describe("extractPdfText", () => {
  const pdf = { loadingTask: { destroy: mockDestroy } };

  beforeEach(() => {
    mockExtractText.mockReset();
    mockDestroy.mockReset().mockResolvedValue(undefined);
    mockGetDocumentProxy.mockReset().mockResolvedValue(pdf);
  });

  it("returns the trimmed text layer", async () => {
    mockExtractText.mockResolvedValue({
      totalPages: 1,
      text: "  Statement total: $42  \n",
    });
    await expect(extractPdfText(Buffer.from("%PDF"))).resolves.toBe(
      "Statement total: $42",
    );
  });

  it("returns an empty string for a PDF with no text layer", async () => {
    mockExtractText.mockResolvedValue({ totalPages: 1, text: "" });
    await expect(extractPdfText(Buffer.from("%PDF"))).resolves.toBe("");
  });

  it("propagates a load failure to the caller", async () => {
    mockGetDocumentProxy.mockRejectedValue(new Error("not a pdf"));
    await expect(extractPdfText(Buffer.from("nope"))).rejects.toThrow(
      "not a pdf",
    );
  });

  it("propagates an extraction failure to the caller", async () => {
    mockExtractText.mockRejectedValue(new Error("bad page"));
    await expect(extractPdfText(Buffer.from("%PDF"))).rejects.toThrow(
      "bad page",
    );
  });

  it("releases the document whether or not extraction succeeds", async () => {
    mockExtractText.mockResolvedValueOnce({ totalPages: 1, text: "ok" });
    await extractPdfText(Buffer.from("%PDF"));
    mockExtractText.mockRejectedValueOnce(new Error("bad page"));
    await extractPdfText(Buffer.from("%PDF")).catch(() => undefined);
    expect(mockDestroy).toHaveBeenCalledTimes(2);
  });

  // pdf.js may detach the buffer it is handed; the caller serves the original
  // bytes as the binary fallback, so the parser must get a copy.
  it("hands the parser a copy of the bytes, not the caller's buffer", async () => {
    mockExtractText.mockResolvedValue({ totalPages: 1, text: "" });
    const bytes = Buffer.from("%PDF");
    await extractPdfText(bytes);
    const data = mockGetDocumentProxy.mock.calls[0][0] as Uint8Array;
    expect(data).toEqual(new Uint8Array(bytes));
    expect(data.buffer).not.toBe(bytes.buffer);
  });

  it("asks for the pages merged into one string", async () => {
    mockExtractText.mockResolvedValue({ totalPages: 1, text: "" });
    await extractPdfText(Buffer.from("%PDF"));
    expect(mockExtractText).toHaveBeenCalledWith(pdf, { mergePages: true });
  });
});
