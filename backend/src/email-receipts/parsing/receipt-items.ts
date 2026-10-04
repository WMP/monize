import type { GlobCaptures } from "../../transaction-rules/rule-glob-capture";
import {
  isStrictReceiptAmount,
  parseReceiptAmount,
  parseReceiptQty,
} from "./receipt-amount";
import { matchReceiptPattern } from "./receipt-glob";
import { itemSectionRange, traceLine } from "./receipt-lines";
import {
  MAX_ITEMS,
  MAX_JOINED_LINES,
  ReceiptBlockItemsDefinition,
  ReceiptItemsDefinition,
  ReceiptParserDefinition,
  ReceiptRecordStep,
  ReceiptSingleItemsDefinition,
  ReceiptTraceItem,
} from "./receipt-parser.types";

/** The line items of an email (design 5.1): one per line, a multi-line record, or one for the whole email. */

// ----------------------------------------------------------------- items

/** Name, qty and line total in units from the captures of an item; the amount is null when none was captured. */
interface ItemFields {
  name: string;
  qty: number;
  amount: number | null;
}

/**
 * Name and qty from the captures of an item pattern or record, and the line
 * total: the `amount` capture, else the unit `price` times qty, else null (the
 * item then takes the email's total if it is the only item). Null when the
 * captures do not read at all.
 */
function readItemFields(captures: GlobCaptures): ItemFields | null {
  const name = captures.name?.trim() ?? "";
  if (name === "") return null;
  const qty = captures.qty === undefined ? 1 : parseReceiptQty(captures.qty);
  if (qty === null) return null;
  const money = captures.amount ?? captures.price;
  if (money === undefined) return { name, qty, amount: null };
  const units = parseReceiptAmount(money);
  if (units === null || !isStrictReceiptAmount(money)) return null;
  const amount = captures.amount === undefined ? units * qty : units;
  return Number.isSafeInteger(amount) ? { name, qty, amount } : null;
}

/** What an item looks like before its category is known. */
export interface RawItem extends ItemFields {
  trace: ReceiptTraceItem;
}

/** One item line read by one pattern, or null when neither reading of the line is usable. */
function readLineItem(line: string, pattern: string): ItemFields | null {
  const captures = matchReceiptPattern(pattern, line, (c) => {
    const read = readItemFields(c);
    return read !== null && read.amount !== null;
  });
  return captures === null ? null : readItemFields(captures);
}

/**
 * One item per line: each line of the section is read by the first pattern
 * that reads it. With `joinWrapped`, a line no pattern reads is held (the last
 * three) and put in front of the next line, joined by a space, before the
 * patterns are tried on that; an emitted item clears what was held.
 */
function readPatternItems(
  items: ReceiptItemsDefinition,
  lines: readonly string[],
): RawItem[] {
  const { start, end } = itemSectionRange(
    lines,
    items.startAfter,
    items.stopAt,
  );
  const join = items.joinWrapped === true;
  const out: RawItem[] = [];
  let held: number[] = [];
  for (let at = start; at < end; at++) {
    const read = readJoinedLine(items.patterns, lines, held, at);
    if (read !== null) {
      out.push({
        ...read.item,
        trace: {
          mode: "patterns",
          patterns: [read.pattern],
          lines: [...read.used, at].map((index) => traceLine(lines, index)),
        },
      });
      held = [];
      if (out.length >= MAX_ITEMS) break;
    } else if (join) {
      held.push(at);
      if (held.length > MAX_JOINED_LINES) held.shift();
    }
  }
  return out;
}

/**
 * One line read by the first pattern that reads it. With held lines the whole
 * buffer is put in front of the line first; when that does not read, a shorter
 * buffer is tried (the last `n - 1` held lines, down to none), so a stray
 * unread line before a one-line item does not hide the item.
 */
function readJoinedLine(
  patterns: readonly string[],
  lines: readonly string[],
  held: readonly number[],
  at: number,
): { item: ItemFields; pattern: string; used: number[] } | null {
  for (let keep = held.length; keep >= 0; keep--) {
    const used = held.slice(held.length - keep);
    const text = keep
      ? `${used.map((index) => lines[index]).join(" ")} ${lines[at]}`
      : lines[at];
    for (const pattern of patterns) {
      const item = readLineItem(text, pattern);
      if (item !== null) return { item, pattern, used };
    }
  }
  return null;
}

/** A step's reading of a line is usable only when every value it captured reads. */
const acceptStep = (captures: GlobCaptures): boolean => {
  if (captures.name !== undefined && captures.name.trim() === "") return false;
  for (const money of [captures.amount, captures.price]) {
    if (money !== undefined && !isStrictReceiptAmount(money)) return false;
  }
  return captures.qty === undefined || parseReceiptQty(captures.qty) !== null;
};

/** The globs of a record step: its `line`, or its alternatives in order. */
const stepGlobs = (step: ReceiptRecordStep): readonly string[] =>
  typeof step.line === "string" ? [step.line] : step.line;

/**
 * Read one record at `start` of the section's lines: each step consumes the
 * line under the cursor when one of its globs matches and the values read (the
 * alternatives in order, the first that reads wins); an optional step that does
 * not match consumes nothing, a required one fails the record. The captures of
 * all the steps are one item (a capture name belongs to one step).
 */
function readRecord(
  record: readonly ReceiptRecordStep[],
  section: readonly number[],
  lines: readonly string[],
  start: number,
): { item: RawItem; next: number } | null {
  const merged: Record<string, string> = Object.create(null);
  const used: number[] = [];
  const patterns: string[] = [];
  let at = start;
  for (const step of record) {
    let taken: { glob: string; captures: GlobCaptures } | null = null;
    if (at < section.length) {
      for (const glob of stepGlobs(step)) {
        const captures = matchReceiptPattern(
          glob,
          lines[section[at]],
          acceptStep,
        );
        if (captures !== null) {
          taken = { glob, captures };
          break;
        }
      }
    }
    if (taken === null) {
      if (step.optional === true) continue;
      return null;
    }
    for (const [name, value] of Object.entries(taken.captures)) {
      if (!(name in merged)) merged[name] = value;
    }
    patterns.push(taken.glob);
    used.push(section[at]);
    at++;
  }
  const fields = readItemFields(merged);
  if (fields === null) return null;
  return {
    item: {
      ...fields,
      trace: {
        mode: "record",
        patterns,
        lines: used.map((index) => traceLine(lines, index)),
      },
    },
    next: at,
  };
}

/** Block items: the section minus its `skipLines`, then a record read from a cursor. */
function readBlockItems(
  items: ReceiptBlockItemsDefinition,
  lines: readonly string[],
): RawItem[] {
  const skip = items.skipLines ?? [];
  const { start, end } = itemSectionRange(
    lines,
    items.startAfter,
    items.stopAt,
  );
  const section: number[] = [];
  for (let at = start; at < end; at++) {
    const dropped = skip.some(
      (glob) => matchReceiptPattern(glob, lines[at], () => true) !== null,
    );
    if (!dropped) section.push(at);
  }
  const out: RawItem[] = [];
  let cursor = 0;
  while (cursor < section.length && out.length < MAX_ITEMS) {
    const read = readRecord(items.record, section, lines, cursor);
    if (read === null) {
      // A failed record moves the cursor one line, so the next product is found.
      cursor += 1;
      continue;
    }
    out.push(read.item);
    cursor = Math.max(read.next, cursor + 1);
  }
  return out;
}

/** One item for the whole email: its name from the first section line the glob reads; its amount comes later. */
function readSingleItem(
  items: ReceiptSingleItemsDefinition,
  lines: readonly string[],
): RawItem[] {
  const { start, end } = itemSectionRange(
    lines,
    items.startAfter,
    items.stopAt,
  );
  const glob = items.single?.name;
  if (typeof glob !== "string") return [];
  for (let at = start; at < end; at++) {
    const captures = matchReceiptPattern(
      glob,
      lines[at],
      (c) => (c.name ?? "") !== "",
    );
    if (captures !== null) {
      return [
        {
          name: captures.name,
          qty: 1,
          amount: null,
          trace: {
            mode: "single",
            patterns: [glob],
            lines: [traceLine(lines, at)],
          },
        },
      ];
    }
  }
  return [];
}

export function readItems(
  def: ReceiptParserDefinition,
  lines: readonly string[],
): RawItem[] {
  const items = def.items;
  if (!items) return [];
  if ("record" in items) return readBlockItems(items, lines);
  if ("single" in items) return readSingleItem(items, lines);
  return readPatternItems(items, lines);
}
