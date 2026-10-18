import { parseReceipt } from "./parse-receipt";
import { MAX_REPEAT_LINES } from "./receipt-parser.types";
import type {
  ReceiptParserDefinition,
  ReceiptRecordStep,
} from "./receipt-parser.types";
import { validateReceiptParserDefinition } from "./receipt-parser.validation";

/** Record step `repeat`: 0 to N consecutive lines, stopping before the next step. */

const CAT = "33333333-3333-4333-8333-333333333333";

const block = (record: ReceiptRecordStep[]): ReceiptParserDefinition => ({
  version: 2,
  role: "settlement",
  items: { record },
  defaultCategoryId: CAT,
});
const read = (def: ReceiptParserDefinition, lines: string[]) =>
  parseReceipt(def, "", lines.join("\n"), null).items.map(
    ({ name, amount, link }) => [name, amount, link],
  );

const errorCodes = (def: unknown): string[] => {
  const result = validateReceiptParserDefinition(def);
  return result.ok ? [] : result.errors.map((e) => `${e.path}:${e.code}`);
};

/**
 * An Allegro Pay repayment part that pays four sellers. The leading repeat step
 * reads the seller lines of the previous part up to the next "umowa", the
 * repeat before the amount reads the date; 6 steps, the most a record may have.
 */
const PART_RECORD: ReceiptRecordStep[] = [
  { line: "*", repeat: true },
  { line: "umowa {name}" },
  { line: "{link}" },
  { line: "*", repeat: true },
  { line: "{amount} zł" },
  { line: "{instalment}" },
];
const SELLERS = ["Sklep A", "Sklep B", "Sklep C", "Sklep D"].flatMap((s) => [
  `Zakup od ${s} z dnia 12.12.2025`,
  `Produkt ${s}`,
  "+ 2 inne",
]);
const REPAYMENT = [
  "Spłacone zakupy",
  "umowa Allegro Pay",
  "1000000001",
  "data zakupu",
  "12.12.2025",
  "109,89 zł",
  "1. spłata z 1",
  "Spłacone przedmioty",
  ...SELLERS,
  "umowa Allegro Pay",
  "1000000002",
  "15.12.2025",
  "163,00 zł",
  "1. spłata z 3",
];

describe("a repeat record step", () => {
  const def = {
    ...block(PART_RECORD),
    items: {
      startAfter: "Spłacone zakupy",
      skipLines: ["data zakupu", "Spłacone przedmioty"],
      record: PART_RECORD,
    },
  };

  it("is accepted by the validator", () => {
    expect(errorCodes(def)).toEqual([]);
  });

  it("reads a part that holds four sellers: link and amount of both parts", () => {
    expect(read(def, REPAYMENT)).toEqual([
      ["Allegro Pay", 1098900, "1000000001"],
      ["Allegro Pay", 1630000, "1000000002"],
    ]);
  });

  it("takes zero lines when the next step already matches", () => {
    const simple = block([
      { line: "{name}" },
      { line: "x*", repeat: true },
      { line: "{amount} zł" },
    ]);
    expect(read(simple, ["Pen", "2,50 zł"])).toEqual([
      ["Pen", 25000, undefined],
    ]);
  });

  it("stops before the first line the next step matches", () => {
    const simple = block([
      { line: "{name}" },
      { line: "*", repeat: true },
      { line: "{amount} zł" },
    ]);
    expect(read(simple, ["Pen", "a", "b", "c", "2,50 zł"])).toEqual([
      ["Pen", 25000, undefined],
    ]);
  });

  it("stops at the first line that does not match its own pattern", () => {
    const simple = block([
      { line: "{name}" },
      { line: "note*", repeat: true },
      { line: "{amount} zł" },
    ]);
    // "other" ends the repeat, so the record that began at "Pen" fails; the
    // cursor then finds the record "other" + amount.
    expect(read(simple, ["Pen", "note 1", "other", "2,50 zł"])).toEqual([
      ["other", 25000, undefined],
    ]);
    expect(read(simple, ["Pen", "note 1", "note 2", "2,50 zł"])).toEqual([
      ["Pen", 25000, undefined],
    ]);
  });

  it(`takes at most ${MAX_REPEAT_LINES} lines`, () => {
    const simple = block([
      { line: "{name}" },
      { line: "*", repeat: true },
      { line: "{amount} zł" },
    ]);
    const filler = (n: number) => Array.from({ length: n }, () => "filler");
    expect(
      read(simple, ["Pen", ...filler(MAX_REPEAT_LINES), "2,50 zł"]),
    ).toEqual([["Pen", 25000, undefined]]);
    // One line over the cap: the record from "Pen" fails (the amount step meets
    // "filler"); the item is the last "filler" line with the amount.
    expect(
      read(simple, ["Pen", ...filler(MAX_REPEAT_LINES + 1), "2,50 zł"]),
    ).toEqual([["filler", 25000, undefined]]);
  });

  it("at the end of a record takes the lines that match, up to the cap", () => {
    const tail = block([
      { line: "{name}" },
      { line: "{amount} zł" },
      { line: "+*", repeat: true },
    ]);
    expect(
      read(tail, ["Pen", "2,50 zł", "+ a", "+ b", "Pen2", "1,00 zł"]),
    ).toEqual([
      ["Pen", 25000, undefined],
      ["Pen2", 10000, undefined],
    ]);
  });
});

describe("repeat validation", () => {
  const withStep = (step: Record<string, unknown>) =>
    block([{ line: "{name}" }, step as unknown as ReceiptRecordStep]);

  it("accepts a capture-free single-line step", () => {
    expect(errorCodes(withStep({ line: "*", repeat: true }))).toEqual([]);
    expect(errorCodes(withStep({ line: ["a*", "b*"], repeat: true }))).toEqual(
      [],
    );
  });

  it("refuses a repeat step that captures", () => {
    expect(errorCodes(withStep({ line: "{amount} zł", repeat: true }))).toEqual(
      ["items.record[1].line:repeat_step_captures"],
    );
  });

  it("refuses a multi-line repeat pattern", () => {
    expect(errorCodes(withStep({ line: "a\\nb", repeat: true }))).toEqual([
      "items.record[1].line:repeat_step_multiline",
    ]);
  });

  it("refuses a repeat that is not a boolean", () => {
    expect(errorCodes(withStep({ line: "a*", repeat: "yes" }))).toEqual([
      "items.record[1].repeat:invalid_type",
    ]);
  });

  it("allows repeat false on a capturing step", () => {
    expect(
      errorCodes(withStep({ line: "{amount} zł", repeat: false })),
    ).toEqual([]);
  });
});
