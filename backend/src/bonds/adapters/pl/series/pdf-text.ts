/**
 * The issue letter's text. `pdfjs-dist` is published as ES modules only, so it is
 * loaded with a dynamic `import()`, which the compiler keeps native under
 * `module: nodenext`. This is the one module that touches it. Jest cannot load an
 * ES module from `node_modules` in this project, so the unit tests of everything
 * else mock `extractPdfText`, and `pdf-text.spec.ts` reads a real saved PDF in a
 * child Node process with the same `PDF_OPEN_OPTIONS`.
 */

/** A letter is a few dozen pages at most; refuse a document that claims more. */
const MAX_PAGES = 60;

/**
 * pdf.js options (the document bytes are added by the caller): no system fonts,
 * no font-face injection, and no console noise. pdf.js 6 never evaluates
 * generated code, so there is no `isEvalSupported` switch to turn off.
 */
export const PDF_OPEN_OPTIONS = {
  useSystemFonts: false,
  disableFontFace: true,
  verbosity: 0,
} as const;

export interface PdfTextItem {
  readonly str?: string;
  readonly hasEOL?: boolean;
}

/** The text of the pages: each item's string, a newline where pdf.js ends a line. */
export function pagesToText(
  pages: readonly (readonly PdfTextItem[])[],
): string {
  let text = "";
  for (const items of pages) {
    for (const item of items)
      text += (item.str ?? "") + (item.hasEOL ? "\n" : "");
    text += "\n";
  }
  return text;
}

export async function extractPdfText(bytes: Uint8Array): Promise<string> {
  const pdfjs = await import("pdfjs-dist/legacy/build/pdf.mjs");
  // A copy: pdf.js transfers the buffer to its worker and detaches it.
  const task = pdfjs.getDocument({
    ...PDF_OPEN_OPTIONS,
    data: new Uint8Array(bytes),
  });
  try {
    const document = await task.promise;
    if (document.numPages > MAX_PAGES) {
      throw new Error(`PDF has ${document.numPages} pages`);
    }
    const pages: PdfTextItem[][] = [];
    for (let number = 1; number <= document.numPages; number++) {
      const page = await document.getPage(number);
      const content = await page.getTextContent();
      pages.push(content.items as PdfTextItem[]);
      page.cleanup();
    }
    return pagesToText(pages);
  } finally {
    await task.destroy();
  }
}
