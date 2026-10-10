import { readFileSync } from "fs";
import { join } from "path";
import { BenchmarkFetchError, BondFetch } from "../../bond-adapter";
import { POLISH_BOND_ADAPTER } from ".";
import {
  findCsvLink,
  fetchGusCpi,
  GUS_CPI_CSV_URL,
  GUS_CPI_LANDING_URL,
  parseGusCpiCsv,
} from "./pl-gus-cpi";
import {
  fetchNbpReference,
  mergeObservations,
  NBP_ARCHIVE_URL,
  NBP_CURRENT_URL,
  parseNbpArchive,
  parseNbpCurrent,
} from "./pl-nbp-reference";

const fixture = (name: string) =>
  readFileSync(join(__dirname, "fixtures", name));
const text = (name: string) => fixture(name).toString("utf8");
const bytes = (value: string) => new TextEncoder().encode(value);

function routes(
  table: Record<string, { status: number; body: Uint8Array }>,
): jest.MockedFunction<BondFetch> {
  return jest.fn(async (url: string) => {
    const hit = table[url];
    if (!hit) throw new Error(`unexpected url ${url}`);
    return hit;
  });
}

describe("NBP reference rate parsers", () => {
  it("reads the reference rows of the archive, BOM and comma decimals included", () => {
    expect(text("nbp-archive.xml").charCodeAt(0)).toBe(0xfeff);
    const rows = parseNbpArchive(text("nbp-archive.xml"));
    expect(rows).toHaveLength(5);
    expect(rows[0]).toEqual({
      observationDate: "1998-02-26",
      value: "0.2400",
      publishedOn: null,
    });
    expect(rows[rows.length - 1]).toEqual({
      observationDate: "2026-03-05",
      value: "0.0375",
      publishedOn: null,
    });
  });

  it("reads the reference rate of the current table with its own date", () => {
    expect(parseNbpCurrent(text("nbp-current.xml"))).toEqual([
      {
        observationDate: "2026-03-05",
        value: "0.0375",
        publishedOn: "2026-03-05",
      },
    ]);
  });

  it("keeps only the reference rate, not the other rates of a decision", () => {
    const xml = `<stopy_procentowe_archiwum><pozycje obowiazuje_od="2020-05-29">
      <pozycja id="lom" oprocentowanie="1,00"/><pozycja id="ref" oprocentowanie="0,10"/></pozycje>
      <pozycje obowiazuje_od="2020-06-01"><pozycja id="lom" oprocentowanie="9,00"/></pozycje>
      </stopy_procentowe_archiwum>`;
    expect(parseNbpArchive(xml)).toEqual([
      { observationDate: "2020-05-29", value: "0.0010", publishedOn: null },
    ]);
  });

  it.each([
    [
      "no reference rows",
      "<stopy_procentowe_archiwum></stopy_procentowe_archiwum>",
    ],
    ["a different document", "<html></html>"],
    [
      "a malformed date",
      '<stopy_procentowe_archiwum><pozycje obowiazuje_od="2020-13-40"><pozycja id="ref" oprocentowanie="1,00"/></pozycje></stopy_procentowe_archiwum>',
    ],
    [
      "a missing date",
      '<stopy_procentowe_archiwum><pozycje><pozycja id="ref" oprocentowanie="1,00"/></pozycje></stopy_procentowe_archiwum>',
    ],
    [
      "a malformed number",
      '<stopy_procentowe_archiwum><pozycje obowiazuje_od="2020-05-29"><pozycja id="ref" oprocentowanie="n/a"/></pozycje></stopy_procentowe_archiwum>',
    ],
  ])("refuses an archive with %s", (_name, xml) => {
    expect(() => parseNbpArchive(xml)).toThrow(BenchmarkFetchError);
  });

  it("refuses a current table without a usable reference row", () => {
    expect(() => parseNbpCurrent("<x/>")).toThrow(BenchmarkFetchError);
    expect(() =>
      parseNbpCurrent("<stopy_procentowe></stopy_procentowe>"),
    ).toThrow(/no reference/);
    expect(() =>
      parseNbpCurrent(
        '<stopy_procentowe><pozycja id="ref" oprocentowanie="3,75" obowiazuje_od="x"/></stopy_procentowe>',
      ),
    ).toThrow(/malformed date/);
  });

  it("merges by date, the later set winning, in date order", () => {
    const merged = mergeObservations(
      [
        { observationDate: "2026-03-05", value: "0.0400", publishedOn: null },
        { observationDate: "2026-01-01", value: "0.0450", publishedOn: null },
      ],
      [{ observationDate: "2026-03-05", value: "0.0375", publishedOn: null }],
    );
    expect(merged.map((o) => [o.observationDate, o.value])).toEqual([
      ["2026-01-01", "0.0450"],
      ["2026-03-05", "0.0375"],
    ]);
  });

  it("fetches both documents and covers through the fetch date", async () => {
    const fetch = routes({
      [NBP_ARCHIVE_URL]: { status: 200, body: fixture("nbp-archive.xml") },
      [NBP_CURRENT_URL]: { status: 200, body: fixture("nbp-current.xml") },
    });
    const result = await fetchNbpReference(fetch, "2026-10-10");
    expect(result.coveredThrough).toBe("2026-10-10");
    expect(result.observations).toHaveLength(5);
    expect(result.sourceUrl).toBe(NBP_ARCHIVE_URL);
  });

  it("refuses a non-200 answer", async () => {
    const fetch = routes({
      [NBP_ARCHIVE_URL]: { status: 503, body: new Uint8Array() },
    });
    await expect(fetchNbpReference(fetch, "2026-10-10")).rejects.toThrow(
      /HTTP 503/,
    );
  });
});

describe("GUS CPI parser", () => {
  it("decodes windows-1250 and turns the index into a fraction", () => {
    const decoded = new TextDecoder("windows-1250").decode(
      fixture("gus-cpi.csv"),
    );
    const rows = parseGusCpiCsv(decoded);
    expect(rows.map((r) => [r.observationDate, r.value])).toEqual([
      ["2025-10-01", "0.0280"],
      ["2025-11-01", "0.0250"],
      ["2025-12-01", "0.0240"],
      ["2026-07-01", "0.0300"],
      ["2026-08-01", "0.0340"],
    ]);
  });

  it("skips empty values (unpublished months) and other presentations", () => {
    const rows = parseGusCpiCsv(
      new TextDecoder("windows-1250").decode(fixture("gus-cpi.csv")),
    );
    expect(rows.some((r) => r.observationDate === "2026-09-01")).toBe(false);
    expect(rows).toHaveLength(5);
  });

  it("skips a territory other than Polska and handles a negative change", () => {
    const csv = [
      "Nazwa zmiennej;Jednostka terytorialna;Sposób prezentacji;Rok;Miesiąc;Wartość;Flaga;;",
      "W;Mazowieckie;Analogiczny miesiąc poprzedniego roku = 100;2026;1;110,0;;;",
      "W;Polska;Analogiczny miesiąc poprzedniego roku = 100;2026;1;99,8;;;",
    ].join("\r\n");
    expect(parseGusCpiCsv(csv)).toEqual([
      { observationDate: "2026-01-01", value: "-0.0020", publishedOn: null },
    ]);
  });

  it.each([
    ["a changed header", "a;b;c\r\n"],
    [
      "no usable rows",
      "Nazwa zmiennej;Jednostka terytorialna;Sposób prezentacji;Rok;Miesiąc;Wartość;Flaga;;\r\nW;Polska;Analogiczny miesiąc poprzedniego roku = 100;2026;9;;;;\r\n",
    ],
    [
      "a malformed value",
      "Nazwa zmiennej;Jednostka terytorialna;Sposób prezentacji;Rok;Miesiąc;Wartość;Flaga;;\r\nW;Polska;Analogiczny miesiąc poprzedniego roku = 100;2026;9;x;;;\r\n",
    ],
    [
      "a malformed month",
      "Nazwa zmiennej;Jednostka terytorialna;Sposób prezentacji;Rok;Miesiąc;Wartość;Flaga;;\r\nW;Polska;Analogiczny miesiąc poprzedniego roku = 100;2026;13;103,0;;;\r\n",
    ],
    [
      "a duplicate month",
      "Nazwa zmiennej;Jednostka terytorialna;Sposób prezentacji;Rok;Miesiąc;Wartość;Flaga;;\r\nW;Polska;Analogiczny miesiąc poprzedniego roku = 100;2026;1;103,0;;;\r\nW;Polska;Analogiczny miesiąc poprzedniego roku = 100;2026;1;103,1;;;\r\n",
    ],
  ])("refuses %s", (_name, csv) => {
    expect(() => parseGusCpiCsv(csv)).toThrow(BenchmarkFetchError);
  });

  it("finds the CSV link on the landing page, absolute or relative", () => {
    const html = `<a href="/x/other.csv">o</a><a href="/download/gfx/a/miesiecznewskaznikicentowarowiuslugkonsumpcyjnychod1982roku_9.csv">c</a>`;
    expect(findCsvLink(html)).toBe(
      "https://stat.gov.pl/download/gfx/a/miesiecznewskaznikicentowarowiuslugkonsumpcyjnychod1982roku_9.csv",
    );
    expect(
      findCsvLink(
        '<a href="https://cdn.example/miesiecznewskaznikicentowarowiuslugkonsumpcyjnychod1982roku_9.csv">',
      ),
    ).toMatch(/^https:\/\/cdn\.example/);
    expect(findCsvLink("<a href='/x'>")).toBeNull();
  });

  it("fetches the file and covers through the newest month", async () => {
    const fetch = routes({
      [GUS_CPI_CSV_URL]: { status: 200, body: fixture("gus-cpi.csv") },
    });
    const result = await fetchGusCpi(fetch);
    expect(result.coveredThrough).toBe("2026-08-01");
    expect(result.sourceUrl).toBe(GUS_CPI_CSV_URL);
  });

  it("falls back to the landing page when the numbered file is gone", async () => {
    const next =
      "https://stat.gov.pl/download/gfx/a/miesiecznewskaznikicentowarowiuslugkonsumpcyjnychod1982roku_9.csv";
    const fetch = routes({
      [GUS_CPI_CSV_URL]: { status: 404, body: new Uint8Array() },
      [GUS_CPI_LANDING_URL]: {
        status: 200,
        body: bytes(
          `<a href="/download/gfx/a/miesiecznewskaznikicentowarowiuslugkonsumpcyjnychod1982roku_9.csv">`,
        ),
      },
      [next]: { status: 200, body: fixture("gus-cpi.csv") },
    });
    const result = await fetchGusCpi(fetch);
    expect(result.sourceUrl).toBe(next);
  });

  it("fails clearly when the fallback cannot help", async () => {
    const gone = { status: 404, body: new Uint8Array() };
    await expect(
      fetchGusCpi(
        routes({ [GUS_CPI_CSV_URL]: gone, [GUS_CPI_LANDING_URL]: gone }),
      ),
    ).rejects.toThrow(/landing page HTTP 404/);
    await expect(
      fetchGusCpi(
        routes({
          [GUS_CPI_CSV_URL]: gone,
          [GUS_CPI_LANDING_URL]: { status: 200, body: bytes("<html></html>") },
        }),
      ),
    ).rejects.toThrow(/no CSV link/);
    await expect(
      fetchGusCpi(
        routes({ [GUS_CPI_CSV_URL]: { status: 500, body: new Uint8Array() } }),
      ),
    ).rejects.toThrow(/HTTP 500/);
  });
});

describe("Polish adapter contract", () => {
  it("declares two series, each under its own tracked provider", () => {
    expect(POLISH_BOND_ADAPTER.countryCode).toBe("PL");
    expect(
      POLISH_BOND_ADAPTER.benchmarks.map((b) => [b.code, b.kind, b.providerId]),
    ).toEqual([
      ["PL_NBP_REFERENCE", "STEP", "nbp"],
      ["PL_CPI_GUS_YOY", "MONTHLY", "gus"],
    ]);
  });

  it("catalogs the eight series at terms version 1", () => {
    expect(POLISH_BOND_ADAPTER.catalog).toHaveLength(8);
    expect(
      POLISH_BOND_ADAPTER.catalog.every(
        (e) => e.termsVersion === 1 && e.publishedAt === "2026-09-21",
      ),
    ).toBe(true);
  });

  it("routes each series to its fetcher and refuses an unknown one", async () => {
    const fetch = routes({
      [NBP_ARCHIVE_URL]: { status: 200, body: fixture("nbp-archive.xml") },
      [NBP_CURRENT_URL]: { status: 200, body: fixture("nbp-current.xml") },
      [GUS_CPI_CSV_URL]: { status: 200, body: fixture("gus-cpi.csv") },
    });
    expect(
      (await POLISH_BOND_ADAPTER.fetchBenchmark("PL_NBP_REFERENCE", fetch))
        .observations,
    ).toHaveLength(5);
    expect(
      (await POLISH_BOND_ADAPTER.fetchBenchmark("PL_CPI_GUS_YOY", fetch))
        .observations,
    ).toHaveLength(5);
    await expect(
      POLISH_BOND_ADAPTER.fetchBenchmark("X", fetch),
    ).rejects.toThrow(/no benchmark X/);
  });
});
