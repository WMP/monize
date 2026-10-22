import { readFileSync } from "fs";
import { join } from "path";

const SRC_ROOT = join(__dirname, "..");

/**
 * Blank out comments while preserving every line break, so a reported
 * offender still points at the right line. The rule has to be explained in
 * prose that names the table, and a scan over raw text would fail on its own
 * explanations (`docs/guard-tests.md`).
 */
export function blankComments(source: string): string {
  return source
    .replace(/\/\*[\s\S]*?\*\//g, (block) => block.replace(/[^\n]/g, " "))
    .replace(/(^|[^:])\/\/[^\n]*/g, (match, prefix: string) =>
      prefix.concat(" ".repeat(match.length - prefix.length)),
    );
}

/**
 * The reads that answer a question about a TRANSACTION's attachments. Each
 * is transaction-bound by design and must stay so now that the table also
 * holds a warranty's documents (WTY-003): the register's paperclip count and
 * its `hasAttachments` filter, the `has:attachment` search term, and the
 * rule engine's attachment fact.
 */
const TRANSACTION_BOUND_FILES = [
  "transactions/transactions.service.ts",
  "transactions/transaction-search.util.ts",
  "transaction-rules/rule-facts.ts",
] as const;

/** A query site: raw SQL naming the table, or the entity's repository. */
const QUERY_SITE =
  /getRepository\(\s*TransactionAttachment\s*\)|\btransaction_attachments\b/g;

/** The restriction every site must carry, in either dialect. */
const PARENT_RESTRICTION = /\btransaction_id\b|\btransactionId\b/;

/**
 * Where a site's statement ends: the next semicolon. Both dialects used in
 * these files end their statement there -- a template literal holding an
 * EXISTS subquery, and a query-builder chain closed by `getRawMany()`.
 */
function statementFrom(source: string, index: number): string {
  const end = source.indexOf(";", index);
  return source.slice(index, end === -1 ? source.length : end);
}

interface Offender {
  file: string;
  line: number;
}

/**
 * Every query site in `source` that names the attachments table or
 * repository without restricting on the transaction column.
 */
export function unboundAttachmentSites(
  source: string,
  file = "<source>",
): Offender[] {
  const code = blankComments(source);
  const offenders: Offender[] = [];
  for (const match of code.matchAll(QUERY_SITE)) {
    const index = match.index ?? 0;
    if (PARENT_RESTRICTION.test(statementFrom(code, index))) continue;
    const line = code.slice(0, index).split("\n").length;
    offenders.push({ file, line });
  }
  return offenders;
}

/**
 * A warranty's document never counts as a transaction's.
 *
 * `transaction_attachments` carries two parent columns and exactly one is
 * set (`chk_attachment_one_parent`). A read that filters on `user_id` alone,
 * or joins the table without naming `transaction_id`, now answers with a
 * warranty's receipts and manuals too -- a paperclip on a row that has no
 * attachment, a `has:attachment` match the register cannot show, a rule
 * that fires on a document the transaction never had. This scan fails the
 * moment one of the transaction-bound reads drops its `transaction_id` /
 * `transactionId` restriction.
 */
describe("a transaction-bound attachment read restricts on transaction_id (WTY-003)", () => {
  const sources = TRANSACTION_BOUND_FILES.map((rel) => ({
    rel,
    source: readFileSync(join(SRC_ROOT, rel), "utf8"),
  }));

  it("finds query sites in every scanned file", () => {
    // A renamed table or a moved read would make the assertion below vacuous.
    const counts = sources.map(({ rel, source }) => ({
      rel,
      sites: [...blankComments(source).matchAll(QUERY_SITE)].length,
    }));
    for (const { sites } of counts) expect(sites).toBeGreaterThan(0);
  });

  it("names the transaction column at every site", () => {
    // Each entry carries the rule, so the failure output says what to do: a
    // read of transaction_attachments that answers for a transaction has to
    // say which transaction, with the parent helper in attachment-parent.ts.
    const offenders = sources.flatMap(({ rel, source }) =>
      unboundAttachmentSites(source, rel).map(
        ({ file, line }) =>
          `WTY-003: ${file}:${line} reads transaction_attachments without a ` +
          `transaction_id / transactionId restriction, so a warranty's ` +
          `documents would count as the transaction's; restrict on the ` +
          `parent (attachments/attachment-parent.ts)`,
      ),
    );

    expect(offenders).toEqual([]);
  });

  // The scan is only worth anything if it would actually catch the thing it
  // bans, so both directions are asserted rather than assumed.
  describe("the scan itself", () => {
    it("catches a raw EXISTS that names only the user", () => {
      const code =
        "const sql = `EXISTS (SELECT 1 FROM transaction_attachments ta " +
        "WHERE ta.user_id = :userId)`;";
      expect(unboundAttachmentSites(code)).toEqual([
        { file: "<source>", line: 1 },
      ]);
    });

    it("catches a repository read that filters on the user alone", () => {
      const code =
        "const n = await m.getRepository(TransactionAttachment)\n" +
        "  .count({ where: { userId } });\n";
      expect(unboundAttachmentSites(code)).toEqual([
        { file: "<source>", line: 1 },
      ]);
    });

    it("accepts a raw EXISTS restricted on transaction_id", () => {
      const code =
        "const sql = `EXISTS (SELECT 1 FROM transaction_attachments ta " +
        "WHERE ta.transaction_id = t.id)`;";
      expect(unboundAttachmentSites(code)).toEqual([]);
    });

    it("accepts a query builder restricted on transactionId", () => {
      const code =
        "const rows = await m.getRepository(TransactionAttachment)\n" +
        '  .createQueryBuilder("ta")\n' +
        '  .where("ta.transactionId IN (:...ids)", { ids })\n' +
        "  .getRawMany();\n";
      expect(unboundAttachmentSites(code)).toEqual([]);
    });

    it("does not read a restriction from the next statement", () => {
      // The restriction has to be in the SAME statement; one that follows the
      // semicolon belongs to another query.
      const code =
        "const a = `SELECT 1 FROM transaction_attachments ta WHERE ta.user_id = $1`;\n" +
        "const b = `SELECT transaction_id FROM transactions`;\n";
      expect(unboundAttachmentSites(code)).toEqual([
        { file: "<source>", line: 1 },
      ]);
    });

    it("ignores the table named in a comment", () => {
      const code =
        "// an EXISTS against transaction_attachments\n" +
        "/* getRepository(TransactionAttachment) is read elsewhere */\n" +
        "const x = 1;\n";
      expect(unboundAttachmentSites(code)).toEqual([]);
    });

    it("reports the line of the offending site", () => {
      const code =
        "const ok = 1;\n" +
        "const bad = `SELECT 1 FROM transaction_attachments WHERE user_id = $1`;\n";
      expect(unboundAttachmentSites(code)).toEqual([
        { file: "<source>", line: 2 },
      ]);
    });
  });
});
