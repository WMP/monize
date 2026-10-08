import { readdirSync, readFileSync } from "fs";
import { join } from "path";

/**
 * `backend/src/loan-installments/` is the neutral loan core: functions over an
 * `EntityManager` that the scheduled-transaction service, the amortization
 * report and the rules engine's `settle_loan_installment` action all price
 * through (`docs/specs/loan-installment-settlement.md`, "Design"). The rules
 * engine can call it only while it stays neutral: an import of a service from
 * `transactions/`, of either scheduled-transaction service, or of anything in
 * `transaction-rules/` would put the core on a require cycle with its callers
 * (`src/module-graph.spec.ts` names the symptom), and an `@Injectable` would
 * make it a provider some module has to own. Entities are data and stay
 * allowed, as does `schedule-cursor.ts`, which is a function too.
 *
 * A scan rather than a review note because the core is extended by several
 * later tasks, each adding files that would each need the same reminder.
 */
const CORE_DIR = __dirname;

/** Module specifiers, relative to `src/`, the core may not import from. */
const BANNED_SPECIFIERS: ReadonlyArray<{ pattern: RegExp; because: string }> = [
  {
    pattern: /^transactions\/(?!entities\/)/,
    because:
      "the transaction services call the rules engine, which calls the core",
  },
  {
    pattern: /^transaction-rules\/(?!entities\/)/,
    because: "the rules engine is the core's caller",
  },
  {
    pattern: /^scheduled-transactions\/scheduled-transactions\.service(\.|$)/,
    because: "ScheduledTransactionsService posts through the core",
  },
  {
    pattern:
      /^scheduled-transactions\/scheduled-transaction-loan\.service(\.|$)/,
    because: "ScheduledTransactionLoanService delegates to the core",
  },
];

/** Comments are blanked, line numbers preserved: this file's own prose and the
 *  core's doc comments name the very paths the scan bans. */
export function stripComments(source: string): string {
  return source
    .replace(/\/\*[\s\S]*?\*\//g, (m) => m.replace(/[^\n]/g, " "))
    .replace(/\/\/[^\n]*/g, (m) => " ".repeat(m.length));
}

/**
 * Every module specifier `source` imports, re-exports, `import()`s or
 * `require()`s, normalised so a sibling directory reads the same whether
 * spelled `../x` or through the `@/x` alias. Same-directory (`./x`) and
 * package specifiers are returned as written.
 */
export function importSpecifiers(source: string): string[] {
  const stripped = stripComments(source);
  const found: string[] = [];
  const patterns = [
    /\bfrom\s*["']([^"']+)["']/g,
    /\bimport\s*\(\s*["']([^"']+)["']\s*\)/g,
    /\brequire\s*\(\s*["']([^"']+)["']\s*\)/g,
    // `import "side-effect"` with no bindings.
    /\bimport\s+["']([^"']+)["']/g,
  ];
  for (const pattern of patterns) {
    for (const match of stripped.matchAll(pattern)) {
      found.push(match[1]);
    }
  }
  return found.map((specifier) =>
    specifier.startsWith("../")
      ? specifier.slice("../".length)
      : specifier.startsWith("@/")
        ? specifier.slice("@/".length)
        : specifier,
  );
}

/**
 * The offences in one source: a banned import, or `Injectable` taken from
 * `@nestjs/common` (named, aliased or used as a decorator).
 */
export function coreOffences(source: string): string[] {
  const offences: string[] = [];
  for (const specifier of importSpecifiers(source)) {
    const ban = BANNED_SPECIFIERS.find(({ pattern }) =>
      pattern.test(specifier),
    );
    if (ban) {
      offences.push(`imports "${specifier}": ${ban.because}`);
    }
  }
  const stripped = stripComments(source);
  const nestImports = stripped.matchAll(
    /\bimport\s*\{([^}]*)\}\s*from\s*["']@nestjs\/common["']/g,
  );
  for (const match of nestImports) {
    const names = match[1]
      .split(",")
      .map((name) => name.trim().split(/\s+as\s+/)[0]);
    if (names.includes("Injectable")) {
      offences.push(
        "imports Injectable from @nestjs/common: the core is functions, not a provider",
      );
    }
  }
  if (/@Injectable\s*\(/.test(stripped)) {
    offences.push("declares an @Injectable provider");
  }
  return offences;
}

/** The core's production sources: every `.ts` in this directory but the specs. */
function coreSources(): Array<[string, string]> {
  return readdirSync(CORE_DIR)
    .filter((name) => name.endsWith(".ts") && !name.endsWith(".spec.ts"))
    .sort()
    .map((name) => [name, readFileSync(join(CORE_DIR, name), "utf8")]);
}

describe("the loan core imports no caller and declares no provider", () => {
  it("blanks comments while preserving line numbers", () => {
    const stripped = stripComments(
      'a\n// import { x } from "../transactions/x";\n/* from "../transaction-rules/y" */\nb',
    );
    expect(stripped.split("\n")).toHaveLength(4);
    expect(stripped).not.toContain("transactions");
  });

  it("scans the files it claims to", () => {
    const names = coreSources().map(([name]) => name);
    expect(names).toEqual(
      expect.arrayContaining(["price-installment.ts", "reprice-template.ts"]),
    );
  });

  it("finds every core file clean", () => {
    const offenders = coreSources()
      .map(([name, source]) => [name, coreOffences(source)] as const)
      .filter(([, offences]) => offences.length > 0);
    expect(offenders).toEqual([]);
  });

  it.each([
    [
      'import { TransactionsService } from "../transactions/transactions.service";',
    ],
    ['import { SplitKind } from "@/transactions/split-kind";'],
    ['import { planRuleEffects } from "../transaction-rules/rule-effects";'],
    [
      'import { ScheduledTransactionsService } from "../scheduled-transactions/scheduled-transactions.service";',
    ],
    [
      'import {\n  ScheduledTransactionLoanService,\n} from "../scheduled-transactions/scheduled-transaction-loan.service";',
    ],
    ['const svc = await import("../transactions/transactions.service");'],
    ['const svc = require("../transaction-rules/transaction-rules.service");'],
    ['export { x } from "../transactions/transaction-split.service";'],
    ['import { Injectable, Logger } from "@nestjs/common";'],
    ['import { Injectable as Provider } from "@nestjs/common";'],
    ["@Injectable()\nexport class LoanCore {}"],
  ])("trips on a planted offence: %s", (planted) => {
    // A negative control: a scan that cannot fail is not a guard.
    expect(coreOffences(`${planted}\nexport const x = 1;\n`)).not.toEqual([]);
  });

  it.each([
    [
      'import { ScheduledTransaction } from "../scheduled-transactions/entities/scheduled-transaction.entity";',
    ],
    ['import { SplitKind } from "../transactions/entities/split-kind.enum";'],
    [
      'import { TransactionRule } from "../transaction-rules/entities/transaction-rule.entity";',
    ],
    [
      'import { advanceScheduleCursor } from "../scheduled-transactions/schedule-cursor";',
    ],
    ['import { Logger } from "@nestjs/common";'],
    ['import { priceInstallment } from "./price-installment";'],
    [
      '// see ../transactions/transactions.service and @Injectable()\n/* import { Injectable } from "@nestjs/common"; */',
    ],
  ])("accepts what the core is allowed: %s", (allowed) => {
    expect(coreOffences(`${allowed}\nexport const x = 1;\n`)).toEqual([]);
  });
});
