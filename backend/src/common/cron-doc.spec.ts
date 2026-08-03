import { readdirSync, readFileSync, statSync } from "fs";
import { basename, join, resolve } from "path";

/**
 * `docs/cron-jobs.md` is where `backend/CLAUDE.md` sends anyone asking what runs
 * on a schedule. It was missing six of them -- including `auto-backup.service`,
 * the subject of the very audit phase that led here -- and listed one
 * (`auth.service`) whose `@Cron` had moved to `token.service`.
 *
 * That is not a cosmetic gap. Every `@Cron` handler is an out-of-request entry
 * point that has to seed its own RLS context, every replica fires every cron, and
 * several of them send email or grant access. An operator reading the table would
 * not have learned that automatic backups, emergency-access escalation or the
 * matured-holdings rebuild happen at all.
 *
 * So the table is checked against the source in both directions. `@Cron` is a
 * decorator, which makes the source side of this exact rather than a heuristic.
 */
describe("docs/cron-jobs.md matches the @Cron handlers in the source", () => {
  const BACKEND_SRC = resolve(__dirname, "..");
  const DOC_PATH = resolve(BACKEND_SRC, "..", "..", "docs", "cron-jobs.md");

  /** Files under src/ (excluding specs) that declare at least one `@Cron`. */
  const cronServices = (): Map<string, { file: string; handlers: number }> => {
    const found = new Map<string, { file: string; handlers: number }>();
    const walk = (dir: string): void => {
      for (const entry of readdirSync(dir)) {
        const full = join(dir, entry);
        if (statSync(full).isDirectory()) {
          if (entry !== "node_modules") walk(full);
          continue;
        }
        if (!entry.endsWith(".ts") || entry.endsWith(".spec.ts")) continue;
        const source = readFileSync(full, "utf8");
        const handlers = (source.match(/^\s*@Cron\(/gm) ?? []).length;
        if (handlers === 0) continue;
        // The doc names services as `foo.service`, matching the file stem.
        found.set(basename(entry).replace(/\.ts$/, ""), {
          file: full,
          handlers,
        });
      }
    };
    walk(BACKEND_SRC);
    return found;
  };

  const doc = readFileSync(DOC_PATH, "utf8");
  /** Service names in the schedule table's first column. */
  const documented = new Set(
    [...doc.matchAll(/^\|\s*`([a-z0-9-]+\.service)`/gm)].map((m) => m[1]),
  );
  const services = cronServices();

  it("finds handlers and rows at all, so the comparisons are not vacuous", () => {
    // Either side reading empty would make both assertions below pass.
    expect(services.size).toBeGreaterThan(10);
    expect(documented.size).toBeGreaterThan(10);
    expect(services.has("auto-backup.service")).toBe(true);
  });

  it("documents every service that declares a @Cron handler", () => {
    const undocumented = [...services.keys()]
      .filter((name) => !documented.has(name))
      .sort();
    // A scheduled job nobody knows about is one nobody checks the RLS context,
    // the multi-replica behaviour or the failure mode of.
    expect(undocumented).toEqual([]);
  });

  it("names no service that has stopped having one", () => {
    const stale = [...documented].filter((name) => !services.has(name)).sort();
    // `auth.service` sat here after its @Cron moved to `token.service`, so the
    // table pointed at a file with no schedule in it.
    expect(stale).toEqual([]);
  });

  it("accounts for every @Cron handler, not just every service", () => {
    // The table's unit is the job, not the class, but the existing convention
    // allows either shape: a second row, or a second comma-separated schedule in
    // one row's schedule cell. `scheduled-transactions.service` uses two rows;
    // `demo-reset.service` and `budget-alert.service` list two and three
    // schedules in one. Counting schedule parts across a service's rows accepts
    // both and still fails when a service quietly grows a handler -- the case
    // where the doc reads complete and is not.
    const partsPerService = new Map<string, number>();
    for (const [, name, schedule] of doc.matchAll(
      /^\|\s*`([a-z0-9-]+\.service)`\s*\|([^|]*)\|/gm,
    )) {
      const parts = schedule.split(",").filter((s) => s.trim().length > 0);
      partsPerService.set(
        name,
        (partsPerService.get(name) ?? 0) + parts.length,
      );
    }

    const short: string[] = [];
    for (const [name, { handlers }] of services) {
      const documentedParts = partsPerService.get(name);
      // A service missing entirely is the previous test's finding, not this one's.
      if (documentedParts === undefined) continue;
      if (documentedParts < handlers) {
        short.push(
          `${name}: ${handlers} @Cron handler(s), ${documentedParts} schedule(s) documented`,
        );
      }
    }
    expect(short).toEqual([]);
  });
});
