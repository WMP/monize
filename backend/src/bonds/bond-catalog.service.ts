import { Injectable, Logger, OnApplicationBootstrap } from "@nestjs/common";
import { DataSource, EntityManager } from "typeorm";
import { withScopedDb } from "../common/db/scoped-db";
import { withSystemContext } from "../common/db/with-context";
import { BondAdapter, CatalogEntry } from "./bond-adapter";
import { bondInstrumentId } from "./bond-instrument-id";
import { INSTALLED_BOND_ADAPTERS } from "./bond-adapters";
import { BondInstrumentSummary } from "./bond-valuation.service";
import { contentHash } from "./canonical-json";
import { BondTerms, parseBondTerms } from "./domain/bond-terms";

/**
 * Seeds the curated reference data of every installed adapter: benchmark series
 * metadata and the bond instruments with their terms versions.
 *
 * Global reference data with no owner, so a system context at boot. Every
 * statement is idempotent (`ON CONFLICT`), so N replicas booting together
 * converge on the same rows. A terms version already stored is never rewritten
 * (INV-BOND-001): a catalog entry whose content differs from the stored one is
 * logged and skipped, and a correction is published as a new `termsVersion`.
 */
@Injectable()
export class BondCatalogService implements OnApplicationBootstrap {
  private readonly logger = new Logger(BondCatalogService.name);

  constructor(private readonly dataSource: DataSource) {}

  async onApplicationBootstrap(): Promise<void> {
    try {
      await withSystemContext(() => this.seed());
    } catch (error) {
      // Reference data that cannot be seeded is an error to read, not a reason
      // for the whole application to refuse to start.
      const message = error instanceof Error ? error.message : String(error);
      this.logger.error(`Bond catalog seeding failed: ${message}`);
    }
  }

  /** Needs an ambient identity (`withSystemContext`), like any database access. */
  async seed(
    adapters: readonly BondAdapter[] = INSTALLED_BOND_ADAPTERS,
  ): Promise<void> {
    await withScopedDb(this.dataSource, async (m) => {
      for (const adapter of adapters) {
        await this.upsertBenchmarkSeries(m, adapter);
        for (const entry of adapter.catalog) {
          await this.seedEntry(m, adapter, entry);
        }
      }
    });
  }

  /** The catalog for the link picker, ordered by country, issuer and series. */
  async listInstruments(): Promise<BondInstrumentSummary[]> {
    const rows: Array<{
      id: string;
      issuer_country_code: string;
      issuer_code: string;
      program_code: string;
      series_code: string;
      currency_code: string;
    }> = await withScopedDb(this.dataSource, (m) =>
      m.query(
        `SELECT id, issuer_country_code, issuer_code, program_code, series_code, currency_code
           FROM bond_instruments
          ORDER BY issuer_country_code, issuer_code, series_code`,
      ),
    );
    return rows.map((r) => ({
      id: r.id,
      issuerCountryCode: r.issuer_country_code,
      issuerCode: r.issuer_code,
      programCode: r.program_code,
      seriesCode: r.series_code,
      currencyCode: r.currency_code,
    }));
  }

  /** The series rows alone, for a refresh that must not depend on boot order. */
  async seedBenchmarkSeries(
    adapters: readonly BondAdapter[] = INSTALLED_BOND_ADAPTERS,
  ): Promise<void> {
    await withScopedDb(this.dataSource, async (m) => {
      for (const adapter of adapters)
        await this.upsertBenchmarkSeries(m, adapter);
    });
  }

  /** `covered_through` is never touched: it only moves forward, by the refresh. */
  private async upsertBenchmarkSeries(
    m: EntityManager,
    adapter: BondAdapter,
  ): Promise<void> {
    for (const series of adapter.benchmarks) {
      await m.query(
        `INSERT INTO benchmark_series (code, kind, publisher, source_url, unit)
         VALUES ($1, $2, $3, $4, $5)
         ON CONFLICT (code) DO UPDATE
            SET kind = EXCLUDED.kind,
                publisher = EXCLUDED.publisher,
                source_url = EXCLUDED.source_url,
                unit = EXCLUDED.unit,
                updated_at = NOW()`,
        [
          series.code,
          series.kind,
          series.publisher,
          series.sourceUrl,
          series.unit,
        ],
      );
    }
  }

  private async seedEntry(
    m: EntityManager,
    adapter: BondAdapter,
    entry: CatalogEntry,
  ): Promise<void> {
    let terms: BondTerms;
    try {
      terms = parseBondTerms(entry.terms);
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      this.logger.error(
        `Bond catalog (${adapter.countryCode}) entry version ${entry.termsVersion} skipped: ${message}`,
      );
      return;
    }
    const { instrument } = terms;
    const named = `${instrument.issuerCountryCode} ${instrument.issuerCode} ${instrument.seriesCode}`;

    // A missing currency would fail the foreign key and abort the whole
    // transaction, so it is checked first and the entry skipped.
    const currency: unknown[] = await m.query(
      `SELECT 1 FROM currencies WHERE code = $1`,
      [instrument.currency],
    );
    if (currency.length === 0) {
      this.logger.error(
        `Bond catalog entry ${named} skipped: currency ${instrument.currency} is not in the currencies table`,
      );
      return;
    }

    // The id is derived from the unique key, not generated: the table is not in
    // the user backup, so a security's link survives a restore onto another
    // deployment only if the same series has the same id there.
    await m.query(
      `INSERT INTO bond_instruments
         (id, issuer_country_code, issuer_code, program_code, series_code, currency_code, marketability)
       VALUES ($7::uuid, $1, $2, $3, $4, $5, $6)
       ON CONFLICT (issuer_country_code, issuer_code, series_code) DO NOTHING`,
      [
        instrument.issuerCountryCode,
        instrument.issuerCode,
        instrument.programCode,
        instrument.seriesCode,
        instrument.currency,
        instrument.marketability,
        bondInstrumentId(
          instrument.issuerCountryCode,
          instrument.issuerCode,
          instrument.seriesCode,
        ),
      ],
    );
    const rows: Array<{ id: string }> = await m.query(
      `SELECT id FROM bond_instruments
        WHERE issuer_country_code = $1 AND issuer_code = $2 AND series_code = $3`,
      [
        instrument.issuerCountryCode,
        instrument.issuerCode,
        instrument.seriesCode,
      ],
    );
    const instrumentId = rows[0].id;

    const hash = contentHash(entry.terms);
    const inserted: unknown[] = await m.query(
      `INSERT INTO bond_terms_versions
         (bond_instrument_id, version, terms, content_hash, source_url, published_at, retrieved_at)
       VALUES ($1, $2, $3::jsonb, $4, $5, $6, NOW())
       ON CONFLICT (bond_instrument_id, version) DO NOTHING
       RETURNING version`,
      [
        instrumentId,
        entry.termsVersion,
        JSON.stringify(entry.terms),
        hash,
        terms.source.url,
        entry.publishedAt,
      ],
    );
    if (inserted.length > 0) {
      this.logger.log(`Stored terms version ${entry.termsVersion} of ${named}`);
      return;
    }

    const stored: Array<{ content_hash: string }> = await m.query(
      `SELECT content_hash FROM bond_terms_versions
        WHERE bond_instrument_id = $1 AND version = $2`,
      [instrumentId, entry.termsVersion],
    );
    if (stored[0]?.content_hash !== hash) {
      this.logger.error(
        `Terms version ${entry.termsVersion} of ${named} is stored with different content; ` +
          `it is immutable (INV-BOND-001), so the catalog entry is skipped. Publish the correction as a new termsVersion.`,
      );
    }
  }
}
