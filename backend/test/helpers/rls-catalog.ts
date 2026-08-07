import { randomUUID } from "node:crypto";
import { DataSource } from "typeorm";

/**
 * Catalog + generic row seeder for the RLS enforcement spec (task T2).
 *
 * T2 has to make an assertion about *every* table in the database, including
 * tables that do not exist yet when this is written. That rules out hand-rolled
 * per-table fixtures: a new table would silently get no coverage. Instead the
 * catalog is read from the live database (information_schema + pg_catalog) and
 * rows are generated from it -- one row per (table, owner) -- so a table added
 * by a future migration is seeded, bucketed and asserted on with no
 * registration step. A column type this generator does not understand throws,
 * naming the column; that failure is the prompt to extend the generator, not a
 * gap in coverage.
 */

export interface ColumnInfo {
  name: string;
  dataType: string;
  udtName: string;
  nullable: boolean;
  hasDefault: boolean;
  maxLength: number | null;
}

export interface ForeignKeyInfo {
  column: string;
  refTable: string;
  refColumn: string;
}

export interface TableCatalogEntry {
  name: string;
  columns: ColumnInfo[];
  primaryKey: string[];
  /** Single-column foreign keys, keyed by the referencing column. */
  foreignKeys: Map<string, ForeignKeyInfo>;
}

export type TableCatalog = Map<string, TableCatalogEntry>;

/** Reads every public table's columns, primary key and foreign keys. */
export async function loadTableCatalog(
  dataSource: DataSource,
): Promise<TableCatalog> {
  const catalog: TableCatalog = new Map();

  const tables: { tablename: string }[] = await dataSource.query(
    "SELECT tablename FROM pg_tables WHERE schemaname = 'public' ORDER BY tablename",
  );
  for (const { tablename } of tables) {
    catalog.set(tablename, {
      name: tablename,
      columns: [],
      primaryKey: [],
      foreignKeys: new Map(),
    });
  }

  const columns: {
    table_name: string;
    column_name: string;
    data_type: string;
    udt_name: string;
    is_nullable: string;
    column_default: string | null;
    character_maximum_length: number | null;
  }[] = await dataSource.query(
    `SELECT table_name, column_name, data_type, udt_name, is_nullable,
            column_default, character_maximum_length
       FROM information_schema.columns
      WHERE table_schema = 'public'
      ORDER BY table_name, ordinal_position`,
  );
  for (const col of columns) {
    catalog.get(col.table_name)?.columns.push({
      name: col.column_name,
      dataType: col.data_type,
      udtName: col.udt_name,
      nullable: col.is_nullable === "YES",
      hasDefault: col.column_default !== null,
      maxLength: col.character_maximum_length,
    });
  }

  const pks: { table_name: string; column_name: string }[] =
    await dataSource.query(
      `SELECT tc.table_name, kcu.column_name
         FROM information_schema.table_constraints tc
         JOIN information_schema.key_column_usage kcu
           ON kcu.constraint_name = tc.constraint_name
          AND kcu.table_schema = tc.table_schema
        WHERE tc.constraint_type = 'PRIMARY KEY' AND tc.table_schema = 'public'
        ORDER BY tc.table_name, kcu.ordinal_position`,
    );
  for (const pk of pks) {
    catalog.get(pk.table_name)?.primaryKey.push(pk.column_name);
  }

  // pg_constraint rather than information_schema for foreign keys: the
  // information_schema view multiplies rows for composite keys, and conkey /
  // confkey keep referencing and referenced columns paired positionally.
  const fks: {
    table_name: string;
    column_name: string;
    ref_table: string;
    ref_column: string;
  }[] = await dataSource.query(
    `SELECT rel.relname AS table_name,
            att.attname AS column_name,
            fref.relname AS ref_table,
            fatt.attname AS ref_column
       FROM pg_constraint con
       JOIN pg_class rel ON rel.oid = con.conrelid
       JOIN pg_namespace ns ON ns.oid = rel.relnamespace
       JOIN pg_class fref ON fref.oid = con.confrelid
       JOIN LATERAL unnest(con.conkey, con.confkey) AS pairs(attnum, fattnum) ON true
       JOIN pg_attribute att ON att.attrelid = rel.oid AND att.attnum = pairs.attnum
       JOIN pg_attribute fatt ON fatt.attrelid = fref.oid AND fatt.attnum = pairs.fattnum
      WHERE con.contype = 'f' AND ns.nspname = 'public'
        AND array_length(con.conkey, 1) = 1`,
  );
  for (const fk of fks) {
    catalog.get(fk.table_name)?.foreignKeys.set(fk.column_name, {
      column: fk.column_name,
      refTable: fk.ref_table,
      refColumn: fk.ref_column,
    });
  }

  return catalog;
}

/** First label of every enum type, keyed by the type's udt name. */
export async function loadEnumFirstValues(
  dataSource: DataSource,
): Promise<Map<string, string>> {
  const rows: { typname: string; enumlabel: string }[] = await dataSource.query(
    `SELECT DISTINCT ON (t.typname) t.typname, e.enumlabel
       FROM pg_type t JOIN pg_enum e ON e.enumtypid = t.oid
      ORDER BY t.typname, e.enumsortorder`,
  );
  return new Map(rows.map((r) => [r.typname, r.enumlabel]));
}

export interface BuiltInsert {
  sql: string;
  values: unknown[];
}

/**
 * Ownership columns that reference `users(id)` by convention. Several entities
 * declare these as plain uuid columns without a relation, so the
 * synchronize-built schema has no FK constraint to discover -- but the RLS
 * policies still key on them, so the seeder must fill them with the owner.
 */
const USER_REF_COLUMNS = new Set([
  "user_id",
  "owner_user_id",
  "delegate_user_id",
]);

/**
 * Parent references that likewise lack a DB-level FK constraint in the
 * synchronize-built schema (`table.column` -> parent). A future FK-less
 * reference column is not silently mis-seeded: it gets a random uuid, the
 * policy hides the row, and the visibility sweep fails naming the table.
 */
const FKLESS_PARENT_REFS: Record<string, ForeignKeyInfo> = {
  "attachment_blobs.attachment_id": {
    column: "attachment_id",
    refTable: "transaction_attachments",
    refColumn: "id",
  },
  "delegate_account_favourites.account_id": {
    column: "account_id",
    refTable: "accounts",
    refColumn: "id",
  },
  "delegate_net_worth_exclusions.account_id": {
    column: "account_id",
    refTable: "accounts",
    refColumn: "id",
  },
  "account_delegate_grants.account_id": {
    column: "account_id",
    refTable: "accounts",
    refColumn: "id",
  },
};

/**
 * Generates one minimal valid row per (table, owner) and remembers what it
 * inserted, so ownership assertions can compare "what the app role can see"
 * against "what was seeded for that user" exactly, by primary key.
 *
 * Ownership is expressed through foreign keys: any column referencing
 * `users(id)` gets the owner's id, any other NOT NULL foreign key gets the
 * owner's already-seeded parent row (which is why seeding follows a topological
 * order), and `currencies` -- global, RLS-exempt reference data -- always
 * resolves to USD. That single rule covers direct `user_id` tables, the bespoke
 * owner columns (`owner_user_id`, `delegate_user_id`, `users.id` itself) and
 * every indirect table, without a per-table map.
 */
export class RlsRowSeeder {
  private uniq = 0;

  /** Inserted rows: table -> ownerId -> full row (RETURNING *). */
  readonly seededRows = new Map<string, Map<string, Record<string, unknown>>>();

  constructor(
    private readonly dataSource: DataSource,
    private readonly catalog: TableCatalog,
    private readonly enumFirstValues: Map<string, string>,
  ) {}

  /**
   * Orders `tables` so every NOT NULL foreign key's parent (within the set)
   * comes first. Nullable foreign keys are left NULL by the generator, so they
   * impose no ordering; references to `users` and `currencies` are satisfied
   * outside the set.
   */
  topoOrder(tables: string[]): string[] {
    const inSet = new Set(tables);
    const remaining = new Set(tables);
    const ordered: string[] = [];

    while (remaining.size > 0) {
      const ready = [...remaining].filter((table) => {
        const entry = this.entry(table);
        return entry.columns.every((col) => {
          const fk = this.effectiveFk(table, col);
          // A nullable ownership column is filled by `buildInsert` (the policy
          // keys on it), so it is a real dependency here too -- otherwise the row
          // can be ordered before the user it points at and the insert dies on
          // the foreign key.
          if (!fk || (col.nullable && !USER_REF_COLUMNS.has(col.name))) {
            return true;
          }
          if (fk.refTable === table) return true;
          if (!inSet.has(fk.refTable)) return true;
          return !remaining.has(fk.refTable);
        });
      });
      if (ready.length === 0) {
        throw new Error(
          `Cyclic NOT NULL foreign keys among: ${[...remaining].join(", ")}`,
        );
      }
      for (const table of ready.sort()) {
        remaining.delete(table);
        ordered.push(table);
      }
    }
    return ordered;
  }

  /**
   * Builds an INSERT for one fresh row owned by `ownerId`. Every call generates
   * new unique values, so a second call for the same (table, owner) yields a
   * distinct row -- which is what the WITH CHECK assertions need. `overrides`
   * force specific columns (delegation fixtures use this).
   */
  buildInsert(
    table: string,
    ownerId: string,
    overrides: Record<string, unknown> = {},
  ): BuiltInsert {
    const entry = this.entry(table);
    const columns: string[] = [];
    const values: unknown[] = [];

    for (const col of entry.columns) {
      if (col.name in overrides) {
        columns.push(col.name);
        values.push(overrides[col.name]);
        continue;
      }

      // users.id is the one owner column that also has a generated default:
      // the owner IS the row, so the id must be the owner's, not a fresh uuid.
      if (table === "users" && col.name === "id") {
        columns.push(col.name);
        values.push(ownerId);
        continue;
      }

      const fk = this.effectiveFk(table, col);
      if (fk) {
        // A nullable *ownership* column is still the row's ownership, and the
        // policy keys on it -- so it gets the owner even though it may be NULL in
        // production. `attachment_blob_tombstones.user_id` is nullable on purpose
        // (ON DELETE SET NULL: a tombstone has to outlive its owner, because that
        // is exactly when the bytes most need removing), and skipping it left an
        // ownerless row that neither user could see. The sweep then reported
        // "saw 0 rows" for a table whose policy is fine.
        const isOwnership = USER_REF_COLUMNS.has(col.name);
        if (col.nullable && !isOwnership) continue;
        columns.push(col.name);
        values.push(this.resolveForeignKey(table, fk, ownerId));
        continue;
      }

      if (col.hasDefault || col.nullable) continue;

      columns.push(col.name);
      values.push(this.generateValue(table, col));
    }

    if (columns.length === 0) {
      // A table of nothing but defaulted columns (no ownership at all) still
      // gets a row, so the bucket test can report it instead of seeding crashing.
      return {
        sql: `INSERT INTO "${table}" DEFAULT VALUES RETURNING *`,
        values,
      };
    }
    const columnList = columns.map((c) => `"${c}"`).join(", ");
    const params = columns.map((_, i) => `$${i + 1}`).join(", ");
    return {
      sql: `INSERT INTO "${table}" (${columnList}) VALUES (${params}) RETURNING *`,
      values,
    };
  }

  /** Inserts (as the connection's role -- the owner) and records the row. */
  async seedRowFor(
    table: string,
    ownerId: string,
  ): Promise<Record<string, unknown>> {
    const { sql, values } = this.buildInsert(table, ownerId);
    const [row] = await this.dataSource.query(sql, values);
    if (!this.seededRows.has(table)) {
      this.seededRows.set(table, new Map());
    }
    this.seededRows.get(table)!.set(ownerId, row);
    return row;
  }

  /** Seeds one row per (table, owner), parents before children. */
  async seedAll(tables: string[], ownerIds: string[]): Promise<void> {
    const order = this.topoOrder(tables);
    for (const ownerId of ownerIds) {
      for (const table of order) {
        await this.seedRowFor(table, ownerId);
      }
    }
  }

  seededRowFor(table: string, ownerId: string): Record<string, unknown> {
    const row = this.seededRows.get(table)?.get(ownerId);
    if (!row) {
      throw new Error(`No seeded row for ${table} / owner ${ownerId}`);
    }
    return row;
  }

  /**
   * The column's reference, whether or not the schema declares it: a real FK
   * constraint, a known FK-less parent reference, or -- by naming convention --
   * an ownership column pointing at `users(id)`.
   */
  private effectiveFk(
    table: string,
    column: ColumnInfo,
  ): ForeignKeyInfo | undefined {
    const real = this.entry(table).foreignKeys.get(column.name);
    if (real) return real;
    const fallback = FKLESS_PARENT_REFS[`${table}.${column.name}`];
    if (fallback) return fallback;
    if (column.udtName === "uuid" && USER_REF_COLUMNS.has(column.name)) {
      return { column: column.name, refTable: "users", refColumn: "id" };
    }
    return undefined;
  }

  private entry(table: string): TableCatalogEntry {
    const entry = this.catalog.get(table);
    if (!entry) {
      throw new Error(`Table "${table}" not found in catalog`);
    }
    return entry;
  }

  private resolveForeignKey(
    table: string,
    fk: ForeignKeyInfo,
    ownerId: string,
  ): unknown {
    if (fk.refTable === "users") return ownerId;
    // Global RLS-exempt reference data: every seeded row shares one currency.
    if (fk.refTable === "currencies") return "USD";
    const parent = this.seededRows.get(fk.refTable)?.get(ownerId);
    if (!parent) {
      throw new Error(
        `Seeding ${table}.${fk.column}: no seeded parent row in ${fk.refTable} ` +
          `for owner ${ownerId} -- check the topological order`,
      );
    }
    return parent[fk.refColumn];
  }

  private generateValue(table: string, col: ColumnInfo): unknown {
    const enumValue = this.enumFirstValues.get(col.udtName);
    if (enumValue !== undefined) return enumValue;

    switch (col.dataType) {
      case "character varying":
      case "character":
      case "text": {
        const value = `t${(++this.uniq).toString(36)}`;
        // Keep the counter (the tail) when the column is shorter than the
        // generated string, so uniqueness survives truncation.
        return col.maxLength && value.length > col.maxLength
          ? value.slice(-col.maxLength)
          : value;
      }
      case "uuid":
        return randomUUID();
      case "integer":
      case "bigint":
      case "smallint":
        return ++this.uniq;
      case "numeric":
      case "double precision":
      case "real":
        return 1;
      case "boolean":
        return false;
      case "date":
        return "2026-01-01";
      case "timestamp with time zone":
      case "timestamp without time zone":
        return "2026-01-01T00:00:00.000Z";
      case "json":
      case "jsonb":
        return "{}";
      case "bytea":
        return Buffer.from([0]);
      case "ARRAY":
        return "{}";
      default:
        throw new Error(
          `RlsRowSeeder cannot generate a value for ${table}.${col.name} ` +
            `(${col.dataType}/${col.udtName}) -- extend the generator`,
        );
    }
  }
}
