import {
  BenchmarkFetchError,
  BenchmarkFetchResult,
  BenchmarkObservation,
  BondFetch,
} from "../../bond-adapter";
import { ExactDecimal } from "../../domain/exact-decimal";

/**
 * GUS publishes the table as a numbered file; the suffix (`_8`) is bumped when
 * the file is replaced, so the old URL then answers 404. The landing page always
 * links the current file, and is the fallback.
 */
export const GUS_CPI_CSV_URL =
  "https://stat.gov.pl/download/gfx/portalinformacyjny/pl/defaultstronaopisowa/4741/1/1/miesiecznewskaznikicentowarowiuslugkonsumpcyjnychod1982roku_8.csv";
export const GUS_CPI_LANDING_URL =
  "https://stat.gov.pl/obszary-tematyczne/ceny-handel/wskazniki-cen/wskazniki-cen-towarow-i-uslug-konsumpcyjnych-pot-inflacja-/miesieczne-wskazniki-cen-towarow-i-uslug-konsumpcyjnych-od-1982-roku/";

const GUS_ORIGIN = "https://stat.gov.pl";
const NATION = "Polska";
const YEAR_ON_YEAR = "Analogiczny miesiąc poprzedniego roku = 100";

const nfc = (text: string) => text.normalize("NFC");

/** The index "103,4" (previous year = 100) as the fraction "0.034". */
function indexToFraction(text: string, where: string): string {
  if (!/^\d+(,\d+)?$/.test(text)) {
    throw new BenchmarkFetchError(
      `GUS CPI ${where}: malformed value "${text}"`,
    );
  }
  return ExactDecimal.parse(text.replace(",", "."))
    .sub(ExactDecimal.fromInt(100))
    .div(ExactDecimal.fromInt(100))
    .toTrimmedString(10, 4);
}

/**
 * Year-on-year CPI for Poland, one observation per reference month, dated the
 * first of the month. A month GUS has not published has an empty value and is
 * skipped, never read as zero.
 */
export function parseGusCpiCsv(text: string): BenchmarkObservation[] {
  const [header, ...lines] = text.replace(/^\uFEFF/, "").split(/\r?\n/);
  const columns = (header ?? "").split(";").map((c) => nfc(c.trim()));
  const at = (name: string) => columns.indexOf(nfc(name));
  const [territory, presentation, year, month, value] = [
    at("Jednostka terytorialna"),
    at("Sposób prezentacji"),
    at("Rok"),
    at("Miesiąc"),
    at("Wartość"),
  ];
  if ([territory, presentation, year, month, value].includes(-1)) {
    throw new BenchmarkFetchError("GUS CPI: unexpected CSV header");
  }

  const byDate = new Map<string, BenchmarkObservation>();
  for (const line of lines) {
    if (line.trim() === "") continue;
    const cells = line.split(";").map((c) => nfc(c.trim()));
    if (cells[territory] !== NATION || cells[presentation] !== YEAR_ON_YEAR)
      continue;
    if (cells[value] === "") continue;
    const y = Number(cells[year]);
    const m = Number(cells[month]);
    if (
      !Number.isInteger(y) ||
      y < 1982 ||
      !Number.isInteger(m) ||
      m < 1 ||
      m > 12
    ) {
      throw new BenchmarkFetchError(
        `GUS CPI: malformed period "${cells[year]}-${cells[month]}"`,
      );
    }
    const observationDate = `${y}-${String(m).padStart(2, "0")}-01`;
    if (byDate.has(observationDate)) {
      throw new BenchmarkFetchError(
        `GUS CPI: duplicate row for ${observationDate}`,
      );
    }
    byDate.set(observationDate, {
      observationDate,
      value: indexToFraction(cells[value], observationDate),
      publishedOn: null,
    });
  }
  if (byDate.size === 0)
    throw new BenchmarkFetchError("GUS CPI: no usable rows");
  return [...byDate.values()].sort((a, b) =>
    a.observationDate.localeCompare(b.observationDate),
  );
}

/** The href of the monthly CPI file on the landing page, absolute. */
export function findCsvLink(html: string): string | null {
  const links = [...html.matchAll(/href="([^"]+\.csv)"/gi)].map((m) => m[1]);
  const chosen =
    links.find((href) =>
      /wskaznikicentowarowiuslugkonsumpcyjnychod1982/i.test(href),
    ) ?? null;
  if (!chosen) return null;
  return chosen.startsWith("http") ? chosen : `${GUS_ORIGIN}${chosen}`;
}

export async function fetchGusCpi(
  get: BondFetch,
): Promise<BenchmarkFetchResult> {
  let url = GUS_CPI_CSV_URL;
  let response = await get(url);
  if (response.status === 404) {
    const page = await get(GUS_CPI_LANDING_URL);
    if (page.status !== 200) {
      throw new BenchmarkFetchError(
        `GUS CPI file answered 404 and the landing page HTTP ${page.status}`,
      );
    }
    const link = findCsvLink(new TextDecoder("utf-8").decode(page.body));
    if (!link)
      throw new BenchmarkFetchError("GUS CPI: no CSV link on the landing page");
    url = link;
    response = await get(url);
  }
  if (response.status !== 200) {
    throw new BenchmarkFetchError(
      `GUS CPI ${url} answered HTTP ${response.status}`,
    );
  }
  const observations = parseGusCpiCsv(
    new TextDecoder("windows-1250").decode(response.body),
  );
  return {
    observations,
    coveredThrough: observations[observations.length - 1].observationDate,
    sourceUrl: url,
  };
}
